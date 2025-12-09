// ======================================================
// 📡 server.js — Reporte Telegram + POtS + Top Usuarios
// ✅ QuickChatX v7.9.1 — Reporte Inteligente + Estadísticas del Sistema
// ======================================================

import express from "express";
import chalk from "chalk";
import os from "os";
import mongoose from "mongoose";
import { sendTelegramAlert } from "./src/integrations/TelegramBot.js";
import { socketService } from "./src/services/SocketService.js";
import { Post } from "./src/domain/Post.js";
import { User } from "./src/domain/User.js";
import { ENV } from "./src/config/env.js";

const app = express();

// ======================================================
// 🧭 Función auxiliar — Estadísticas del servidor
// ======================================================
async function getServerStats() {
  const used = process.memoryUsage().rss / 1024 / 1024;
  const totalMem = os.totalmem() / 1024 / 1024;
  const freeMem = os.freemem() / 1024 / 1024;
  const cpuLoad = os.loadavg()[0]; // Promedio 1 min
  const uptime = `${Math.floor(process.uptime() / 60)} min`;

  return {
    cpu: cpuLoad.toFixed(2),
    ram: `${used.toFixed(1)}MB / ${totalMem.toFixed(0)}MB`,
    free: `${freeMem.toFixed(0)}MB`,
    uptime,
  };
}

// ======================================================
// 📊 Generador principal del reporte Telegram
// ======================================================
async function generateActivityReport() {
  try {
    const stats = await getServerStats();

    // 1️⃣ Noticias
    const newsCount = await mongoose.connection
      .collection("news")
      .countDocuments()
      .catch(() => 0);

    // 2️⃣ YouTube
    const ytCount = await mongoose.connection
      .collection("youtube_videos")
      .countDocuments()
      .catch(() => 0);

    // 3️⃣ Finanzas
    const finCount = await mongoose.connection
      .collection("finance_records")
      .countDocuments()
      .catch(() => 0);

    // 4️⃣ POtS — Posts recientes
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()
      .catch(() => []);
    const totalPosts = await mongoose.connection
      .collection("posts")
      .countDocuments()
      .catch(() => 0);

    const postList = posts.map(
      (p, i) =>
        `${i + 1}. [${p.username || "anon"}] ${p.content?.slice(0, 100) || "(sin contenido)"}`
    );

    // 5️⃣ Top Usuarios (por cantidad de POtS)
    const topUsers = await Post.aggregate([
      { $group: { _id: "$username", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]).catch(() => []);

    const totalActiveUsers = await Post.distinct("username").catch(() => []);

    const topList = topUsers
      .map((u, i) => `#${i + 1} ${u._id || "anon"} — ${u.count} POtS`)
      .join("\n");

    // ======================================================
    // 🧾 Construcción del mensaje final de Telegram
    // ======================================================
    const msg = [
      `📊 *Reporte QuickChatX*`,
      `📰 Noticias: ${newsCount}`,
      `🎬 YouTube: ${ytCount}`,
      `💰 Finanzas: ${finCount}`,
      `🧠 POtS totales: ${totalPosts}`,
      postList.length ? `🧾 *Últimos POtS:*\n${postList.join("\n")}` : "",
      `👥 Usuarios activos: ${totalActiveUsers.length}`,
      topList ? `🏆 *Top 5 usuarios:*\n${topList}` : "🏆 No hay POtS recientes.",
      `⚙️ CPU: ${stats.cpu}%`,
      `💾 RAM: ${stats.ram} (libre ${stats.free})`,
      `🕓 Uptime: ${stats.uptime}`,
      `📡 Modo: ${ENV.toUpperCase()}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Enviar a Telegram
    await sendTelegramAlert(msg, true);

    console.log(chalk.green("✅ Reporte Telegram generado y enviado correctamente"));
  } catch (err) {
    console.warn(chalk.yellow("⚠️ Error generando reporte Telegram:"), err?.message || err);
  }
}

// ======================================================
// ⏱️ Programación automática (cada 30 min)
// ======================================================
setInterval(() => {
  generateActivityReport();
}, 30 * 60 * 1000);

// ======================================================
// 🔄 Eventos WebSocket — Actualización en tiempo real
// ======================================================
socketService?.on?.("news:update", async (payload) => {
  await sendTelegramAlert(`📰 Noticias actualizadas: ${payload?.count || "?"}`);
  await generateActivityReport();
});

socketService?.on?.("youtube:sync:done", async (payload) => {
  await sendTelegramAlert(`🎬 YouTube sincronizado — ${payload?.count || "?"} nuevos videos.`);
  await generateActivityReport();
});

// ======================================================
// 🪶 Endpoint manual para generar reporte a demanda
// ======================================================
app.post("/api/telegram/reporte", async (req, res) => {
  await generateActivityReport();
  res.json({ ok: true, message: "Reporte enviado a Telegram." });
});

export { generateActivityReport };
