import fetch from "node-fetch";
import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTestMessage() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("❌ BOT_TOKEN o CHAT_ID no configurados en .env");
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: "🚀 Test: Tu bot de Telegram está funcionando correctamente!"
      }),
    });

    const data = await res.json();
    if (data.ok) {
      console.log("✅ Mensaje enviado correctamente a Telegram");
    } else {
      console.error("❌ Error enviando mensaje:", data);
    }
  } catch (err) {
    console.error("❌ Error enviando mensaje a Telegram:", err.message);
  }
}

sendTestMessage();
