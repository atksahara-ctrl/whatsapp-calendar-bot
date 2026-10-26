const http = require('http');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const FormData = require('form-data');
const pino = require('pino');

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyrAwUYbMUjDSdDy-MWh6mmeaLEM3M_dz8STo1VznJTgOtqlYvD60_dY6L5ltMWagvJPw/exec';
const GROQ_API_KEY = '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';

let qrCodeDataURL = '';
let isConnected = false;

// Render വെബ് സെർവർ
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
        res.end('<h2 style="text-align:center;margin-top:50px;">Initializing bot...</h2>');
    }
}).listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

// ഓഡിയോ ഫയൽ Groq Whisper വഴി കൃത്യമായ മലയാളത്തിൽ മാറ്റുന്ന ഫംഗ്ഷൻ
async function transcribeAudioWithGroq(audioBuffer) {
    try {
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'ml'); // മലയാളം ഭാഷ നിർബന്ധമാക്കുന്നു
        formData.append('prompt', 'ഇത് കലണ്ടർ മീറ്റിംഗ്, ടാസ്ക് എന്നിവ രേഖപ്പെടുത്തുന്ന മലയാളം വോയ്‌സ് നോട്ടാണ്. സമയം: നാളെ, മറ്റന്നാൾ, മണിക്ക്, മീറ്റിംഗ്.');

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        });

        return response.data?.text || '';
    } catch (error) {
        console.error('Groq Transcription Error:', error.response?.data || error.message);
        return null;
    }
}

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
            const remoteJid = msg.key.remoteJid;

            // ⚠️ സുരക്ഷാ മാറ്റം: സ്വന്തം അക്കൗണ്ടിൽ (Message yourself) നിന്നല്ലാതെ മറ്റുള്ളവരുടെ ചാറ്റുകളിലോ ഗ്രൂപ്പുകളിലോ ബോട്ട് പ്രവർത്തിക്കില്ല!
            const myJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
            if (remoteJid !== myJid) {
                continue; // മറ്റുള്ളവർക്ക് അയക്കുന്ന വോയ്‌സ് നോട്ടുകൾ ബോട്ട് തൊടില്ല!
            }

            let incomingText = '';

            // 1. സാധാരണ ടെക്സ്റ്റ് മെസ്സേജ്
            const textMsg = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (textMsg) {
                if (textMsg.startsWith('✅ കലണ്ടറിൽ ടാസ്ക്')) continue;
                incomingText = textMsg;
            }

            // 2. സ്വന്തം ചാറ്റിൽ വരുന്ന വോയ്‌സ് നോട്ട്
            const audioMsg = msg.message?.audioMessage;
            if (audioMsg) {
                try {
                    console.log('Voice note received in self chat, converting...');
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const transcription = await transcribeAudioWithGroq(buffer);
                    
                    if (transcription) {
                        console.log('Transcribed Text:', transcription);
                        incomingText = transcription;
                    }
                } catch (err) {
                    console.error('Audio processing error:', err.message);
                }
            }

            // 3. കലണ്ടറിലേക്ക് അയക്കൽ
            if (incomingText) {
                const lower = incomingText.toLowerCase();
                if (lower.includes('#cal') || lower.includes('meet') || lower.includes('വിളിക്കണം') || lower.includes('മീറ്റിംഗ്') || lower.includes('മണിക്ക്')) {
                    try {
                        console.log('Processing calendar event for:', incomingText);
                        const res = await axios.post(SCRIPT_URL, { message: incomingText });
                        
                        if (res.data && res.data.status === 'success') {
                            const time = res.data.timeFormatted || 'നിശ്ചയിച്ച സമയത്ത്';
                            const title = res.data.title || incomingText;
                            let reply = `✅ കലണ്ടറിൽ ടാസ്ക് സെറ്റ് ചെയ്തു:\n"${title}"\nതീയതി & സമയം: ${time}`;
                            
                            if (res.data.meetLink) {
                                reply += `\n🔗 Google Meet Link: ${res.data.meetLink}`;
                            }

                            await sock.sendMessage(remoteJid, { text: reply });
                        }
                    } catch (err) {
                        console.error('Calendar Script Error:', err.message);
                    }
                }
            }
        }
    });
}

connectToWhatsApp();
