// ======================================================
// 🤖 src/integrations/TelegramCommands.js
// ✅ QuickChatX v8.1 — Comandos del bot Telegram (Admin remoto)
// ------------------------------------------------------
// • /status → Estado del servidor
// • /report → Generar reporte de actividad
// • /posts → Últimos POtS + conteo
// • /top → Usuarios con más POtS
// ======================================================

import fetch from "node-fetch";
import chalk from "chalk";
import os from "os";
import mongoose from "mongoose";

import { sendTelegramAlert } from "./TelegramBot.js";
import { Post } from "../domain/Post.js";
import { User }from "../domain/User.js"; // ✅ corregido (modelo directo del dominio)
import config from "../config/config.js";
import { generateActivityReport } from "../infrastructure/MonitoringService.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.warn(chalk.gray("⚠️ TelegramCommands desactivado: faltan credenciales .env"));
}

/* ======================================================
   🧠 Estado rápido del servidor
====================================================== */
async function getSystemStatus() {
  const used = process.memoryUsage().rss / 1024 / 1024;
  const totalMem = os.totalmem() / 1024 / 1024;
  const cpuLoad = os.loadavg()[0];
  const uptime = `${Math.floor(process.uptime() / 60)} min`;

  return (
    `⚙️ *Estado del servidor*\n` +
    `🖥️ CPU: ${cpuLoad.toFixed(2)}%\n` +
    `💾 RAM: ${used.toFixed(1)}MB / ${totalMem.toFixed(0)}MB\n` +
    `🕓 Uptime: ${uptime}\n` +
    `📡 Entorno: ${(config.ENV || "desconocido").toUpperCase()}\n` +
    `📦 Mongo: ${
      mongoose.connection.readyState === 1 ? "Conectado ✅" : "Desconectado ❌"
    }`
  );
}

/* ======================================================
   🧾 Procesa comandos recibidos del bot Telegram
====================================================== */
export async function handleTelegramCommands() {
  if (!TELEGRAM_BOT_TOKEN) return;

  const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
  let lastUpdateId = 0;

  console.log(chalk.cyan("🤖 Escuchando comandos Telegram..."));

  setInterval(async () => {
    try {
      const res = await fetch(`${apiUrl}/getUpdates?offset=${lastUpdateId + 1}`);
      const data = await res.json();
      if (!data.ok || !data.result?.length) return;

      for (const update of data.result) {
        lastUpdateId = update.update_id;
        const msg = update.message?.text?.trim();
        const chatId = update.message?.chat?.id;

        if (!msg || String(chatId) !== String(TELEGRAM_CHAT_ID)) continue;

        console.log(chalk.gray(`💬 Comando recibido: ${msg}`));

        switch (true) {
          case /^\/status/i.test(msg): {
            const statusMsg = await getSystemStatus();
            await sendTelegramAlert(statusMsg, true);
            break;
          }

          case /^\/report/i.test(msg): {
            const report = await generateActivityReport();
            const memory = report.process?.memory?.rss
              ? `${(report.process.memory.rss / 1024 / 1024).toFixed(1)} MB`
              : "N/D";
            await sendTelegramAlert(
              `📊 *Reporte de actividad QuickChatX*\n` +
                `🕓 ${report.timestamp}\n` +
                `💾 Memoria: ${memory}\n` +
                `📡 Redis: ${report.redis.connected ? "🟢 Conectado" : "🔴 Desconectado"}\n` +
                `⚙️ CPU: ${report.system.cpuCount} núcleos\n` +
                `Uptime: ${report.system.uptime}`,
              true
            );
            break;
          }

          case /^\/posts/i.test(msg): {
            const posts = await Post.find().sort({ createdAt: -1 }).limit(5).lean();
            const total = await mongoose.connection
              .collection("posts")
              .countDocuments()
              .catch(() => 0);

            const postList = posts
              .map(
                (p, i) =>
                  `${i + 1}. [${p.username || "anon"}] ${
                    p.content?.slice(0, 80) || "(sin contenido)"
                  }`
              )
              .join("\n");

            await sendTelegramAlert(
              `🧠 *Últimos POtS (${total} totales)*\n${postList || "(sin registros)"}`,
              true
            );
            break;
          }

          case /^\/top/i.test(msg): {
            const topUsers = await Post.aggregate([
              { $group: { _id: "$username", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 5 },
            ]);

            const topList = topUsers
              .map((u, i) => `#${i + 1} ${u._id || "anon"} — ${u.count} POtS`)
              .join("\n");

            await sendTelegramAlert(
              `🏆 *Top usuarios POtS:*\n${topList || "(sin actividad)"}`,
              true
            );
            break;
          }

          default:
            await sendTelegramAlert(
              `❓ *Comando no reconocido.*\n\nUsa:\n/status — Estado del servidor\n/report — Generar reporte\n/posts — Últimos POtS\n/top — Top usuarios`,
              true
            );
        }
      }
    } catch (err) {
      console.warn(chalk.yellow("⚠️ Error escuchando comandos Telegram:"), err?.message || err);
    }
  }, 5000);
}

// ======================================================
// 🧩 authenticateJWT — Middleware de autenticación JWT
// (placeholder, puede ir en otro módulo)
// ======================================================
