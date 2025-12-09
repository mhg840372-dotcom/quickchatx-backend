// ======================================================
// 💹 QuickChatX v9.1 — FinanceService (Yahoo Finance + MongoDB + Redis Cache)
// ------------------------------------------------------
// • Normaliza "GOOGL:NASDAQ" → "GOOGL" para Yahoo
// • Añade User-Agent para evitar HTTP 401
// • Sin SERPAPI_KEY, sin SerpApi
// ======================================================

import fetch from "node-fetch";
import chalk from "chalk";
import mongoose from "mongoose";
import { initRedis } from "../infrastructure/RedisProvider.js";

// ======================================================
// ⚙️ Redis dinámico (con fallback silencioso)
// ======================================================
let redis = null;

async function getRedis() {
  if (redis) return redis;
  try {
    const client = await initRedis();
    if (!client) {
      console.warn(
        chalk.yellow(
          "⚠️ Redis no disponible (FinanceService). Continuando sin cache."
        )
      );
      redis = null;
    } else {
      redis = client;
      console.log(chalk.green("💰 Redis conectado en FinanceService"));
    }
  } catch (err) {
    console.warn(
      chalk.yellow(
        `⚠️ Error conectando a Redis (FinanceService): ${err?.message}`
      )
    );
    redis = null;
  }
  return redis;
}

// ======================================================
// 🧾 Esquema FinanceRecord — Histórico financiero
// ======================================================
const FinanceSchema = new mongoose.Schema(
  {
    ticker: { type: String, index: true }, // 👈 aquí guardamos el ticker "original"
    title: String,
    price: Number,
    change: Number,
    changePercent: String,
    currency: String,
    marketCap: String,
    timestamp: { type: Date, default: Date.now },
    source: { type: String, default: "YahooFinance" },
    raw: Object,
  },
  { timestamps: true, collection: "finance_records" }
);

export const FinanceRecord =
  mongoose.models.FinanceRecord ||
  mongoose.model("FinanceRecord", FinanceSchema);

