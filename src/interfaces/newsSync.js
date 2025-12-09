// ======================================================
// 📰 newsSync.js — QuickChatX v3.2 (LEGACY / OPCIONAL)
// ------------------------------------------------------
// ✅ Proveedores activos:
//    - GNews        → GNEWS_KEY / GNEWS_KEY_2
//    - NewsAPI      → NEWSAPI_KEY / NEWSAPI_KEY_2 / NEWSAPI_KEY_3
//    - TheNewsAPI   → THENEWSAPI_KEY / THENEWSAPI_KEY_2
// ✅ Traducción opcional a ES con DeepL (DEEPL_API_KEY)
// ✅ Guarda / actualiza en News (upsert por URL)
// ⚠️ No se usa en el flujo normal del backend (NewsService v8.x).
//    Úsalo solo como script manual si quieres rellenar la BD.
// ======================================================

import fetch from "node-fetch";
import { News } from "../domain/News.js";

const {
  NEWSAPI_KEY,
  NEWSAPI_KEY_2,
  NEWSAPI_KEY_3,
  GNEWS_KEY,
  GNEWS_KEY_2,
  THENEWSAPI_KEY,
  THENEWSAPI_KEY_2,
  DEEPL_API_KEY,
} = process.env;

const pickKey = (...keys) => keys.find(Boolean) || null;

// Detecta inglés muy simple
const isEnglish = (text) => {
  if (!text || typeof text !== "string") return false;
  const letters = text.match(/[a-zA-Z]/g) || [];
  if (!letters.length) return false;
  const englishRatio = letters.length / text.length;
  const spanishChars = /[áéíóúñ¿¡]/i.test(text);
  return englishRatio > 0.6 && !spanishChars;
};

const translateText = async (text) => {
  if (!text || typeof text !== "string") return text;
  if (!DEEPL_API_KEY) return text;
  if (!isEnglish(text)) return text;

  try {
    const res = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `auth_key=${DEEPL_API_KEY}&text=${encodeURIComponent(
        text
      )}&target_lang=ES`,
    });

    const json = await res.json();
    if (
      json?.translations &&
      Array.isArray(json.translations) &&
      json.translations[0]?.text
    ) {
      return json.translations[0].text;
    }
    return text;
  } catch (err) {
    console.warn("⚠️ DeepL translation error:", err?.message || err);
    return text;
  }
};

const safeDate = (value) => {
  try {
    const d = value ? new Date(value) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  } catch {
    return new Date();
  }
};

const normalizeArticle = (a = {}) => ({
  title: a.title,
  description: a.description,
  url: a.url,
  image: a.image || a.image_url || a.urlToImage || null,
  source: a.source || "Unknown",
  publishedAt: safeDate(a.publishedAt),
});

// GNews
const fetchGNews = async () => {
  const apiKey = pickKey(GNEWS_KEY, GNEWS_KEY_2);
  if (!apiKey) {
    console.warn("⚠️ GNews: no hay API key definida");
    return [];
  }

  const SOURCES = [
    `https://gnews.io/api/v4/search?q=apple&lang=en&country=us&max=10&apikey=${apiKey}`,
    `https://gnews.io/api/v4/search?q=tesla&lang=en&country=us&max=10&apikey=${apiKey}`,
    `https://gnews.io/api/v4/top-headlines?lang=en&country=us&max=10&topic=business&apikey=${apiKey}`,
    `https://gnews.io/api/v4/top-headlines?lang=en&country=us&max=10&topic=technology&apikey=${apiKey}`,
    `https://gnews.io/api/v4/top-headlines?lang=en&country=us&max=10&topic=world&apikey=${apiKey}`,
  ];

  let articles = [];

  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (Array.isArray(json.articles)) {
        articles = articles.concat(
          json.articles.map((a) =>
            normalizeArticle({
              title: a.title,
              description: a.description,
              url: a.url,
              image: a.image,
              source: (a.source && a.source.name) || "GNews",
              publishedAt: a.publishedAt,
            })
          )
        );
      }
    } catch (err) {
      console.warn("⚠️ GNews fetch error:", err?.message || err);
    }
  }

  return articles;
};

// NewsAPI
const fetchNewsAPI = async () => {
  const apiKey = pickKey(NEWSAPI_KEY, NEWSAPI_KEY_2, NEWSAPI_KEY_3);
  if (!apiKey) {
    console.warn("⚠️ NewsAPI: no hay API key definida");
    return [];
  }

  const URLS = [
    `https://newsapi.org/v2/top-headlines?language=en&category=technology&pageSize=20&apiKey=${apiKey}`,
    `https://newsapi.org/v2/top-headlines?language=en&category=business&pageSize=20&apiKey=${apiKey}`,
  ];

  let articles = [];

  for (const url of URLS) {
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (Array.isArray(json.articles)) {
        articles = articles.concat(
          json.articles.map((a) =>
            normalizeArticle({
              title: a.title,
              description: a.description,
              url: a.url,
              image: a.urlToImage,
              source: (a.source && a.source.name) || "NewsAPI",
              publishedAt: a.publishedAt,
            })
          )
        );
      } else if (json.status === "error") {
        console.warn("⚠️ NewsAPI error:", json.code, json.message);
      }
    } catch (err) {
      console.warn("⚠️ NewsAPI fetch error:", err?.message || err);
    }
  }

  return articles;
};

// TheNewsAPI
const fetchTheNewsAPI = async () => {
  const apiKey = pickKey(THENEWSAPI_KEY, THENEWSAPI_KEY_2);
  if (!apiKey) {
    console.warn("⚠️ TheNewsAPI: no hay API key definida");
    return [];
  }

  const url = `https://api.thenewsapi.com/v1/news/top?api_token=${apiKey}&language=en&categories=tech,business&limit=30`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (!Array.isArray(json.data)) {
      if (json.error) {
        console.warn("⚠️ TheNewsAPI error:", json.error);
      }
      return [];
    }

    return json.data.map((a) =>
      normalizeArticle({
        title: a.title,
        description: a.description || a.snippet,
        url: a.url,
        image: a.image_url,
        source: a.source || "TheNewsAPI",
        publishedAt: a.published_at,
      })
    );
  } catch (err) {
    console.warn("⚠️ TheNewsAPI fetch error:", err?.message || err);
    return [];
  }
};

// Función principal (manual / legacy)
export const syncNews = async () => {
  try {
    const [gnews, newsapi, thenews] = await Promise.all([
      fetchGNews(),
      fetchNewsAPI(),
      fetchTheNewsAPI(),
    ]);

    const allArticles = []
      .concat(gnews || [])
      .concat(newsapi || [])
      .concat(thenews || []);

    console.log(
      `📰 syncNews: recibidos ${allArticles.length} artículos en total`
    );

    let saved = 0;

    for (let i = 0; i < allArticles.length; i++) {
      const article = allArticles[i];
      if (!article.url || !article.title) continue;

      const title = await translateText(article.title);
      const description = article.description
        ? await translateText(article.description)
        : undefined;

      await News.updateOne(
        { url: article.url },
        {
          $set: {
            title,
            description,
            url: article.url,
            image: article.image,
            source: article.source,
            publishedAt: safeDate(article.publishedAt),
          },
        },
        { upsert: true }
      );

      saved++;
    }

    console.log(
      `✅ Sincronización de noticias completada (legacy syncNews). Guardados/actualizados: ${saved}.`
    );
  } catch (err) {
    console.error("❌ syncNews error:", err?.message || err);
  }
};
