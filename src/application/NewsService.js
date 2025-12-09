// ======================================================
// 📰 QuickChatX v8.6 — Servicio central de noticias (compat total)
// ======================================================
// 🌐 Cron cada 20 min (NewsAPI / TheNewsAPI / GNews)
// ❤️ Soporte de likes en noticias (toggleLike)
// ✅ Alias getLatest para newsRoutes / feedController
// ✅ Métodos createOrUpdate / deleteById para admin
// ✅ Usa exactamente las claves de .env:
//    - NEWSAPI_KEY, NEWSAPI_KEY_2, NEWSAPI_KEY_3
//    - GNEWS_KEY, GNEWS_KEY_2
//    - THENEWSAPI_KEY, THENEWSAPI_KEY_2
// ✅ Compatibilidad completa con:
//    - import { NewsService } from "..."
//    - import NewsService from "..."
//    - NewsService.fetchAndSave(...)
//    - instancia.fetchAndSave(...)
// ======================================================

import chalk from "chalk";
import { WebSocketServer, WebSocket } from "ws";
import { MongoProvider } from "../infrastructure/MongoProvider.js";
import { News } from "../domain/News.js";
import { ApiKeyManager } from "../infrastructure/ApiKeyManager.js";
import cron from "node-cron";
import moment from "moment-timezone";
import fetch from "node-fetch";
import { UserInterestService } from "./UserInterestService.js";

// ======================================================
// ⚙️ Configuración desde .env
// ======================================================
const DEFAULT_LANG = (process.env.NEWS_LANG || "es").toLowerCase();
const DEFAULT_COUNTRY = (process.env.NEWS_COUNTRY || "us").toLowerCase();

const VALID_COUNTRIES = new Set([
  "us",
  "gb",
  "es",
  "mx",
  "ar",
  "co",
  "cl",
  "pe",
  "br",
  "de",
  "fr",
  "it",
  "nl",
  "se",
  "no",
  "jp",
  "kr",
  "in",
]);

const VALID_LANGS = new Set(["es", "en", "pt", "fr"]);

// Temas desde .env (para periodicUpdate)
const DEFAULT_TOPICS = [
  "tecnología",
  "clima",
  "política",
  "economía",
  "ciencia",
  "deportes",
];

function getNewsTopicsFromEnv() {
  const raw = process.env.NEWS_TOPICS;
  if (!raw) return DEFAULT_TOPICS;
  const list = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_TOPICS;
}

// ======================================================
// 🔑 Helpers para leer claves desde .env
// ======================================================
const newsApiKeys = [
  process.env.NEWSAPI_KEY,
  process.env.NEWSAPI_KEY_2,
  process.env.NEWSAPI_KEY_3,
].filter(Boolean);

const gnewsKeys = [process.env.GNEWS_KEY, process.env.GNEWS_KEY_2].filter(
  Boolean
);

const theNewsApiKeys = [
  process.env.THENEWSAPI_KEY,
  process.env.THENEWSAPI_KEY_2,
].filter(Boolean);

// ======================================================
// 🔑 Gestores de Claves (con Redis + fallback local)
// ======================================================
const newsApiManager = new ApiKeyManager({
  name: "NewsAPI",
  keys: newsApiKeys,
});

const gnewsManager = new ApiKeyManager({
  name: "GNews",
  keys: gnewsKeys,
});

const theNewsManager = new ApiKeyManager({
  name: "TheNewsAPI",
  keys: theNewsApiKeys,
});

// Inicializamos los gestores (top-level await en ESM)
await Promise.all([
  newsApiManager.initialize(),
  gnewsManager.initialize(),
  theNewsManager.initialize(),
]);

if (!newsApiKeys.length && !gnewsKeys.length && !theNewsApiKeys.length) {
  console.warn(
    chalk.yellow(
      "⚠️ NewsService: no hay API keys de noticias configuradas. No se obtendrán noticias externas."
    )
  );
}

// ======================================================
// 🌐 WebSocket /ws/news
// ======================================================
const wsClients = new Set();

// Constante segura para estado OPEN (fallback a 1)
const WS_OPEN =
  (typeof WebSocket !== "undefined" && typeof WebSocket.OPEN === "number"
    ? WebSocket.OPEN
    : 1);

