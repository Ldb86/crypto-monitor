require('dotenv').config();
const axios = require('axios');

const TOKEN = process.env.BOT_TOKENS?.split(',')[0]?.trim();
const CHAT_ID = process.env.CHAT_IDS?.split(',')[0]?.trim();
const MESSAGE = "✅ Test di invio messaggio da Railway bot.";

if (!TOKEN || !CHAT_ID) {
  console.error("❌ BOT_TOKENS o CHAT_IDS mancano nel .env");
  process.exit(1);
}

const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

axios.post(url, {
  chat_id: CHAT_ID,
  text: MESSAGE,
  parse_mode: "Markdown"
})
  .then(() => {
    console.log("✅ Messaggio Telegram inviato con successo!");
  })
  .catch((err) => {
    console.error("❌ Errore Telegram:", err.response?.data || err.message);
  });
