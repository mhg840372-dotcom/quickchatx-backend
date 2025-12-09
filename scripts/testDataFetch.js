// ======================================================
// 🧪 QuickChatX — Test de extracción manual de APIs
// ✅ Compatibilidad v5.5.1 (News + YouTube)
// ======================================================

import "dotenv/config";
import chalk from "chalk";
import { MongoProvider } from "../src/infrastructure/MongoProvider.js";
import NewsService from "../src/application/NewsService.js";

console.log(chalk.cyan("\n🧪 Iniciando prueba manual de extracción de datos...\n"));

(async () => {
  try {
    // 1️⃣ Conexión a MongoDB
    console.log(chalk.yellow("🔌 Conectando a MongoDB..."));
    await MongoProvider.connect();
    await MongoProvider.waitForConnection();

    if (!MongoProvider.isConnected()) {
      console.error(chalk.red("❌ MongoDB no disponible."));
      process.exit(1);
    }

    console.log(chalk.green("✅ Conexión MongoDB establecida.\n"));

    // 2️⃣ Test de NewsService
    console.log(chalk.cyan("📰 Probando extracción de noticias..."));
    try {
      const newsResult = await NewsService.fetchAndSave();

      if (newsResult?.length > 0) {
        console.log(chalk.green(`✅ ${newsResult.length} noticias guardadas correctamente.`));
      } else {
        console.log(chalk.yellow("⚠️ No se obtuvieron noticias nuevas (puede ser límite o error de API)."));
      }
    } catch (err) {
      console.error(chalk.red("❌ Error durante prueba de NewsService:"), err.message);
    }

    // 3️⃣ Test de YouTubeService
    console.log(chalk.cyan("\n🎬 Probando extracción de videos de YouTube..."));
    const { YouTubeService } = await import("../src/application/YouTubeService.js");

    try {
      if (typeof YouTubeService.initialize === "function") {
        await YouTubeService.initialize();
      }

      if (typeof YouTubeService.syncVideos === "function") {
        const ytResult = await YouTubeService.syncVideos();

        if (ytResult?.success && ytResult.count > 0) {
          console.log(chalk.green(`🎥 ${ytResult.count} videos nuevos guardados correctamente.`));
        } else {
          console.log(chalk.yellow("⚠️ No se obtuvieron videos nuevos de YouTube."));
        }
      } else {
        console.warn(chalk.red("❌ YouTubeService.syncVideos() no está definido."));
      }
    } catch (err) {
      console.error(chalk.red("❌ Error durante prueba de YouTubeService:"), err.message);
    }

    console.log(chalk.gray("\n🧠 Test de extracción finalizado correctamente.\n"));
    process.exit(0);
  } catch (err) {
    console.error(chalk.red("\n❌ Error durante prueba general:"), err.message);
    process.exit(1);
  }
})();