export const initNewsWebSocket = (server) => {
  const wss = new WebSocketServer({ server, path: "/ws/news" });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(
      chalk.green(`🟢 Cliente WS noticias conectado (${wsClients.size})`)
    );
    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(
        chalk.red(`🔴 Cliente WS noticias desconectado (${wsClients.size})`)
      );
    });
  });

  console.log(chalk.cyan("🌐 Canal WebSocket /ws/news listo"));
};

const broadcastNewsUpdate = (newsArray) => {
  if (!newsArray?.length) return;
  const payload = JSON.stringify({ type: "news_update", data: newsArray });

  for (const ws of wsClients) {
    try {
      if (ws && ws.readyState === WS_OPEN) {
        ws.send(payload);
      }
    } catch (err) {
      console.warn(
        chalk.yellow("⚠️ Error enviando actualización de noticias por WS:"),
        err?.message || err
      );
    }
  }
};

// ======================================================
// 🧩 Servicio Principal (CLASE)
// ======================================================
class NewsServiceClass {
  static collection = null;
  static initialized = false;

  constructor() {
    // compat para usar `new NewsService()`
  }

  static async initialize(force = false) {
    if (this.initialized && !force) return true;

    if (!MongoProvider.isConnected()) {
      await MongoProvider.waitForConnection(10_000);
      if (!MongoProvider.isConnected())
        throw new Error("MongoDB no disponible");
    }

    this.collection = MongoProvider.collection("news");

    // Índices defensivos: si algo falla, logueamos pero no rompemos el servicio
    try {
      await this.collection.createIndex(
        { url: 1 },
        { unique: true, sparse: true }
      );
      await this.collection.createIndex({ category: 1 });
      await this.collection.createIndex({ publishedAt: -1 });
    } catch (err) {
      console.warn(
        chalk.yellow("⚠️ Error creando índices en NewsService:"),
        err?.message || err
      );
    }

    this.initialized = true;
    console.log(chalk.green("🧩 NewsService inicializado correctamente"));
    return true;
  }

  // ======================================================
  // 🔍 Fetchers externos (rotación automática de claves)
  // ======================================================
  static async fetchFromNewsAPI(topic, lang, country, limit = 20) {
    const key = await newsApiManager.getActiveKey();
    if (!key) return [];

    try {
      const qs = new URLSearchParams({
        apiKey: key,
        language: lang,
        pageSize: String(limit),
      });

      const lower = String(topic || "").toLowerCase().trim();

      let url;
      if (["economía", "economia", "business"].includes(lower)) {
        qs.set("country", country || "us");
        qs.set("category", "business");
        url = `https://newsapi.org/v2/top-headlines?${qs.toString()}`;
      } else if (["tecnología", "tecnologia", "tech"].includes(lower)) {
        qs.set("country", country || "us");
        qs.set("category", "technology");
        url = `https://newsapi.org/v2/top-headlines?${qs.toString()}`;
      } else {
        qs.set("q", topic || "noticias");
        url = `https://newsapi.org/v2/everything?${qs.toString()}`;
      }

      const res = await fetch(url);
      const json = await res.json();

      if (json.status === "error") {
        await newsApiManager.handleApiError(
          key,
          json.message || json.code || "unknown_error"
        );
        console.warn(
          chalk.yellow(
            `⚠️ NewsAPI sin datos para "${topic}" (lang=${lang}, country=${country}) → ${json.code || ""} ${json.message || ""}`
          )
        );
        return [];
      }

      const articles = json.articles?.slice(0, limit) || [];
      if (!articles.length) {
        console.log(
          chalk.gray(
            `ℹ️ NewsAPI devolvió 0 artículos para "${topic}" (lang=${lang}, country=${country})`
          )
        );
      }
      return articles;
    } catch (err) {
      await newsApiManager.handleApiError(key, err.message);
      console.warn(
        chalk.yellow(`⚠️ Error fetchFromNewsAPI("${topic}"):`),
        err.message
      );
      return [];
    }
  }

