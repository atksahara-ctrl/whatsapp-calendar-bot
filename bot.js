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

// Render-ന് ലൈവ് ആയി തുടരാനുള്ള വെബ് സെർവർ
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

// ഓഡിയോ ഫയൽ Groq Whisper വഴി ടെക്സ്റ്റാക്കി മാറ്റുന്ന ഫംഗ്ഷൻ
async function transcribeAudioWithGroq(audioBuffer) {
    try {
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
        formData.append('model', 'whisper-large-v3');

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
            let incomingText = '';
            const remoteJid = msg.key.remoteJid;

            // 1. സാധാരണ ടെക്സ്റ്റ് മെസ്സേജ് കൈകാര്യം ചെയ്യൽ
            const textMsg = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (textMsg) {
                if (textMsg.startsWith('✅ കലണ്ടറിൽ ടാസ്ക്') || textMsg.startsWith('🎙️')) continue;
                incomingText = textMsg;
            }

            // 2. വോയ്‌സ് നോട്ട് / ഓഡിയോ മെസ്സേജ് കൈകാര്യം ചെയ്യൽ
            const audioMsg = msg.message?.audioMessage;
            if (audioMsg) {
                try {
                    console.log('Voice note received, converting using Groq Whisper...');
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const transcription = await transcribeAudioWithGroq(buffer);
                    
                    if (transcription) {
                        console.log('Transcribed Text:', transcription);
                        incomingText = transcription;
                        await sock.sendMessage(remoteJid, { text: `🎙️ വോയ്‌സ് തിരിച്ചറിഞ്ഞു:\n"${transcription}"` });
                    }
                } catch (err) {
                    console.error('Audio processing error:', err.message);
                }
            }

            // 3. ലഭിച്ച ടെക്സ്റ്റ് കലണ്ടറിലേക്ക് അയക്കൽ
            if (incomingText) {
                const lower = incomingText.toLowerCase();
                // വോയ്‌സ് നോട്ടിൽ #cal പറയാൻ ബുദ്ധിമുട്ടായതിനാൽ മീറ്റിംഗ്, കാൾ, ഡേറ്റ് സംബന്ധമായ വാക്കുകൾ ഉണ്ടെങ്കിലും പ്രോസസ്സ് ചെയ്യും
                if (lower.includes('#cal') || lower.includes('meet') || lower.includes('വിളിക്കണം') || lower.includes('മീറ്റിംഗ്') || lower.includes('മണിക്ക്')) {
                    try {
                        console.log('Processing calendar event for:', incomingText);
                        const res = await axios.post(SCRIPT_URL, { message: incomingText });
                        
                        if (res.data && res.data.status === 'success') {
                            const time = res.data.timeFormatted || 'നിശ്ചയിച്ച സമയത്ത്';
                            const title = res.data.title || incomingText;
                            let reply = `✅ കലണ്ടറിൽ ടാസ്ക് സെറ്റ് ചെയ്തു:\n"${title}"\nതീയതി & സമയം: ${time}`;
                            
                            // Google Meet ലിങ്ക് ഉണ്ടെങ്കിൽ അതും മെസ്സേജിൽ ചേർക്കും
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
