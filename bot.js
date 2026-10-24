const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxfSDM0LTdN7tNWdguKdiwUNvdkLC0DD5bbCaGRRQQp5WSO2qAng2RCnMTLepZ_JUwHSA/exec';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('--- SCAN THIS QR CODE IN WHATSAPP ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot 100% Ready and Connected!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
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
                        console.log('Event added and reply sent!');
                    }
                } catch (err) {
                    console.error('Error:', err.message);
                }
            }
        }
    });
}

connectToWhatsApp();
