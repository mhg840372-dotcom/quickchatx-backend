// ======================================================
// 🧩 TopicClassifierService.js — v2.0 OPT (2025)
// ------------------------------------------------------
// ✔ Normaliza texto a ASCII (sin tildes)
// ✔ Tokens + frases + hashtags (#nba, #f1, #politica)
// ✔ Cache ligera para textos cortos
// ✔ 100% compatible con PostService v14.9
// ======================================================

const TOPIC_RULES = [
  {
    topic: "deportes",
    keywords: [
      "futbol",
      "basket",
      "nba",
      "liga",
      "gol",
      "partido",
      "mundial",
      "champions",
      "tenis",
      "deporte",
      "formula1",
      "f1",
      "premier",
      "messi",
      "ronaldo",
    ],
    phrases: ["copa del mundo", "champions league", "juegos olimpicos"],
    hashtags: ["sports"],
  },
  {
    topic: "musica",
    keywords: [
      "musica",
      "cancion",
      "album",
      "concierto",
      "banda",
      "dj",
      "rock",
      "reggaeton",
      "trap",
      "rap",
      "playlist",
      "spotify",
    ],
    phrases: ["nuevo album", "nueva cancion"],
    hashtags: ["music"],
  },
  {
    topic: "politica",
    keywords: [
      "politica",
      "eleccion",
      "elecciones",
      "gobierno",
      "presidente",
      "parlamento",
      "senado",
      "diputado",
      "voto",
      "partido politico",
    ],
    phrases: ["campana electoral", "debate electoral"],
    hashtags: ["politics"],
  },
  {
    topic: "guerra",
    keywords: [
      "guerra",
      "conflicto",
      "ataque",
      "bombardeo",
      "frente",
      "tropas",
      "soldados",
      "invasion",
    ],
    phrases: ["alto al fuego", "frente de batalla"],
    hashtags: ["war"],
  },
  {
    topic: "clima",
    keywords: [
      "clima",
      "tiempo",
      "lluvia",
      "tormenta",
      "temperatura",
      "frio",
      "calor",
      "nieve",
      "calima",
    ],
    phrases: ["ola de calor", "cambio climatico"],
    hashtags: ["weather"],
  },
  {
    topic: "comedia",
    keywords: [
      "chiste",
      "broma",
      "comedia",
      "humor",
      "gracioso",
      "risa",
      "jajaja",
      "jaja",
    ],
    phrases: ["stand up", "one liner"],
    hashtags: ["funny"],
  },
  {
    topic: "peliculas",
    keywords: [
      "pelicula",
      "cine",
      "netflix",
      "hbo",
      "serie",
      "actor",
      "actriz",
      "estreno",
      "taquilla",
    ],
    phrases: ["premios oscar", "carta de casting"],
    hashtags: ["movies", "series"],
  },
  {
    topic: "animados",
    keywords: [
      "anime",
      "animado",
      "caricatura",
      "dibujos",
      "manga",
      "pixar",
      "disney",
      "otaku",
    ],
    phrases: ["studio ghibli", "serie animada"],
    hashtags: ["anime"],
  },
  {
    topic: "memes",
    keywords: [
      "meme",
      "shitpost",
      "trolleada",
      "troleo",
      "plantilla",
      "cringe",
      "lol",
    ],
    phrases: ["plantilla de meme"],
    hashtags: ["memes"],
  },
  {
    topic: "finanzas",
    keywords: [
      "banco",
      "tarjeta",
      "credito",
      "prestamo",
      "interes",
      "cuenta",
      "transferencia",
      "cripto",
      "bitcoin",
      "ethereum",
      "dolar",
      "inversion",
      "acciones",
      "bolsa",
      "inflacion",
    ],
    phrases: ["mercado bursatil", "tasa de interes"],
    hashtags: ["finance", "stocks", "crypto"],
  },
];

const KEYWORD_INDEX = new Map();
const PHRASE_RULES = [];
const CACHE = new Map();
const CACHE_LIMIT = 200;

const normalizeText = (text = "") =>
  text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const tokenize = (normalized = "") =>
  normalized
    .split(/[^a-z0-9#]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

const buildIndexes = () => {
  for (const rule of TOPIC_RULES) {
    const topic = rule.topic;

    for (const kw of rule.keywords || []) {
      KEYWORD_INDEX.set(normalizeText(kw), topic);
    }

    for (const hash of rule.hashtags || []) {
      KEYWORD_INDEX.set(normalizeText(hash), topic);
    }

    for (const phrase of rule.phrases || []) {
      const normalized = normalizeText(phrase);
      if (normalized) PHRASE_RULES.push({ topic, phrase: normalized });
    }
  }
};

buildIndexes();

const cacheGet = (key) => CACHE.get(key);
const cacheSet = (key, value) => {
  if (CACHE.size >= CACHE_LIMIT) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
  CACHE.set(key, value);
};

class TopicClassifierServiceClass {
  async classifyText(text) {
    const normalized = normalizeText(text);
    if (!normalized.trim()) return [];

    const cacheKey = normalized.length <= 512 ? normalized : null;
    if (cacheKey) {
      const cached = cacheGet(cacheKey);
      if (cached) return cached;
    }

    const topics = new Set();
    const tokens = tokenize(normalized);

    for (const token of tokens) {
      const baseToken = token.startsWith("#") ? token.slice(1) : token;
      const topic = KEYWORD_INDEX.get(baseToken);
      if (topic) topics.add(topic);
    }

    for (const { topic, phrase } of PHRASE_RULES) {
      if (normalized.includes(phrase)) topics.add(topic);
    }

    const result = Array.from(topics);
    if (cacheKey) cacheSet(cacheKey, result);
    return result;
  }

  async classifyPost({ content = "", title = "", summary = "" }) {
    const pieces = [content, title, summary]
      .filter(Boolean)
      .join(". ")
      .slice(0, 8000);

    const topics = await this.classifyText(pieces);
    return topics;
  }
}

export const TopicClassifierService = new TopicClassifierServiceClass();
export default TopicClassifierService;
