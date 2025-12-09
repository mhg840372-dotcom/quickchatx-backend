// ======================================================
// 🧩 src/infrastructure/MongoProvider.js
// ✅ QuickChatX — MongoDB resiliente sin YouTube
// ======================================================

import mongoose from "mongoose";
import fetch from "node-fetch";
import chalk from "chalk";
import dotenv from "dotenv";
import { fixMongoIndexes } from "../utils/MongoIndexFixer.js";
import { News } from "../domain/News.js";

dotenv.config();

// ======================================================
// ⚙️ Variables de entorno
// ======================================================
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const MONGO_DB = process.env.MONGO_DB || "quickchatx";
const MAX_DELAY = Number(process.env.MONGO_MAX_DELAY_MS || 30000);
const RECONNECT_MAX = Number(process.env.MONGO_MAX_RECONNECTS || 10);
const ALERT_COOLDOWN = Number(process.env.ALERT_COOLDOWN_MS || 60000);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ======================================================
// 🧠 Estado global
// ======================================================
let connection = null;
let reconnectAttempts = 0;
let reconnecting = false;
let connecting = false;
let lastAlertTime = 0;
let lastState = "desconectado";

// ======================================================
// 🧾 Logger coloreado con timestamp
// ======================================================
function log(level, message, data = {}) {
  const colors = {
    error: chalk.red,
    warn: chalk.yellow,
    success: chalk.green,
    info: chalk.cyan,
  };
  const color = colors[level] || chalk.white;
  const ts = new Date().toISOString();
  const extra = Object.keys(data).length ? ` → ${JSON.stringify(data)}` : "";
  console.log(color(`[MongoProvider] ${ts} | ${level.toUpperCase()} | ${message}${extra}`));
}

// ======================================================
// 📢 Alerta Telegram con enfriamiento
// ======================================================
async function sendTelegramAlert(message, force = false) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const now = Date.now();
  if (!force && now - lastAlertTime < ALERT_COOLDOWN) return;
  lastAlertTime = now;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: `🧩 *QuickChatX MongoDB*\n${message}`,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    log("warn", "Error enviando alerta Telegram", { error: err.message });
  }
}

// ======================================================
// 🚀 Clase MongoProvider — conexión robusta
// ======================================================
export class MongoProvider {
  static async connect(uri = MONGO_URI, dbName = MONGO_DB) {
    if (!uri) throw new Error("❌ MONGO_URI no definido en .env");

    // Evitar conexiones duplicadas
    if (connecting || reconnecting) {
      log("warn", "Conexión MongoDB ya en curso — esperando...");
      while (connecting || reconnecting) await new Promise((r) => setTimeout(r, 400));
      return connection;
    }

    if (connection && mongoose.connection.readyState === 1) {
      log("success", "🔁 MongoDB ya conectado — reusando instancia existente");
      return connection;
    }

    connecting = true;
    const start = Date.now();

    try {
      connection = await mongoose.connect(uri, {
        dbName,
        autoIndex: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      connecting = false;
      reconnectAttempts = 0;
      reconnecting = false;

      const conn = mongoose.connection;
      conn.removeAllListeners();

      // 🧠 Eventos
      conn.on("connected", async () => {
        log("success", `✅ Conectado a MongoDB (${dbName})`);
        if (lastState !== "conectado") {
          await sendTelegramAlert(`✅ Conectado correctamente a *${dbName}*`);
          lastState = "conectado";
        }

        // Reparar índices de NEWS
        await fixMongoIndexes(mongoose.connection, [
          { model: News, expectedIndexes: ["url_1"] },
        ]);
      });

      conn.on("disconnected", async () => {
        if (reconnecting) return;
        log("warn", "⚠️ Conexión MongoDB perdida — intentando reconectar...");
        await sendTelegramAlert("⚠️ MongoDB desconectado, intentando reconexión...");
        lastState = "desconectado";
        MongoProvider._attemptReconnect(uri, dbName);
      });

      conn.on("reconnected", async () => {
        log("success", "🔄 MongoDB reconectado con éxito");
        await sendTelegramAlert("🔄 MongoDB reconectado correctamente");
        lastState = "conectado";

        // Verificar índices tras reconexión
        await fixMongoIndexes(mongoose.connection, [
          { model: News, expectedIndexes: ["url_1"] },
        ]);
      });

      conn.on("error", async (err) => {
        log("error", "💥 Error en conexión MongoDB", { error: err.message });

        if (/E11000|index|duplicate/i.test(err.message)) {
          log("warn", "⚙️ Intentando reparar índices automáticamente...");
          await fixMongoIndexes(mongoose.connection, [
            { model: News, expectedIndexes: ["url_1"] },
          ]);
        }

        await sendTelegramAlert(`❌ Error MongoDB: ${err.message}`);
      });

      const time = ((Date.now() - start) / 1000).toFixed(2);
      log("success", `MongoDB conectado en ${time}s`);
      return connection;

    } catch (err) {
      connecting = false;
      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_DELAY);

      log("warn", `Falló conexión MongoDB — reintentando en ${delay / 1000}s`, {
        intento: reconnectAttempts,
        error: err.message,
      });

      await sendTelegramAlert(
        `⚠️ Falló conexión MongoDB (intento ${reconnectAttempts}): ${err.message}`
      );

      if (reconnectAttempts < RECONNECT_MAX) {
        setTimeout(() => MongoProvider._attemptReconnect(uri, dbName), delay);
      } else {
        log("error", "🚨 Límite máximo de reconexiones alcanzado — abortando");
        await sendTelegramAlert("🚨 Límite máximo de reconexiones alcanzado", true);
      }
    }
  }

  // ♻️ Reintento controlado
  static _attemptReconnect(uri, dbName) {
    if (reconnecting || connecting) return;
    reconnecting = true;
    reconnectAttempts++;

    const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_DELAY);
    log("info", `🔄 Reintentando conexión MongoDB en ${delay / 1000}s`, {
      intento: reconnectAttempts,
    });

    setTimeout(async () => {
      try {
        await MongoProvider.connect(uri, dbName);
      } catch (err) {
        log("error", "❌ Error durante reconexión", { error: err.message });
        await sendTelegramAlert(`❌ Error en reconexión MongoDB: ${err.message}`);
      } finally {
        reconnecting = false;
      }
    }, delay);
  }

  // ======================================================
  // 📚 Utilitarios
  // ======================================================
  static collection(name) {
    if (!mongoose.connection || mongoose.connection.readyState !== 1)
      throw new Error("MongoDB no conectado — llama a connect() primero.");
    return mongoose.connection.db.collection(name);
  }

  static isConnected() {
    return mongoose.connection?.readyState === 1;
  }

  static async waitForConnection(timeoutMs = 10000) {
    const start = Date.now();
    while (!this.isConnected()) {
      if (Date.now() - start > timeoutMs)
        throw new Error("⏱️ Timeout esperando conexión MongoDB");
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  static getStatus() {
    const states = { 0: "desconectado", 1: "conectado", 2: "conectando", 3: "desconectando" };
    const state = states[mongoose.connection.readyState] || "desconocido";

    return {
      state,
      dbName: mongoose.connection?.name || MONGO_DB,
      host: mongoose.connection?.host || "N/A",
      uri: MONGO_URI,
      reconnectAttempts,
      uptime: `${process.uptime().toFixed(0)}s`,
      lastState,
    };
  }
}

// ======================================================
// 🔌 Export directo compatible con server.js
// ======================================================
export const connectMongo = async () => await MongoProvider.connect();
export const getMongoStatus = () => MongoProvider.getStatus();
export const isMongoConnected = () => MongoProvider.isConnected();
