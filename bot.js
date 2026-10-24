const http = require('http');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxfSDM0LTdN7tNWdguKdiwUNvdkLC0DD5bbCaGRRQQp5WSO2qAng2RCnMTLepZ_JUwHSA/exec';

let qrCodeDataURL = '';
let isConnected = false;

const port = process.env.PORT || 3000;
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (isConnected) {
        res.end('<h1 style="color:green;text-align:center;margin-top:50px;">✅ WhatsApp Bot 100% Connected & Running Live!</h1>');
    } else if (qrCodeDataURL) {
        res.end(`
            <div style="text-align:center;margin-top:40px;font-family:sans-serif;">
                <h2>Scan WhatsApp QR Code</h2>
                <p>Open WhatsApp > Linked Devices > Link a Device</p>
                <img src="${qrCodeDataURL}" style="width:300px;height:300px;border:2px solid #ccc;padding:10px;border-radius:10px;" />
            </div>
        `);
    } else {
        res.end('<h2 style="text-align:center;margin-top:50px;">Generating QR Code, please refresh in 5 seconds...</h2>');
    }
}).listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeDataURL = await QRCode.toDataURL(qr);
            console.log('New QR code ready on web page!');
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeDataURL = '';
            console.log('✅ WhatsApp Bot Connected!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            
            if (!text || text.startsWith('✅ കലണ്ടറിൽ ടാസ്ക്')) continue;

            const lower = text.toLowerCase();
            if (lower.includes('#cal') || lower.includes('sit') || lower.includes('meet')) {
                try {
                    console.log('Message Received:', text);
                    const res = await axios.post(SCRIPT_URL, { message: text });
                    
                    if (res.data && res.data.status === 'success') {
                        const time = res.data.timeFormatted || 'നിശ്ചയിച്ച സമയത്ത്';
                        const title = res.data.title || text;
                        const reply = `✅ കലണ്ടറിൽ ടാസ്ക് സെറ്റ് ചെയ്തു:\n"${title}"\nതീയതി & സമയം: ${time}`;
                        
                        await sock.sendMessage(msg.key.remoteJid, { text: reply });
                    }
                } catch (err) {
                    console.error('Error:', err.message);
                }
            }
        }
    });
}

connectToWhatsApp();
