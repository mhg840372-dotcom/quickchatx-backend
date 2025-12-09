// ======================================================
// 🌍 MediastackProvider.js
// ✅ Fuente alternativa de noticias deportivas y globales (QuickChatX)
// ======================================================

import axios from "axios";
import chalk from "chalk";

const MEDIASTACK_API = "http://api.mediastack.com/v1/news";
const API_KEY = process.env.MEDIASTACK_KEY;

/**
 * Obtiene noticias desde Mediastack filtradas por tema, idioma y país.
 * Soporta temas como "La Liga", "fútbol", "deportes", etc.
 */
export async function fetchMediastackNews(query = "deportes", lang = "es", country = "es") {
  if (!API_KEY) {
    console.warn(chalk.yellow("⚠️ MEDIASTACK_KEY no configurada"));
    return [];
  }

  try {
    // 🔍 Normaliza búsquedas comunes
    const searchTopics = {
      "la liga": "La Liga,fútbol,Real Madrid,Barcelona",
      futbol: "fútbol,Champions League,La Liga,selección española",
      deportes: "deportes,fútbol,baloncesto,tenis",
      europa: "UEFA,Champions League,Europa League",
      italia: "Serie A,fútbol italiano,Inter de Milán,Juventus",
    };

    const keywords = searchTopics[query.toLowerCase()] || query;

    const params = new URLSearchParams({
      access_key: API_KEY,
      keywords: keywords,
      languages: lang,
      countries: country,
      limit: 30,
      sort: "published_desc",
    });

    const url = `${MEDIASTACK_API}?${params.toString()}`;
    const { data } = await axios.get(url);

    if (!data || !data.data) {
      console.warn(chalk.yellow(`⚠️ Sin resultados para query: ${query}`));
      return [];
    }

    // 📰 Normaliza estructura de noticia
    return data.data.map((item) => ({
      title: item.title,
      description: item.description,
      source: item.source,
      published_at: item.published_at,
      url: item.url,
      image: item.image,
      category: item.category,
      country: item.country,
      language: item.language,
      provider: "mediastack",
    }));
  } catch (err) {
    console.error(chalk.red("❌ Error al obtener noticias de Mediastack:"), err.message);
    return [];
  }
}

/**
 * 🚀 Ejemplo rápido de uso:
 * const noticias = await fetchMediastackNews("la liga", "es", "es");
 * console.log(noticias);
 */
