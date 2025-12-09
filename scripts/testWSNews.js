// scripts/testWSNews.js
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import 'dotenv/config';

const WS_URL = process.env.WS_URL || "ws://localhost:3000"; // Cambia puerto si es necesario
const JWT_SECRET = process.env.JWT_SECRET || "tu_jwt_secret";

// Generar token de prueba (usa un usuario existente en tu DB)
const token = jwt.sign({ username: "testuser" }, JWT_SECRET, { expiresIn: "1h" });

console.log("🔹 Conectando a WebSocket...", WS_URL);

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("✅ Conectado al WS, enviando auth token...");
  ws.send(JSON.stringify({ type: "auth", token }));

  // Suscribirse a noticias
  ws.send(JSON.stringify({ type: "subscribe_news" }));
});

ws.on("message", (raw) => {
  try {
    const data = JSON.parse(raw);
    if (data.type === "news_snapshot" || data.type === "news_update") {
      console.log("📰 Noticias recibidas:");
      data.data.slice(0, 5).forEach((n, i) => {
        console.log(`${i + 1}. [${n.publishedAt}] ${n.title} - ${n.source}`);
      });
      console.log("--------------------------------------------------");
    } else {
      console.log("Mensaje WS:", data);
    }
  } catch (err) {
    console.error("❌ Error parseando mensaje WS:", err.message);
  }
});

ws.on("close", (code, reason) => {
  console.log(`🔌 Conexión cerrada, code=${code}, reason=${reason}`);
});

ws.on("error", (err) => {
  console.error("⚠️ Error WS:", err.message);
});
