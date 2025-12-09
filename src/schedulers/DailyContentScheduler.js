// ======================================================
// ⏰ QuickChatX v8.1 — Scheduler Diario + IA + Finanzas + News
// (sin YouTube, sin Mediastack: solo NewsService → NewsAPI + GNews + TheNewsAPI)
// - Compat total con NewsService v8.6 (clase + singleton)
// ======================================================

import cron from "node-cron";
import chalk from "chalk";
import fetch from "node-fetch";
import mongoose from "mongoose";

import { initRedis } from "../infrastructure/RedisProvider.js";
import {
  connectMongo,
  isMongoConnected,
} from "../infrastructure/MongoProvider.js";

// 🧩 Import defensivo de NewsService (clase o singleton)
import * as NewsServiceModule from "../application/NewsService.js";
import FinanceService from "../application/FinanceService.js";
import { AISummaryService } from "../application/AISummaryService.js";

// Detectamos el export correcto de NewsService:
// - named: { NewsService }
// - default: export default newsServiceSingleton
const NewsService =
  NewsServiceModule.NewsService ||
  NewsServiceModule.default ||
  NewsServiceModule.newsService ||
  null;

// ======================================================
// 🧠 Modelo MongoDB — DailyDigest (protegido de OverwriteModelError)
// ======================================================
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
  mongoose.models.DailyDigest ||
  mongoose.model("DailyDigest", DailyDigestSchema);

// ======================================================
// 💬 Telegram Alert (seguro y silencioso si no está configurado)
// ======================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: `🗞️ *QuickChatX Diario*\n${message}`,
          parse_mode: "Markdown",
        }),
      }
    );
  } catch (err) {
    console.error(
      chalk.red("❌ Error enviando alerta Telegram:"),
      err?.message
    );
  }
}

// Pequeño helper para saber si NewsService está usable
function canUseNewsService() {
  if (!NewsService) return false;
  return (
    typeof NewsService.fetchAndSave === "function" ||
    typeof NewsService.periodicUpdate === "function"
  );
}

// ======================================================
// 🕓 Scheduler Diario — IA + Finanzas + News + Redis + Historial
// (SIN YouTube)
// ======================================================
export class DailyContentScheduler {
  static socket = null;
  static running = false;

  static async start(socketService = null) {
    this.socket = socketService;

    const defaultTopics = [
      "tecnología",
      "economía",
      "fútbol",
      "deportes",
      "La Liga España",
      "clima",
      "cine",
      "estrenos Netflix",
    ];

    // Fallback robusto: si NEWS_TOPICS está vacío, usamos defaultTopics
    const envTopics = process.env.NEWS_TOPICS
      ? process.env.NEWS_TOPICS.split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const newsTopics = envTopics.length ? envTopics : defaultTopics;

    const envSymbols = process.env.FINANCE_SYMBOLS
      ? process.env.FINANCE_SYMBOLS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const financeSymbols = envSymbols.length
      ? envSymbols
      : ["GOOGL:NASDAQ", "AAPL:NASDAQ", "BTC-USD", "MSFT:NASDAQ"];

    console.log(
      chalk.cyan(
        `🕒 DailyContentScheduler iniciado — ${newsTopics.length} temas y ${financeSymbols.length} símbolos financieros.`
      )
    );

    // 🔹 Ejecución inicial al arrancar
    await this.runCycle(newsTopics, financeSymbols);

    // 🔹 Cron diario 8:00 AM
    cron.schedule("0 8 * * *", async () => {
      console.log(
        chalk.blueBright("🌅 Iniciando ciclo diario completo...")
      );
      await this.runCycle(newsTopics, financeSymbols);
    });

    // 🔹 Ciclo parcial cada 20 minutos
    cron.schedule("*/20 * * * *", async () => {
      console.log(chalk.gray("🔁 Ciclo parcial: refrescando datos..."));
      await this.runCycle(newsTopics, financeSymbols, true);
    });
  }

