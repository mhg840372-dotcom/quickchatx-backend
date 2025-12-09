// scripts/testNewsFlow.js
import 'dotenv/config';
import { connectMongo } from "../src/infrastructure/MongoProvider.js";
import { NewsService } from "../src/application/NewsService.js";

async function testNewsFlow() {
  try {
    console.log("🔹 Conectando a MongoDB...");
    const db = await connectMongo(process.env.MONGO_URI, process.env.MONGO_DB_NAME || "quickchatx");
    console.log("✅ Conectado a MongoDB");

    console.log("🔹 Consultando últimas noticias...");
    const latestNews = await NewsService.getAll(10, 0); // últimos 10
    if (!latestNews || latestNews.length === 0) {
      console.warn("⚠️ No se encontraron noticias en la base de datos");
    } else {
      console.log(`✅ Se encontraron ${latestNews.length} noticias`);
      latestNews.forEach((n, i) => {
        console.log(`${i + 1}. [${n.publishedAt}] ${n.title} (${n.url})`);
      });
    }

    console.log("🔹 Simulando envío a la app...");
    // Aquí solo mostramos que la app recibiría los datos
    const simulatedAppPayload = JSON.stringify({ type: "news_snapshot", data: latestNews }, null, 2);
    console.log("Payload enviado a la app:\n", simulatedAppPayload);

    console.log("✅ Flujo verificado con éxito");
  } catch (err) {
    console.error("❌ Error verificando flujo:", err);
  } finally {
    process.exit();
  }
}

testNewsFlow();
