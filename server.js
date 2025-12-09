// ======================================================
// 🚀 server.js — QuickChatX Backend v9.0.3
// ✅ Mongo + Redis + WS (solo chat/llamadas) + News + Finanzas + Telegram
// ❌ YouTube: COMPLETAMENTE ELIMINADO
// ======================================================

import dotenv from "dotenv";
dotenv.config();

import http from "http";
import path from "path";
import chalk from "chalk";
import mongoose from "mongoose";

// ======================================================
// 🧩 Core Interno
// ======================================================
import { MongoProvider } from "./src/infrastructure/MongoProvider.js";
import { ensureUploadDir } from "./src/infrastructure/FileStorage.js";
import { createExpressApp } from "./src/interfaces/ExpressApp.js";
import {
  createSocketService,
  getSocketService,
} from "./src/interfaces/websockets/SocketService.js";
import { initRedis } from "./src/infrastructure/RedisProvider.js";

// ======================================================
// 🧠 Servicios y Schedulers
// ======================================================
import { attachSocketService } from "./src/application/UserActivityService.js";
import { startNewsPolling } from "./src/application/NewsScheduler.js";
import NewsService from "./src/application/NewsService.js";
import FinanceService from "./src/application/FinanceService.js";
import { DailyContentScheduler } from "./src/schedulers/DailyContentScheduler.js";
import AISummaryService from "./src/application/AISummaryService.js";

// ======================================================
// 🧱 Dominio + Config
// ======================================================
import { User } from "./src/domain/User.js";
import config from "./src/config/config.js";
import { fixMongoIndexes, scheduleAutoFix } from "./src/utils/MongoIndexFixer.js";

// ======================================================
// 🤖 Telegram Integrations
// ======================================================
import { sendTelegramAlert, initTelegramBot } from "./src/integrations/TelegramBot.js";

// ======================================================
// ⚙️ Entorno
// ======================================================
const ENV = process.env.NODE_ENV || config.env || "development";
const PORT = Number(process.env.PORT || config.port || 8085);
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || config.jwtSecret;

if (!JWT_SECRET) {
  console.error(chalk.bgRed.white("❌ Falta JWT_SECRET en .env o config.js"));
  process.exit(1);
}

console.log(chalk.cyanBright(`🌐 QuickChatX iniciado en modo ${ENV.toUpperCase()}`));

// ======================================================
// 📁 Preparar directorios
// ======================================================
const UPLOAD_DIR = ensureUploadDir(path.resolve(process.cwd(), "uploads"));
console.log(chalk.blue(`📦 Carpeta de uploads: ${UPLOAD_DIR}`));

// ======================================================
// 🤖 Inicializar TelegramBot
// ======================================================
try {
  const ok = initTelegramBot();
  console.log(ok ? chalk.green("🤖 TelegramBot listo") : chalk.yellow("⚠️ Telegram desactivado"));
} catch (err) {
  console.warn(chalk.yellow("⚠️ Error inicializando TelegramBot:"), err?.message);
}

// ======================================================
// 👑 Crear usuario admin (si no existe)
// ======================================================
async function ensureAdminUser() {
  try {
    const admin = await User.findOne({ username: "admin" }).lean().catch(() => null);
    if (admin) return;

    const bcrypt = await import("bcryptjs");
    const password = await bcrypt.hash("123456", 10);

    await User.create({
      firstName: "Admin",
      lastName: "User",
      username: "admin",
      email: "admin@quickchatx.com",
      password,
      role: "admin",
    });

    console.log(chalk.green("👤 Usuario admin creado automáticamente"));
    sendTelegramAlert("👤 Usuario admin creado automáticamente").catch(() => {});
  } catch (err) {
    console.error(chalk.red("❌ Error creando admin:"), err?.message);
  }
}

// ======================================================
// 🚨 Manejo global de errores
// ======================================================
process.on("unhandledRejection", async (reason) => {
  console.error(chalk.bgRed.white("❌ UNHANDLED REJECTION:"), reason);
  try {
    await sendTelegramAlert(`🚨 UnhandledRejection: ${String(reason)}`, true);
  } catch {}
});

process.on("uncaughtException", async (err) => {
  console.error(chalk.bgRed.white("❌ UNCAUGHT EXCEPTION:"), err);
  try {
    await sendTelegramAlert(`🚨 UncaughtException: ${err?.message}`, true);
  } catch {}
  process.exit(1);
});

