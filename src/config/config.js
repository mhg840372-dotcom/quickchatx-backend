// ======================================================
// ⚙️ src/config/config.js
// ✅ QuickChatX v8.0.1 — Configuración central (SIN YouTube)
// ======================================================

import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();
console.log(chalk.cyan("🧩 Cargando configuración QuickChatX v8.0.1..."));

// ======================================================
// 🧰 Helper seguro para variables requeridas
// ======================================================
function required(name, fallback = null) {
  const value = process.env[name] ?? fallback;
  if (!value) console.warn(chalk.yellow(`⚠️ Variable de entorno faltante: ${name}`));
  return value;
}

// ======================================================
// 🧩 Utilidad para recoger claves múltiples consecutivas (.env con sufijos)
//   Ej: NEWSAPI_KEY_1, NEWSAPI_KEY_2, ..., NEWSAPI_KEY_10
// ======================================================
function collectKeys(prefix) {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`${prefix}_${i}`];
    if (val && val.trim().length > 0) keys.push(val.trim());
  }
  return keys;
}

// ======================================================
// 🔑 Agrupar claves de noticias (según tu .env actual)
//   NEWSAPI_KEY, NEWSAPI_KEY_2, NEWSAPI_KEY_3
//   GNEWS_KEY, GNEWS_KEY_2
//   THENEWSAPI_KEY, THENEWSAPI_KEY_2
// ======================================================
const newsApiKeys = [
  process.env.NEWSAPI_KEY,
  ...collectKeys("NEWSAPI_KEY"), // NEWSAPI_KEY_1..NEWSAPI_KEY_10 (incluye _2, _3 si existen)
].filter(Boolean);

const gnewsKeys = [
  process.env.GNEWS_KEY,
  ...collectKeys("GNEWS_KEY"), // GNEWS_KEY_1..GNEWS_KEY_10 (incluye GNEWS_KEY_2)
].filter(Boolean);

const theNewsApiKeys = [
  process.env.THENEWSAPI_KEY,
  ...collectKeys("THENEWSAPI_KEY"), // THENEWSAPI_KEY_1..THENEWSAPI_KEY_10 (incluye _2)
].filter(Boolean);

