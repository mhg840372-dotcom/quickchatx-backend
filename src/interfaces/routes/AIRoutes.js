// ======================================================
// 🤖 QuickChatX v6.7 — AI Routes (Historial + IA Summary)
// ======================================================

import express from "express";
import chalk from "chalk";
import { initRedis } from "../../infrastructure/RedisProvider.js";  // Cambié a initRedis
import mongoose from "mongoose";

const router = express.Router();

// 🧠 Modelo dinámico (no duplicar modelo)
const DailyDigestSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    totalNews: Number,
    totalVideos: Number,
    totalFinance: Number,
    topics: [String],
    newsIds: [String],
    videoIds: [String],
    finance: Array,
    summaryText: String,
  },
  { timestamps: true, collection: "daily_digests" }
);

const DailyDigest =
  mongoose.models.DailyDigest || mongoose.model("DailyDigest", DailyDigestSchema);

// ======================================================
// 🧩 GET /api/ai/history
// Devuelve el historial IA (últimos 7 días)
// ======================================================
router.get("/history", async (req, res) => {
  try {
    const redis = await initRedis();  // Usando initRedis()

    // 1️⃣ Intentar cache Redis
    if (redis) {
      const cached = await redis.get("daily:history");
      if (cached) {
        console.log(chalk.green("📦 Historial IA obtenido desde Redis"));
        return res.json(JSON.parse(cached));
      }
    }

    // 2️⃣ Fallback: MongoDB
    const last7 = await DailyDigest.find({})
      .sort({ createdAt: -1 })
      .limit(7)
      .lean();

    if (!last7 || last7.length === 0)
      return res.status(404).json({ message: "No hay historial disponible." });

    const history = last7.map((d) => ({
      date: d.date,
      summary: d.summaryText,
      news: d.totalNews,
      videos: d.totalVideos,
      finance: d.totalFinance,
    }));

    // 3️⃣ Guardar cache Redis (TTL 24h)
    if (redis) {
      await redis.set("daily:history", JSON.stringify(history), "EX", 86400);
      console.log(chalk.yellow("💾 Historial IA cacheado en Redis (24h TTL)"));
    }

    res.json(history);
  } catch (err) {
    console.error(chalk.red("❌ Error en /api/ai/history:"), err.message);
    res.status(500).json({ error: "Error obteniendo historial IA." });
  }
});

export default router;
