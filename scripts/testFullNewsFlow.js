// scripts/testFullNewsFlow.js
import WebSocket from "ws";
import { connectMongo } from "../src/infrastructure/MongoProvider.js";
import { NewsService } from "../src/application/NewsService.js";
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB || "quickchatx";
const WS_URL = "ws://localhost:8085"; // Puerto real de tu backend

async function testMongo() {
  console.log("🔹 Conectando a MongoDB...");
  try {
    await connectMongo(MONGO_URI, DB_NAME);
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err.message);
  }
}

async function testNewsFetch() {
  console.log("🔹 Consultando últimas noticias...");
  try {
    const latestNews = await NewsService.getAll(10, 0);
    console.log(`✅ Se encontraron ${latestNews.length} noticias`);
    latestNews.forEach((n, i) => console.log(`${i+1}. [${new Date(n.publishedAt)}] ${n.title} (${n.url})`));
    return latestNews;
  } catch (err) {
    console.error("❌ Error consultando noticias:", err.message);
    return [];
  }
}

function testWebSocket(latestNews) {
  console.log("🔹 Conectando a WebSocket...", WS_URL);
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("✅ Conectado al WS, enviando auth y suscripción...");
    const token = process.env.TEST_JWT_TOKEN;
    ws.send(JSON.stringify({ type: "auth", token }));
    ws.send(JSON.stringify({ type: "subscribe_news" }));
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    if (data.type === "news_snapshot") {
      console.log("✅ Payload recibido desde WS:");
      console.log(JSON.stringify(data, null, 2));
      ws.close();
    } else {
      console.log("ℹ️ Mensaje WS:", data);
    }
  });

  ws.on("error", (err) => {
    console.error("⚠️ Error WS:", err.message);
  });

  ws.on("close", (code, reason) => {
    console.log(`🔌 Conexión WS cerrada, code=${code}, reason=${reason}`);
  });
}

(async () => {
  await testMongo();
  const latestNews = await testNewsFetch();
  testWebSocket(latestNews);
})();