  static async fetchFromTheNewsAPI(topic, lang, country, limit = 20) {
    const key = await theNewsManager.getActiveKey();
    if (!key) return [];

    try {
      const qs = new URLSearchParams({
        api_token: key,
        search: topic,
        language: lang,
        limit: String(limit),
      });

      if (country) qs.set("locale", country);

      const url = `https://api.thenewsapi.com/v1/news/all?${qs.toString()}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.error) {
        const msg =
          json.error?.message ||
          json.error?.code ||
          (typeof json.error === "string" ? json.error : "unknown_error");
        await theNewsManager.handleApiError(key, msg);
        console.warn(
          chalk.yellow(
            `⚠️ TheNewsAPI error para "${topic}" (lang=${lang}, country=${country}) → ${msg}`
          )
        );
        return [];
      }

      const data = json.data?.slice(0, limit) || [];
      if (!data.length) {
        console.log(
          chalk.gray(
            `ℹ️ TheNewsAPI devolvió 0 artículos para "${topic}" (lang=${lang}, country=${country})`
          )
        );
      }

      return data;
    } catch (err) {
      await theNewsManager.handleApiError(key, err.message);
      console.warn(
        chalk.yellow(`⚠️ Error fetchFromTheNewsAPI("${topic}"):`),
        err.message
      );
      return [];
    }
  }

  static async fetchFromGNews(topic, lang, country, limit = 20) {
    const key = await gnewsManager.getActiveKey();
    if (!key) return [];

    try {
      const qs = new URLSearchParams({
        token: key,
        q: topic,
        lang,
        country,
        max: String(limit),
      });

      const url = `https://gnews.io/api/v4/search?${qs.toString()}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.error || json.errors) {
        await gnewsManager.handleApiError(
          key,
          json.error || json.errors || "unknown_error"
        );
        console.warn(
          chalk.yellow(
            `⚠️ GNews error para "${topic}" (lang=${lang}, country=${country})`
          )
        );
        return [];
      }

      const articles = json.articles?.slice(0, limit) || [];
      if (!articles.length) {
        console.log(
          chalk.gray(
            `ℹ️ GNews devolvió 0 artículos para "${topic}" (lang=${lang}, country=${country})`
          )
        );
      }
      return articles;
    } catch (err) {
      await gnewsManager.handleApiError(key, err.message);
      console.warn(
        chalk.yellow(`⚠️ Error fetchFromGNews("${topic}"):`),
        err.message
      );
      return [];
    }
  }

  // ======================================================
  // 🧠 fetchAndSave — ejecutado SOLO por el backend
  // ======================================================
  static async fetchAndSave(
    topic = "noticias",
    lang = DEFAULT_LANG,
    country = DEFAULT_COUNTRY,
    limit = 20
  ) {
    await this.initialize();

    const hl = VALID_LANGS.has(lang) ? lang : DEFAULT_LANG;
    const gl = VALID_COUNTRIES.has(country) ? country : DEFAULT_COUNTRY;

    const providers = [
      { name: "NewsAPI", fn: this.fetchFromNewsAPI },
      { name: "TheNewsAPI", fn: this.fetchFromTheNewsAPI },
      { name: "GNews", fn: this.fetchFromGNews },
    ];

    const tryFetchWith = async (language, countryCode, label) => {
      for (const p of providers) {
        const raw = await p.fn.call(this, topic, language, countryCode, limit);
        if (Array.isArray(raw) && raw.length) {
          console.log(
            chalk.cyan(
              `📡 Proveedor ${p.name} (${label}) devolvió ${raw.length} artículos para "${topic}" (lang=${language}, country=${countryCode})`
            )
          );
          return raw;
        }
      }
      return [];
    };

    // 1️⃣ Intento en idioma/config preferido
    let raw = await tryFetchWith(hl, gl, "primary");

    // 2️⃣ Fallback a en/us si no hay nada
    if (!raw.length && hl !== "en") {
      console.warn(
        chalk.yellow(
          `⚠️ Sin resultados para "${topic}" en lang=${hl}, country=${gl}. Reintentando con lang=en, country=us...`
        )
      );
      raw = await tryFetchWith("en", "us", "fallback_en_us");
    }

    if (!raw.length) {
      console.warn(chalk.yellow(`⚠️ No se obtuvieron noticias para "${topic}"`));
      return [];
    }

    const normalized = raw.map((r) => ({
      title: r.title || "Sin título",
      description: r.description || r.snippet || "",
      url: r.url || r.link || "",
      image:
        r.urlToImage ||
        r.image_url ||
        r.image ||
        r.thumbnail ||
        r.imageUrl ||
        "",
      source:
        (r.source && r.source.name) ||
        r.source ||
        r.publisher ||
        r.domain ||
        "Desconocido",
      category: topic,
      publishedAt:
        r.publishedAt ||
        r.published_at ||
        r.date ||
        r.published ||
        new Date(),
    }));

    const unique = Array.from(
      new Map(normalized.map((n) => [n.url || n.title, n])).values()
    ).slice(0, limit);

    const saved = [];

    for (const item of unique) {
      try {
        const { value } = await this.collection.findOneAndUpdate(
          { url: item.url },
          { $set: item },
          { upsert: true, returnDocument: "after" }
        );
        if (value) saved.push(value);
      } catch (err) {
        if (!/duplicate/i.test(err.message)) {
          console.error("❌ Error guardando noticia:", err.message);
        }
      }
    }

    if (saved.length) {
      console.log(
        chalk.green(`🆕 ${saved.length} nuevas noticias guardadas (${topic})`)
      );
      const payload = saved.map((d) => new News(d).toJSON());
      broadcastNewsUpdate(payload);
      return payload;
    }

    console.log(
      chalk.yellow(
        `🟡 No hay noticias nuevas (todas eran duplicadas) para "${topic}"`
      )
    );

    return [];
  }

  // ======================================================
  // 📅 Actualización periódica (solo backend)
  // ======================================================
  static async periodicUpdate() {
    await this.initialize();

    const topics = getNewsTopicsFromEnv();
    const all = [];

    for (const t of topics) {
      console.log(chalk.yellow(`📰 Buscando noticias sobre: ${t}...`));
      try {
        const res = await this.fetchAndSave(
          t,
          DEFAULT_LANG,
          DEFAULT_COUNTRY,
          15
        );
        all.push(...res);
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠️ Error al obtener noticias de ${t}: ${err?.message || err}`
          )
        );
      }
    }

    console.log(
      chalk.cyan(
        `📰 Actualización completada (${all.length} artículos totales en ciclo)`
      )
    );
  }

  // ======================================================
  // ⏰ Cron cada 20 minutos
  // ======================================================
  static startAutoCron() {
    if (process.env.ENABLE_NEWS_SERVICE === "false") {
      console.log(
        chalk.gray("⏰ Cron de noticias deshabilitado por ENABLE_NEWS_SERVICE=false")
      );
      return;
    }

    const tz = "America/Mexico_City";
    cron.schedule(
      "*/20 * * * *",
      async () => {
        console.log(
          chalk.blueBright(
            `🔁 CRON NewsService (20 min) — ${moment()
              .tz(tz)
              .format("YYYY-MM-DD HH:mm")}`
          )
        );
        try {
          await this.periodicUpdate();
        } catch (err) {
          console.error("❌ Error en periodicUpdate de noticias:", err);
        }
      },
      { timezone: tz }
    );
    console.log(
      chalk.green("⏰ Cron automático de noticias activo cada 20 min (NewsService)")
    );
  }

  // ======================================================
  // 📦 Métodos de lectura (Frontend / Feed / API)
  // ======================================================
  static async getLatestNews({ limit = 50, skip = 0 } = {}) {
    await this.initialize();
    const docs = await this.collection
      .find({})
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return docs.map((d) => new News(d).toJSON());
  }

  // Alias para compat con newsRoutes
  static async getLatest(options = {}) {
    return this.getLatestNews(options);
  }

  static async getById(id) {
    await this.initialize();
    const { ObjectId } = await MongoProvider.importObjectId();
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? new News(doc).toJSON() : null;
  }

  // Compat con feedController.getFeed()
  static async getAll({ limit = 50, skip = 0 } = {}) {
    return this.getLatestNews({ limit, skip });
  }

  // Instancia (por si usan new NewsService())
  async getAll(options = {}) {
    return NewsServiceClass.getAll(options);
  }

  // ======================================================
  // 🆕 Crear / actualizar manualmente (admin)
  // ======================================================
  static async createOrUpdate(data = {}) {
    await this.initialize();
    if (!data || !data.url) throw new Error("Campo url obligatorio");

    const { value } = await this.collection.findOneAndUpdate(
      { url: data.url },
      { $set: data },
      { upsert: true, returnDocument: "after" }
    );

    return value;
  }

  static async deleteById(id) {
    await this.initialize();
    const { ObjectId } = await MongoProvider.importObjectId();
    const res = await this.collection.deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount > 0;
  }

  // ======================================================
  // ❤️ Like noticia
  // ======================================================
  static async toggleLike({ newsId, userId, value = 1 } = {}) {
    if (!newsId || !userId) {
      throw new Error("newsId y userId son obligatorios");
    }

    await this.initialize();

    const newsDoc = await News.findById(newsId);
    if (!newsDoc) {
      throw new Error("Noticia no encontrada");
    }

    const uid = String(userId);

    newsDoc.likes = Array.isArray(newsDoc.likes) ? newsDoc.likes : [];
    newsDoc.dislikes = Array.isArray(newsDoc.dislikes)
      ? newsDoc.dislikes
      : [];

    // quitar previos
    newsDoc.likes = newsDoc.likes.filter((id) => String(id) !== uid);
    newsDoc.dislikes = newsDoc.dislikes.filter(
      (id) => String(id) !== uid
    );

    if (value === 1) {
      newsDoc.likes.push(uid);
    } else if (value === -1) {
      newsDoc.dislikes.push(uid);
    }

    await newsDoc.save();

    const json = newsDoc.toJSON
      ? newsDoc.toJSON()
      : { id: newsDoc._id?.toString() };

    const likesArr = Array.isArray(newsDoc.likes) ? newsDoc.likes : [];
    const dislikesArr = Array.isArray(newsDoc.dislikes)
      ? newsDoc.dislikes
      : [];

    const result = {
      ...json,
      likes: likesArr,
      dislikes: dislikesArr,
      likesCount: likesArr.length,
      dislikesCount: dislikesArr.length,
      likedByUser: value === 1,
    };

    try {
      if (UserInterestService?.registerNewsInteraction) {
        await UserInterestService.registerNewsInteraction({
          userId,
          news: result,
          type: value === 1 ? "like" : "dislike",
        });
      }
    } catch (err) {
      console.warn(
        chalk.yellow("⚠️ Error registrando interacción de noticia:"),
        err.message
      );
    }

    console.log(
      chalk.green(
        `📰 Like noticia → user=${userId} news=${newsId} likes=${likesArr.length}`
      )
    );

    return result;
  }

  // versión de instancia
  async toggleLike(params = {}) {
    return NewsServiceClass.toggleLike(params);
  }
}

// ======================================================
// 🧷 Compatibilidad de exports
// ======================================================

// 1) named export "NewsService" → la CLASE (para new NewsService(), métodos estáticos, etc.)
export { NewsServiceClass as NewsService };

// 2) Singleton para código que hace `import NewsService from ...` o espera instancia
const newsServiceSingleton = new NewsServiceClass();

// Copiamos métodos estáticos al singleton para compat total
const staticMethodsToBind = [
  "initialize",
  "fetchFromNewsAPI",
  "fetchFromTheNewsAPI",
  "fetchFromGNews",
  "fetchAndSave",
  "periodicUpdate",
  "startAutoCron",
  "getLatestNews",
  "getLatest",
  "getById",
  "getAll",
  "createOrUpdate",
  "deleteById",
  "toggleLike",
];

for (const name of staticMethodsToBind) {
  if (typeof NewsServiceClass[name] === "function") {
    // @ts-ignore
    newsServiceSingleton[name] = NewsServiceClass[name].bind(NewsServiceClass);
  }
}

// 3) export default → singleton compatible
export default newsServiceSingleton;

// ======================================================
// ⏰ Iniciar cron tras 5 segundos
// ======================================================
setTimeout(() => {
  if (process.env.ENABLE_NEWS_SERVICE !== "false") {
    if (typeof NewsServiceClass.startAutoCron === "function") {
      NewsServiceClass.startAutoCron();
    } else {
      console.warn("⚠️ NewsService.startAutoCron no está definido");
    }
  } else {
    console.log("ℹ️ Cron de NewsService NO iniciado (ENABLE_NEWS_SERVICE=false)");
  }
}, 5000);