// ======================================================
// 💼 FinanceService — Servicio principal
// ======================================================
const FinanceService = {
  baseUrl: "https://query1.finance.yahoo.com/v7/finance/quote",

  /**
   * 📊 Obtiene datos financieros desde Yahoo Finance.
   * @param {string} query - Ej: "AAPL", "AAPL:NASDAQ", "BTC-USD"
   * @param {boolean} save - Guarda en MongoDB
   * @param {boolean} silent - Suprime logs
   * @returns {Promise<Object|null>}
   */
  async fetchFinanceData(query = "GOOGL", save = false, silent = false) {
    if (!query) return null;

    const originalTicker = String(query).trim(); // lo que viene de fuera
    // ✅ Normalizar para Yahoo: "GOOGL:NASDAQ" → "GOOGL"
    const yahooSymbol = originalTicker.includes(":")
      ? originalTicker.split(":")[0].trim()
      : originalTicker;

    const cacheKey = `finance:${originalTicker}`;

    try {
      // 🧠 Intentar leer de Redis Cache
      const redisClient = await getRedis();
      if (redisClient) {
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            if (!silent)
              console.log(
                chalk.gray(
                  `📦 Redis Cache hit (FinanceService) → ${originalTicker}`
                )
              );
            return JSON.parse(cached);
          }
        } catch (err) {
          console.warn(
            chalk.yellow(
              `⚠️ Error leyendo cache Redis (FinanceService): ${err.message}`
            )
          );
        }
      }

      const url = `${this.baseUrl}?symbols=${encodeURIComponent(
        yahooSymbol
      )}`;

      if (!silent)
        console.log(
          chalk.cyan(
            `💹 Consultando ${yahooSymbol} en Yahoo Finance (ticker: ${originalTicker})...`
          )
        );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          // 👇 Algunos endpoints devuelven 401 si no hay User-Agent "realista"
          "User-Agent":
            "Mozilla/5.0 (QuickChatX FinanceBot; +https://quickchatx.com)",
          Accept: "application/json,text/*,*/*;q=0.8",
        },
      }).catch(() => null);

      clearTimeout(timeout);

      if (!res || !res.ok) {
        throw new Error(`HTTP ${res?.status || "timeout"}`);
      }

      const data = await res.json().catch(() => ({}));
      const quote = data?.quoteResponse?.result?.[0];

      if (!quote) {
        if (!silent) {
          console.warn(
            chalk.yellow(
              `⚠️ Sin resultados para ${yahooSymbol} en Yahoo Finance.`
            )
          );
        }
        return null;
      }

      // 🧩 Normalización de campos
      const price =
        typeof quote.regularMarketPrice === "number"
          ? quote.regularMarketPrice
          : null;

      const changeValue =
        typeof quote.regularMarketChange === "number"
          ? quote.regularMarketChange
          : 0;

      const changePercent =
        typeof quote.regularMarketChangePercent === "number"
          ? `${quote.regularMarketChangePercent.toFixed(2)}%`
          : "0%";

      const currency = quote.currency || "USD";
      const marketCap =
        typeof quote.marketCap === "number"
          ? quote.marketCap.toString()
          : quote.marketCap || "N/D";

      const title =
        quote.longName ||
        quote.shortName ||
        quote.displayName ||
        quote.symbol ||
        originalTicker;

      const result = {
        // 👇 Guardamos el ticker "original" que se usó (ej: GOOGL:NASDAQ)
        ticker: originalTicker,
        title,
        price,
        change: changeValue,
        changePercent,
        currency,
        marketCap,
        timestamp: new Date(),
        source: "YahooFinance",
        raw: quote,
      };

      if (!silent) {
        console.log(
          chalk.greenBright(
            `✅ ${result.ticker} → ${
              price != null ? price.toFixed(2) : "?"
            } ${currency} (${changePercent})`
          )
        );
      }

      // 💾 Guardar en MongoDB si hay conexión
      if (save && mongoose.connection.readyState === 1) {
        try {
          await FinanceRecord.create(result);
          if (!silent)
            console.log(
              chalk.gray(
                `🗄️ Guardado en MongoDB (FinanceRecord: ${originalTicker})`
              )
            );
        } catch (err) {
          console.error(
            chalk.red(
              `❌ Error al guardar en MongoDB (Finance): ${err.message}`
            )
          );
        }
      }

      // 🔁 Guardar cache en Redis (1h TTL)
      const redisClient2 = await getRedis();
      if (redisClient2) {
        try {
          await redisClient2.set(
            cacheKey,
            JSON.stringify(result),
            "EX",
            3600
          );
        } catch (err) {
          console.warn(
            chalk.yellow(
              `⚠️ Error al guardar en Redis (FinanceService): ${err.message}`
            )
          );
        }
      }

      return result;
    } catch (err) {
      if (err.name === "AbortError") {
        console.warn(
          chalk.yellow(
            `⚠️ Timeout consultando ${yahooSymbol} en Yahoo Finance`
          )
        );
      } else {
        console.error(
          chalk.red(`❌ Error FinanceService (${originalTicker}):`),
          err.message
        );
      }
      return null;
    }
  },

  /**
   * ⚙️ Obtiene múltiples símbolos en paralelo.
   * @param {string[]} symbols
   * @param {boolean} save
   * @param {boolean} silent
   * @returns {Promise<Object[]>}
   */
  async fetchMultiple(symbols = [], save = false, silent = false) {
    if (!Array.isArray(symbols) || !symbols.length) return [];
    const results = await Promise.allSettled(
      symbols.map((s) => this.fetchFinanceData(s, save, silent))
    );
    return results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value);
  },

  /**
   * 📜 Últimos registros guardados (Mongo)
   * @param {number} limit
   * @returns {Promise<Object[]>}
   */
  async getLatest(limit = 10) {
    if (mongoose.connection.readyState !== 1) return [];
    return await FinanceRecord.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .catch(() => []);
  },

  /**
   * 🚀 Inicialización opcional (para server.js)
   */
  async initialize() {
    console.log(
      chalk.cyan(
        "💰 FinanceService inicializado (Yahoo Finance, sin SERPAPI_KEY)."
      )
    );
    await getRedis(); // intenta preparar Redis, pero sigue si falla
  },

  /**
   * ⏱️ Scheduler automático (envía datos por WebSocket si existe)
   * @param {number} intervalMs
   * @param {object|null} socket
   */
  async start(intervalMs = 15 * 60 * 1000, socket = null) {
    // Puedes seguir usando símbolos con o sin mercado:
    const symbols = ["AAPL:NASDAQ", "GOOGL:NASDAQ", "MSFT:NASDAQ", "BTC-USD"];

    console.log(
      chalk.blue(
        `⏱️ FinanceScheduler activo cada ${intervalMs / 60000} min.`
      )
    );

    const runCycle = async () => {
      try {
        const data = await this.fetchMultiple(symbols, true, true);
        if (socket?.emit && data.length) {
          socket.emit("finance:update", { count: data.length, data });
        }
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error en FinanceScheduler:"),
          err?.message
        );
      }
    };

    // Ejecuta una vez al inicio y luego cíclicamente
    await runCycle();
    setInterval(runCycle, intervalMs);
  },
};

// ======================================================
// ✅ Export Default
// ======================================================
export default FinanceService;