// ======================================================
// ⚙️ Config principal
// ======================================================
export const config = {
  // 🌐 Servidor
  server: {
    port: parseInt(required("PORT", 8085), 10),
    host: required("HOST", "0.0.0.0"),
    env: required("NODE_ENV", "development"),
  },

  // 🧩 MongoDB
  mongo: {
    uri: required("MONGODB_URI", "mongodb://localhost:27017"),
    dbName: required("MONGO_DB", "quickchatx"),
  },

  // 🔐 JWT
  jwt: {
    secret: required("JWT_SECRET", "changeme"),
    expiresIn: required("JWT_EXPIRES_IN", "7d"),
  },

  // 🔴 Redis
  redis: {
    mode: required("REDIS_MODE", "single"),
    host: required("REDIS_HOST", "127.0.0.1"),
    port: parseInt(required("REDIS_PORT", 6379), 10),
    db: parseInt(required("REDIS_DB", 0), 10),
    password: process.env.REDIS_PASSWORD || null,
    tls: process.env.REDIS_TLS === "true",
  },

// 🧾 Archivos
uploads: {
  // ⬅️ default a 500MB (alineado con uploadMiddleware)
  maxMb: parseInt(required("UPLOAD_MAX_MB", 500), 10),
  allowedExtensions: required(
    "ALLOWED_EXTENSIONS",
    "png,jpg,jpeg,gif,webp,mp4,webm"
  )
    .split(",")
    .map((x) => x.trim()),
  allowedMimeTypes: required(
    "ALLOWED_MIMETYPES",
    "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
  )
    .split(",")
    .map((x) => x.trim()),
  uploadDir: required("UPLOADS_DIR", "uploads"),
},

  // 📡 WebRTC / SFU (Cloudflare)
  webrtc: {
    provider: required("RTC_PROVIDER", "cloudflare"),
    appId: required("CLOUDFLARE_RTC_APP_ID", ""),
    apiToken: process.env.CLOUDFLARE_RTC_API_TOKEN || "",
    iceServers: required(
      "RTC_ICE_SERVERS",
      "stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302"
    )
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    ttlSeconds: parseInt(required("RTC_TTL_SECONDS", 3600), 10),
  },

  // 📰 Noticias (alineado con tus .env de NEWSAPI / GNEWS / THENEWSAPI)
  news: {
    // Arrays de claves (para rotación en ApiKeyManager u otros servicios)
    newsApiKeys,
    gnewsKeys,
    theNewsApiKeys,

    // Alias de compatibilidad (si algún código viejo usa solo una clave)
    newsApiKey: newsApiKeys[0] || "",
    gnewsKey: gnewsKeys[0] || "",
    theNewsApiKey: theNewsApiKeys[0] || "",

    topics: required(
      "NEWS_TOPICS",
      "tecnología,clima,política,economía,cine,estrenos Netflix"
    )
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),

    intervalMs: parseInt(required("NEWS_FETCH_INTERVAL_MS", 1200000), 10),
    maxResults: parseInt(required("MAX_RESULTS", 20), 10),

    lang: required("NEWS_LANG", "es"),
    country: required("NEWS_COUNTRY", "us"),
  },

  // 🤖 Telegram
  telegram: {
    botUrl: process.env.TELEGRAM_BOT_URL || "",
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    cooldownMs: parseInt(required("ALERT_COOLDOWN_MS", 60000), 10),
  },

  // 🧠 OpenAI / IA
  ai: {
    enabled: process.env.AI_SUMMARY_ENABLED === "true",
    apiKey: process.env.OPENAI_API_KEY || "",
    lang: required("AI_SUMMARY_LANG", "es"),
    model: required("AI_MODEL", "gpt-4o-mini"),
  },

  // ✉️ SendGrid
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY || "",
    from: process.env.SENDGRID_FROM || "no-reply@quickchatx.com",
  },

  // 🌐 CDN / Base URL para archivos
  cdn: {
    url: required("CDN_URL", "https://api.quickchatx.com"),
  },

  // 🌍 Frontend / CORS
  cors: {
    frontendUrl: required("FRONTEND_URL", "https://quickchatx.com"),
    allowedOrigins: required(
      "CORS_ALLOWED_ORIGINS",
      "https://quickchatx.com,https://www.quickchatx.com"
    )
      .split(",")
      .map((x) => x.trim()),
  },
};

// ======================================================
// 🧾 Alias de entorno para compatibilidad
// ======================================================
export const ENV = config.server.env;

// ======================================================
// 🧾 Log de resumen (solo fuera de producción)
// ======================================================
if (config.server.env !== "production") {
  console.log(chalk.gray("📦 Configuración cargada:"), {
    PORT: config.server.port,
    HOST: config.server.host,
    DB: config.mongo.dbName,
    REDIS: `${config.redis.host}:${config.redis.port}`,
    CDN_URL: config.cdn.url,
    NEWS_KEYS: {
      newsapi: config.news.newsApiKeys.length,
      gnews: config.news.gnewsKeys.length,
      theNewsApi: config.news.theNewsApiKeys.length,
    },
    AI: config.ai.enabled ? "✅ ON" : "❌ OFF",
  });
}

export default config;

// ======================================================
// ✅ QuickChatX v8.0.1 — Configuración (sin YouTube)
// ------------------------------------------------------
// • Usa NEWSAPI_KEY / _2 / _3, GNEWS_KEY / _2, THENEWSAPI_KEY / _2
// • Sin sección youtube ni SERPAPI en la config central
// • Exporta ENV para compatibilidad con servicios previos
// ======================================================
