// ======================================================
// 🧠 QuickChatX Diagnostic Script — verifySyncStatus.js
// ======================================================
// Verifica si MongoDB, NewsScheduler y YouTubeScheduler
// están funcionando correctamente cada 20 minutos.
// ======================================================

import chalk from "chalk";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/quickchatx";

console.log(chalk.cyan("\n🔍 Verificando estado del backend QuickChatX...\n"));

async function verifyMongoConnection() {
  try {
    await mongoose.connect(MONGO_URI, { connectTimeoutMS: 5000 });
    console.log(chalk.green("✅ Conexión MongoDB establecida correctamente"));
  } catch (err) {
    console.error(chalk.red("❌ Error conectando a MongoDB:"), err.message);
    process.exit(1);
  }
}

async function checkCollections() {
  const db = mongoose.connection.db;

  const newsCount = await db.collection("news").countDocuments().catch(() => 0);
  const ytCount = await db.collection("youtubevideos").countDocuments().catch(() => 0);

  console.log(chalk.yellow(`📰 Total noticias: ${newsCount}`));
  console.log(chalk.yellow(`🎬 Total videos YouTube: ${ytCount}`));

  const lastNews = await db.collection("news").find().sort({ publishedAt: -1 }).limit(1).toArray();
  const lastVideo = await db.collection("youtubevideos").find().sort({ publishedAt: -1 }).limit(1).toArray();

  if (lastNews.length)
    console.log(chalk.green(`🕒 Última noticia: ${lastNews[0].publishedAt || lastNews[0].createdAt}`));
  else console.log(chalk.gray("⚠️ No se encontraron noticias en la base de datos."));

  if (lastVideo.length)
    console.log(chalk.green(`🕒 Último video: ${lastVideo[0].publishedAt || lastVideo[0].createdAt}`));
  else console.log(chalk.gray("⚠️ No se encontraron videos en la base de datos."));

  // Verifica antigüedad de actualizaciones
  const now = Date.now();
  const newsAge = lastNews.length ? now - new Date(lastNews[0].publishedAt || lastNews[0].createdAt).getTime() : null;
  const videoAge = lastVideo.length ? now - new Date(lastVideo[0].publishedAt || lastVideo[0].createdAt).getTime() : null;

  const min20 = 20 * 60 * 1000;

  if (newsAge && newsAge < min20 * 1.5) {
    console.log(chalk.green("🟢 Noticias actualizadas recientemente (< 30 min)"));
  } else {
    console.log(chalk.red("🔴 Noticias NO se han actualizado en las últimas 30 min"));
  }

  if (videoAge && videoAge < min20 * 1.5) {
    console.log(chalk.green("🟢 Videos de YouTube actualizados recientemente (< 30 min)"));
  } else {
    console.log(chalk.red("🔴 Videos de YouTube NO se han actualizado en las últimas 30 min"));
  }

  await mongoose.disconnect();
  console.log(chalk.gray("\n🧩 Diagnóstico completado.\n"));
}

(async () => {
  await verifyMongoConnection();
  await checkCollections();
})();
