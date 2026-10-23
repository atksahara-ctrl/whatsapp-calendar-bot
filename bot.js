const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// നിങ്ങളുടെ Google Apps Script URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxfSDM0LTdN7tNWdguKdiwUNvdkLC0DD5bbCaGRRQQp5WSO2qAng2RCnMTLepZ_JUwHSA/exec';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('QR കോഡ് സ്കാൻ ചെയ്യുക:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Bot റെഡിയാണ്!');
});

async function handleMessage(msg) {
    const text = msg.body;

    // ബോട്ട് തന്നെ അയക്കുന്ന മറുപടി മെസ്സേജുകൾ ഒഴിവാക്കുന്നു
    if (!text || text.startsWith('✅ കലണ്ടറിൽ ടാസ്ക്')) {
        return;
    }

    const lowerText = text.toLowerCase();
    if (lowerText.includes('#cal') || lowerText.includes('sit') || lowerText.includes('meet')) {
        try {
            console.log('മെസ്സേജ് ലഭിച്ചു:', text);
            
            const response = await axios.post(SCRIPT_URL, {
                message: text
            });

            if (response.data.status === 'success') {
                console.log('കലണ്ടറിൽ ചേർത്തു!');
                
                // Google Apps Script കണ്ടെത്തിയ ശരിയായ തീയതിയും സമയവും എടുക്കുന്നു
                const formattedTime = response.data.timeFormatted || 'നിശ്ചയിച്ച സമയത്ത്';
                const cleanTitle = response.data.title || text;

                // ശരിയായ തീയതിയും സമയവും വെച്ച് തിരികെ മറുപടി അയക്കുന്നു
                await client.sendMessage(
                    msg.to || msg.from, 
                    `✅ കലണ്ടറിൽ ടാസ്ക് സെറ്റ് ചെയ്തു:\n"${cleanTitle}"\nതീയതി & സമയം: ${formattedTime}`
                );
            }
        } catch (err) {
            console.error('Error:', err.message);
        }
    }
}

// ഇൻകമിംഗ് മെസ്സേജുകൾ
client.on('message', handleMessage);

// സ്വന്തം ചാറ്റിലേക്ക് അയക്കുന്ന മെസ്സേജുകൾ
client.on('message_create', (msg) => {
    if (msg.fromMe) {
        handleMessage(msg);
    }
});

client.initialize();