// ======================================================
// 🚀 Inicialización Principal
// ======================================================
(async () => {
  let server;
  let redisClient = null;
  let grpcServer = null;

  try {
    // 1️⃣ MongoDB
    console.log(chalk.yellow("🔌 Conectando a MongoDB..."));
    await MongoProvider.connect();
    await MongoProvider.waitForConnection();
    console.log(chalk.green("✅ MongoDB conectado"));

    await ensureAdminUser();

    await fixMongoIndexes(mongoose.connection, [
      { model: User, expectedIndexes: ["username_1", "email_1"] },
    ]);

    scheduleAutoFix(mongoose.connection, [], "0 3 * * *");

    // 2️⃣ Redis
    console.log(chalk.yellow("🔗 Inicializando Redis..."));
    try {
      redisClient = await initRedis();
      console.log(chalk.green("✅ Redis conectado"));
    } catch (err) {
      console.warn(chalk.yellow("⚠️ Redis no disponible:"), err?.message);
    }

    // 3️⃣ Express
    const app = await createExpressApp({ uploadDir: UPLOAD_DIR });

    // 4️⃣ HTTP
    server = http.createServer(app);

    // 5️⃣ WebSocket (solo chat/llamadas)
    try {
      await createSocketService(server);
      const socketService = getSocketService();
      attachSocketService(socketService);
      app.locals.socketService = socketService;
      console.log(chalk.green("🔗 SocketService activo (chat, llamadas)"));
    } catch (err) {
      console.warn(chalk.yellow("⚠️ No se pudo inicializar SocketService:"), err?.message);
    }

    // 6️⃣ gRPC (opcional)
    if (process.env.GRPC_ENABLED === "true") {
      try {
        const { startGrpcServer } = await import("./src/grpc/server.js");
        grpcServer = await startGrpcServer({
          port: process.env.GRPC_PORT || 50051,
        });
      } catch (err) {
        console.warn(chalk.yellow("⚠️ No se pudo iniciar gRPC:"), err?.message);
      }
    }

    // 7️⃣ Iniciar servidor
    server.listen(PORT, HOST, () => {
      console.log(chalk.green(`✅ Servidor iniciado en http://${HOST}:${PORT}`));
      console.log(chalk.cyan(`🌍 Dominio: https://api.quickchatx.com`));
    });

    // 8️⃣ Schedulers
    try {
      startNewsPolling?.();
      console.log(chalk.green("📰 NewsPolling iniciado."));
    } catch (e) {
      console.warn(chalk.yellow("⚠️ NewsPolling no iniciado:"), e?.message);
    }

    try {
      DailyContentScheduler?.start?.();
      console.log(chalk.green("🕒 DailyContentScheduler activo."));
    } catch (e) {
      console.warn(chalk.yellow("⚠️ DailyContentScheduler no iniciado:"), e?.message);
    }

    // 🧹 Shutdown
    const shutdown = async () => {
      console.log(chalk.yellow("\n🧹 Cerrando servidor..."));

      try {
        if (redisClient?.quit) {
          await redisClient.quit();
          console.log(chalk.gray("🔌 Redis cerrado"));
        }

        if (grpcServer?.tryShutdown) {
          await new Promise((resolve) =>
            grpcServer.tryShutdown(() => resolve())
          );
          console.log(chalk.gray("🔌 gRPC server cerrado"));
        }

        try {
          const ss = getSocketService();
          await ss?.close?.();
          console.log(chalk.gray("🔌 SocketService cerrado"));
        } catch (e) {
          console.warn(chalk.yellow("⚠️ Error cerrando SocketService:"), e?.message);
        }

        server.close(() => {
          console.log(chalk.gray("🔒 HTTP server cerrado"));
          process.exit(0);
        });
      } catch (err) {
        console.error(chalk.red("❌ Error durante apagado:"), err?.message);
        process.exit(1);
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

  } catch (error) {
    console.error(chalk.bgRed.white("❌ Error crítico al iniciar servidor:"), error?.stack || error);
    try {
      await sendTelegramAlert(`🚨 Error crítico: ${error?.message}`, true);
    } catch {}
    process.exit(1);
  }
})();
