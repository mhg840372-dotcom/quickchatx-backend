// ======================================================
// 💹 QuickChatX v9.0 — FinanceRouter (REST)
// ------------------------------------------------------
// • REST API sin WebSocket
// • Cache Redis + MongoDB histórico
// • Extra: noticias de negocios vía NewsAPI (business headlines)
// ======================================================

import express from "express";
import chalk from "chalk";
import mongoose from "mongoose";
import fetch from "node-fetch";
import FinanceService, {
  FinanceRecord,
} from "../../application/FinanceService.js";
import { authenticateJWT } from "../middlewares/AuthMiddleware.js";
import { initRedis } from "../../infrastructure/RedisProvider.js";

const router = express.Router();

// ======================================================
// ⚙️ Redis helper (modo tolerante)
// ======================================================
async function getRedis() {
  try {
    const redis = await initRedis();
    return redis || null;
  } catch (err) {
    console.warn(
      chalk.yellow(
        "⚠️ Redis no disponible (FinanceRouter). Continuando sin cache."
      )
    );
    return null;
  }
}

// ======================================================
// 🔑 NewsAPI (para titulares de negocios)
// ======================================================
const NEWS_API_KEY =
  process.env.NEWSAPI_KEY_3 ||
  process.env.NEWSAPI_KEY_2 ||
  process.env.NEWSAPI_KEY ||
  null;

// Helper para llamar a NewsAPI
async function fetchBusinessNews({
  country = "us",
  category = "business",
  pageSize = 20,
  domains,
} = {}) {
  if (!NEWS_API_KEY) {
    console.warn(
      chalk.yellow(
        "⚠️ NEWSAPI_KEY no configurado (FinanceRouter /business-news)."
      )
    );
    return [];
  }

  const safePageSize = Math.min(Number(pageSize) || 20, 50);

  let endpoint = "top-headlines";
  const params = new URLSearchParams({
    apiKey: NEWS_API_KEY,
  });

  if (domains) {
    endpoint = "everything";
    params.set("domains", String(domains));
    params.set("pageSize", String(safePageSize));
  } else {
    params.set("country", String(country || "us"));
    params.set("category", String(category || "business"));
    params.set("pageSize", String(safePageSize));
  }

  const url = `https://newsapi.org/v2/${endpoint}?${params.toString()}`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (json.status !== "ok" || !Array.isArray(json.articles)) {
      console.warn(
        chalk.yellow(
          `⚠️ Respuesta inesperada de NewsAPI (${endpoint}): ${json.status || "sin status"}`
        )
      );
      return [];
    }

    return json.articles;
  } catch (err) {
    console.error(chalk.red("❌ Error consultando NewsAPI:"), err.message);
    return [];
  }
}

// ======================================================
// 🧠 GET /api/finance/live?q=BTC-USD
// → Consulta en tiempo real vía FinanceService (sin mencionar SerpApi)
// ======================================================
router.get("/live", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q)
      return res
        .status(400)
        .json({ success: false, error: "Falta parámetro 'q'" });

    // Nota: asumimos que FinanceService ya gestiona sus proveedores internos
    const data = await FinanceService.fetchFinanceData(q);
    if (!data)
      return res
        .status(404)
        .json({ success: false, error: "No se encontró información." });

    res.json({ success: true, data });
  } catch (err) {
    console.error(chalk.red("❌ Error /finance/live:"), err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// 📰 GET /api/finance/business-news
// → Titulares de negocios/mercados vía NewsAPI
//    - ?country=us (por defecto)
//    - ?limit=20 (pageSize máx 50)
//    - ?domains=wsj.com (si viene, usa /v2/everything)
// ======================================================
router.get("/business-news", async (req, res) => {
  try {
    const country = (req.query.country || "us").toString();
    const limit = Number(req.query.limit) || 20;
    const domains = req.query.domains ? String(req.query.domains) : undefined;

    const articles = await fetchBusinessNews({
      country,
      pageSize: limit,
      domains,
    });

    return res.json({
      success: true,
      count: articles.length,
      data: articles,
      source: "NewsAPI",
      mode: domains ? "everything/domains" : "top-headlines/business",
    });
  } catch (err) {
    console.error(chalk.red("❌ Error /finance/business-news:"), err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// 💾 POST /api/finance/fetch
// → Forzar actualización (autenticado) + guardar Mongo
// ======================================================
router.post(
  "/fetch",
  authenticateJWT(["admin", "user"]),
  async (req, res) => {
    try {
      const { symbols } = req.body;
      if (!Array.isArray(symbols) || !symbols.length)
        return res.status(400).json({
          success: false,
          error: "Falta lista de símbolos",
        });

      const results = await FinanceService.fetchMultiple(symbols, true, true);
      res.json({ success: true, count: results.length, data: results });
    } catch (err) {
      console.error(chalk.red("❌ Error /finance/fetch:"), err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================================================
// 📊 GET /api/finance/latest?limit=10
// ======================================================
router.get("/latest", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const data = await FinanceService.getLatest(limit);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error(chalk.red("❌ Error /finance/latest:"), err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// 🧮 GET /api/finance/stats
// → Últimos precios únicos por ticker (agrupado)
// ======================================================
router.get("/stats", async (req, res) => {
  try {
    const cacheKey = "finance:stats";
    const redis = await getRedis();

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached)
        return res.json({
          success: true,
          cached: true,
          data: JSON.parse(cached),
        });
    }

    const records = await FinanceRecord.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$ticker",
          title: { $first: "$title" },
          price: { $first: "$price" },
          changePercent: { $first: "$changePercent" },
          updatedAt: { $first: "$createdAt" },
        },
      },
      { $limit: 25 },
    ]);

    if (redis) {
      await redis.set(cacheKey, JSON.stringify(records), "EX", 600);
    }

    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    console.error(chalk.red("❌ Error /finance/stats:"), err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// 🕓 GET /api/finance/history/:ticker
// → Últimos 30 registros del ticker
// ======================================================
router.get("/history/:ticker", async (req, res) => {
  try {
    const { ticker } = req.params;
    if (!ticker)
      return res
        .status(400)
        .json({ success: false, error: "Ticker requerido" });

    const cacheKey = `finance:history:${ticker}`;
    const redis = await getRedis();

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached)
        return res.json({
          success: true,
          cached: true,
          data: JSON.parse(cached),
        });
    }

    const data = await FinanceRecord.find({ ticker })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean()
      .catch(() => []);

    if (redis) {
      await redis.set(cacheKey, JSON.stringify(data), "EX", 900);
    }

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error(chalk.red("❌ Error /finance/history:"), err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// 🧰 GET /api/finance/health
// → Estado actual de Mongo, Redis y NewsAPI (en vez de SerpApi)
// ======================================================
router.get("/health", async (req, res) => {
  try {
    const mongoOk = mongoose.connection.readyState === 1;
    const redis = await getRedis();
    const redisOk = !!redis;

    const newsApiConfigured = !!(
      process.env.NEWSAPI_KEY ||
      process.env.NEWSAPI_KEY_2 ||
      process.env.NEWSAPI_KEY_3
    );

    res.json({
      success: true,
      status: {
        mongo: mongoOk ? "conectado" : "no disponible",
        redis: redisOk ? "conectado" : "no disponible",
        newsApi: newsApiConfigured ? "configurado" : "no configurado",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(chalk.red("❌ Error /finance/health:"), err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// ✅ Export Router
// ======================================================
export default router;