  // ======================================================
  // 🚀 Ciclo Principal
  // ======================================================
  static async runCycle(
    newsTopics,
    financeSymbols,
    isPartial = false
  ) {
    if (this.running) {
      console.log(
        chalk.yellow(
          "⚠️ Ciclo en ejecución, se omite ejecución paralela."
        )
      );
      return;
    }

    this.running = true;
    const date = new Date();

    try {
      console.log(
        chalk.gray(
          `\n🗓️ Ejecutando ciclo ${
            isPartial ? "parcial" : "diario"
          } — ${date.toLocaleString("es-ES")}`
        )
      );

      // 🧩 Asegurar conexión Mongo activa
      if (!isMongoConnected()) {
        console.log(
          chalk.yellow(
            "⚙️ MongoDB no conectado, intentando reconexión..."
          )
        );
        await connectMongo();
      }

      const digestData = {
        date,
        totalNews: 0,
        totalVideos: 0, // 👈 sin YouTube, siempre 0
        totalFinance: 0,
        topics: [...new Set([...newsTopics])], // 👈 solo temas de noticias
        newsIds: [],
        videoIds: [], // 👈 mantenemos el campo por compatibilidad
        finance: [],
      };

      const allNews = [];
      const allVideos = []; // 👈 vacío, para compatibilidad con AISummaryService
      const financeData = [];

      // ===============================
      // 📰 Noticias — vía NewsService (NewsAPI + GNews + TheNewsAPI)
      // ===============================
      if (!canUseNewsService()) {
        console.warn(
          chalk.yellow(
            "⚠️ DailyContentScheduler: NewsService no disponible (sin fetchAndSave / periodicUpdate). Se omite bloque de noticias."
          )
        );
      } else {
        for (const rawTopic of newsTopics) {
          const topic = (rawTopic || "").trim();
          if (!topic) continue;

          console.log(
            chalk.yellow(`📰 Buscando noticias sobre: ${topic}...`)
          );
          try {
            // NewsService.fetchAndSave maneja lang/country/limit internamente
            const saved = await NewsService.fetchAndSave(topic);

            if (Array.isArray(saved) && saved.length > 0) {
              allNews.push(...saved);
              digestData.newsIds.push(
                ...saved.map((n) => n._id || n.id).filter(Boolean)
              );
              digestData.totalNews += saved.length;
            }
          } catch (err) {
            console.error(
              chalk.red(
                `⚠️ Error al obtener noticias de ${topic}: ${
                  err?.message || err
                }`
              )
            );
          }
        }
      }

      // ===============================
      // 🎬 Videos de YouTube — ELIMINADO
      // ===============================
      // (Se mantiene totalVideos=0 y videoIds vacíos por compatibilidad)

      // ===============================
      // 💹 Finanzas
      // ===============================
      for (const symbol of financeSymbols) {
        const sym = (symbol || "").trim();
        if (!sym) continue;

        try {
          const info = await FinanceService.fetchFinanceData(sym);
          if (info) financeData.push(info);
        } catch (err) {
          console.error(
            chalk.red(
              `⚠️ Error al obtener datos financieros de ${sym}: ${
                err?.message || err
              }`
            )
          );
        }
      }

      digestData.finance = financeData;
      digestData.totalFinance = financeData.length;

      // ===============================
      // 🧠 Resumen IA
      // ===============================
      let aiSummary = null;
      if (!isPartial) {
        console.log(
          chalk.cyan("🤖 Generando resumen diario con IA...")
        );
        try {
          // allVideos se pasa vacío (sin YouTube)
          aiSummary = await AISummaryService.summarize(
            allNews,
            allVideos,
            financeData
          );
        } catch (err) {
          console.error(
            chalk.red("⚠️ Error generando resumen IA:"),
            err?.message || err
          );
        }
      }

      digestData.summaryText =
        aiSummary ||
        `Resumen ${
          isPartial ? "parcial" : "diario"
        } del ${date.toLocaleDateString(
          "es-ES"
        )}: Se recopilaron ${digestData.totalNews} noticias, ${
          digestData.totalVideos
        } videos y ${
          digestData.totalFinance
        } datos financieros sobre ${digestData.topics.join(", ")}.`;

      // ===============================
      // 💾 Guardar en MongoDB (solo si es completo)
      // ===============================
      if (!isPartial) {
        try {
          await DailyDigest.create(digestData);
          console.log(
            chalk.greenBright(
              `✅ Digest diario guardado (${digestData.totalNews} noticias, ${digestData.totalVideos} videos, ${digestData.totalFinance} finanzas).`
            )
          );
        } catch (err) {
          console.error(
            chalk.red("❌ Error guardando digest en MongoDB:"),
            err?.message || err
          );
        }
      }

      // ===============================
      // 💾 Cache Redis + Emitir WS
      // ===============================
      try {
        const redis = await initRedis();
        const last7 = await DailyDigest.find({})
          .sort({ createdAt: -1 })
          .limit(7)
          .lean();

        const history = last7.map((d) => ({
          date: d.date,
          summary: d.summaryText,
          news: d.totalNews,
          videos: d.totalVideos,
          finance: d.totalFinance,
        }));

        if (redis) {
          await redis.set(
            "daily:history",
            JSON.stringify(history),
            "EX",
            86400
          );
          console.log(
            chalk.green(
              "💾 Historial IA guardado en Redis (24h TTL)"
            )
          );
        }

        if (this.socket?.io) {
          this.socket.io.emit("summary:history", history);
          console.log(
            chalk.green("📡 Historial IA emitido por WebSocket")
          );
        }
      } catch (err) {
        console.error(
          chalk.red("⚠️ Error al obtener/guardar historial IA:"),
          err?.message || err
        );
      }

      // ===============================
      // 📣 Notificación Telegram
      // ===============================
      if (!isPartial) {
        await sendTelegramAlert(
          `✅ Digest diario completado.\n📰 Noticias: *${digestData.totalNews}*\n🎬 Videos: *${digestData.totalVideos}*\n💹 Finanzas: *${digestData.totalFinance}*\n🧠 IA: ${
            aiSummary ? "generado" : "no disponible"
          }\n🕒 ${date.toLocaleString("es-ES")}`
        );

        if (aiSummary)
          console.log(
            chalk.whiteBright(
              `\n🧾 Resumen IA generado:\n${aiSummary}\n`
            )
          );
      } else {
        console.log(
          chalk.gray("🔁 Ciclo parcial completado correctamente.")
        );
      }
    } catch (err) {
      console.error(
        chalk.red("❌ Error general en ciclo diario:"),
        err?.message || err
      );
      await sendTelegramAlert(
        `❌ Error general en ciclo diario: ${err?.message || err}`
      );
    } finally {
      this.running = false;
    }
  }
}
