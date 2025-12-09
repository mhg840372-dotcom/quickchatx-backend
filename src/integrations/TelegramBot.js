// ======================================================
// 🤖 src/integrations/TelegramBot.js
// ✅ QuickChatX v8.9.4 — Integración avanzada con Telegram
// ------------------------------------------------------
// • Usa TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID del .env
// • Control de frecuencia (cooldown) entre mensajes
// • initTelegramBot() para inicialización opcional
// • Envío de alertas críticas, de sistema y genéricas
// ======================================================

import fetch from "node-fetch";
import chalk from "chalk";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 30000); // 30 segundos

let lastAlertTime = 0;
let isInitialized = false;

/**
 * 🧠 Inicializa el bot de Telegram (modo webhook o envío directo)
 * - Solo verifica variables de entorno
 * - Muestra estado en consola
 */
export function initTelegramBot() {
  if (isInitialized) return true;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn(chalk.yellow("⚠️ TelegramBot no configurado (faltan credenciales .env)"));
    return false;
  }

  console.log(chalk.greenBright("✅ TelegramBot inicializado correctamente."));
  isInitialized = true;
  return true;
}

/**
 * 📡 Envía un mensaje al canal/usuario configurado en Telegram
 * @param {string} message - Contenido del mensaje
 * @param {boolean} [force=false] - Si se debe ignorar el cooldown
 */
export async function sendTelegramAlert(message, force = false) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn(chalk.gray("⚠️ TelegramBot desactivado: faltan credenciales en .env"));
    return;
  }

  const now = Date.now();
  if (!force && now - lastAlertTime < ALERT_COOLDOWN_MS) return;
  lastAlertTime = now;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const body = {
      chat_id: TELEGRAM_CHAT_ID,
      text: `📢 *QuickChatX Notificación*\n${message}`,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(chalk.yellow(`⚠️ TelegramBot Error: ${errText}`));
    } else {
      console.log(chalk.blue("📨 Telegram mensaje enviado correctamente."));
    }
  } catch (err) {
    console.error(chalk.red("❌ Error al enviar mensaje a Telegram:"), err?.message || err);
  }
}

/**
 * 🚨 Enviar alertas críticas forzadas (sin cooldown)
 * @param {Error|string} error - Error o mensaje
 */
export async function sendCriticalAlert(error) {
  const msg = `🚨 *Error Crítico:*\n${error?.message || error}`;
  await sendTelegramAlert(msg, true);
}

/**
 * ⚙️ Enviar alertas de sistema (reinicios, eventos, etc.)
 * @param {string} event - Descripción del evento
 * @param {string} [details] - Detalles opcionales
 */
export async function sendSystemAlert(event, details = "") {
  const msg = `⚙️ *Evento del sistema:*\n${event}\n${details ? `📝 ${details}` : ""}`;
  await sendTelegramAlert(msg, true);
}

/**
 * ✅ Export por defecto (compatibilidad server.js)
 */
export default {
  initTelegramBot,
  sendTelegramAlert,
  sendCriticalAlert,
  sendSystemAlert,
};
