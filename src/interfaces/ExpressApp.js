// ======================================================
// 🚀 QuickChatX Express App v9.3.2 Ultra-Stable (Chat + Calls + Media Debug)
// ======================================================

import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import dotenv from "dotenv";
dotenv.config();
import { fileURLToPath } from "url";

// Servicios
import { UploadService } from "../application/UploadService.js";
import { attachSocketService } from "../application/UserActivityService.js";

import {
  createSocketService,
  getSocketService,
} from "./websockets/SocketService.js";

import { refreshTokens } from "../infrastructure/JWTProvider.js";
import { DailyContentScheduler } from "../schedulers/DailyContentScheduler.js";

import { verifyAccessToken } from "./middlewares/AuthMiddleware.js";
import { trackActivity } from "./middlewares/trackActivity.js";
import { errorHandler, notFoundHandler } from "./middlewares/ErrorHandler.js";

import ChatService from "../application/ChatService.js";
import NewsService from "../application/NewsService.js";

// Routers públicos
import healthRouter from "./routes/health.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/UserRouter.js";
import AIRoutes from "./routes/AIRoutes.js";
import financeRouter from "./routes/FinanceRouter.js";
import legalRouter from "./routes/legalRouter.js";

// Redis
import RedisHealthRoutes from "./routes/RedisHealthRoutes.js";
import RedisMetricsRoutes from "./routes/RedisMetricsRoutes.js";

// Rutas privadas
import feedRoutes from "./routes/feedRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import newsRoutes from "./routes/newsRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import callRoutes from "./routes/callRoutes.js";
import interactionRoutes from "./routes/interactionRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import reactionRoutes from "./routes/reactionRoutes.js";
import uploadsRouter from "./routes/uploadsRouter.js";
import webrtcRoutes from "./routes/webrtcRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import userActivityRoutes from "./routes/UserActivityRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";

// ✅ Upload de video + procesamiento (ffmpeg)
import mediaRoutes from "./routes/media.js";

// Multer global (uploads normales)
import upload, {
  UPLOADS_BASE_DIR,
  UPLOAD_MAX_FILE_SIZE_MB,
} from "../infrastructure/uploadMiddleware.js";

import { broadcastNewsController } from "./controllers/adminNews.js";
import { setupSwagger } from "./SwaggerSetup.js";
import { initRedis } from "../infrastructure/RedisProvider.js";

// ======================================================
export async function createExpressApp({
  server = null,
  uploadDir = UPLOADS_BASE_DIR,
} = {}) {
  const app = express();
  const {
    JWT_SECRET,
    NODE_ENV = "development",
    ALLOWED_ORIGINS = "*",
    UPLOAD_DRIVER = "local",
  } = process.env;

  // ======================================================
  // 📥 Límite de body (JSON / urlencoded) alineado con Multer
  // ------------------------------------------------------
  //  - Si BODY_LIMIT_MB está definido en env → se respeta.
  //  - Si no, se usa UPLOAD_MAX_FILE_SIZE_MB (de uploadMiddleware) con techo 1024MB.
  //  - Nunca menos de 50MB para no estrangular uploads grandes.
  // ======================================================
  const envBodyLimitMb = Number(process.env.BODY_LIMIT_MB);
  const fallbackBodyLimitMb = (() => {
    const uploadMb =
      typeof UPLOAD_MAX_FILE_SIZE_MB === "number" &&
      Number.isFinite(UPLOAD_MAX_FILE_SIZE_MB)
        ? UPLOAD_MAX_FILE_SIZE_MB
        : 500;
    // Entre 500MB y 1024MB
    return Math.max(Math.min(uploadMb, 1024), 500);
  })();

  const bodyLimitMb =
    Number.isFinite(envBodyLimitMb) && envBodyLimitMb > 0
      ? envBodyLimitMb
      : fallbackBodyLimitMb;

  const bodyLimit = `${bodyLimitMb}mb`;

  console.log(
    `📥 Express body limit → ${bodyLimit} (UPLOAD_MAX_FILE_SIZE_MB ≈ ${
      typeof UPLOAD_MAX_FILE_SIZE_MB === "number"
        ? UPLOAD_MAX_FILE_SIZE_MB.toFixed(1)
        : "n/a"
    }MB)`
  );

  if (!JWT_SECRET) throw new Error("❌ Falta JWT_SECRET en .env");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const absoluteUploadDir = uploadDir || UPLOADS_BASE_DIR;

  // Solo creamos carpeta física si usamos almacenamiento LOCAL
  if (UPLOAD_DRIVER === "local") {
    if (!fs.existsSync(absoluteUploadDir)) {
      fs.mkdirSync(absoluteUploadDir, { recursive: true });
      console.log("📁 Carpeta uploads creada:", absoluteUploadDir);
    } else {
      console.log("📁 Carpeta uploads existente:", absoluteUploadDir);
    }
  } else {
    console.log(
      `🪣 UPLOAD_DRIVER=${UPLOAD_DRIVER} → no se usa carpeta local de uploads para almacenamiento principal`
    );
  }

  // ❌ Eliminamos express.static("/uploads") porque ahora
  // el router uploadsRouter se encarga de servir desde LOCAL o R2.
  //
  // app.use(
  //   "/uploads",
  //   express.static(absoluteUploadDir, {
  //     maxAge: "365d",
  //     immutable: true,
  //   })
  // );

  // Seguridad
  app.set("trust proxy", 2);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(compression());
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

  // CORS
  let allowedOrigins = ["*"];
  try {
    allowedOrigins = String(ALLOWED_ORIGINS || "*")
      .split(",")
      .map((o) => o.trim());
  } catch {}

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes("*")) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        const wildcard = allowedOrigins.some(
          (o) => o.startsWith(".") && origin.endsWith(o)
        );
        if (wildcard) return cb(null, true);
        return cb(new Error("CORS no permitido"));
      },
      credentials: true,
    })
  );

  if (NODE_ENV !== "production") app.use(morgan("dev"));

  // Latencia
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      if (ms > 800)
        console.log(`⏱️ ${req.method} ${req.originalUrl} — ${ms}ms`);
    });
    next();
  });

  // ======================================================
  // 🌐 WEBSOCKET
  // ======================================================
  if (server) {
    const socketService = await createSocketService(server);

    // **CLAVE** → Para que ChatController funcione
    app.locals.socketService = socketService;

    attachSocketService(socketService);
    console.log("🌐 SocketService activo");

    const ioChats = socketService.io?.of("/chats");

    if (ioChats) {
      ioChats.on("connection", (socket) => {
        const userId = socket.handshake.query.userId;

        console.log(`💬 [Chat] conectado → ${userId} (${socket.id})`);

        socket.on("private_message", async ({ to, message }) => {
          try {
            await ChatService.sendMessage({
              from: userId,
              to,
              text: message,
              chatKey: process.env.ENCRYPTION_KEY,
              wsEmit: (ev, data) => {
                socketService.emitToUser(to, ev, data);
                socketService.emitToUser(userId, ev, data);
              },
            });
          } catch (err) {
            console.error("❌ WS private_message:", err.message);
          }
        });

        socket.on("typing", ({ to }) => {
          socketService.emitToUser(to, "typing", {
            from: userId,
            timestamp: Date.now(),
          });
        });

        socket.on("mark_read", async ({ room }) => {
          await ChatService.markAsRead(room, userId);
          socketService.emitToUser(userId, "messages_read", {
            room,
            by: userId,
          });
        });

        socket.on("delete_message", async ({ messageId }) => {
          const payload = await ChatService.softDeleteMessage(
            messageId,
            userId,
            (ev, data) => socketService.emitToUser(userId, ev, data)
          );
          socketService.emitToUser(
            payload.deletedBy,
            "message_deleted",
            payload
          );
        });

        socket.on("restore_message", async ({ messageId }) => {
          const payload = await ChatService.restoreMessage(
            messageId,
            userId
          );
          socketService.emitToUser(
            userId,
            "message_restored",
            payload
          );
          socketService.emitToUser(
            payload.restoredBy,
            "message_restored",
            payload
          );
        });
      });
    }
  }

  // ======================================================
  // Tareas, Swagger, Redis, Limits
  // ======================================================
  DailyContentScheduler?.start?.();
  setupSwagger(app);

  let redis = null;
  try {
    redis = await initRedis();
    app.locals.redis = redis;
  } catch {}

  app.use(rateLimit({ windowMs: 60000, max: 100 }));
  const authLimiter = rateLimit({ windowMs: 15 * 60000, max: 15 });
  const uploadLimiter = rateLimit({ windowMs: 10 * 60000, max: 20 });

  // ======================================================
  // 🔍 RUTA DE DEBUG PARA SUBIDA DE VIDEO SIN JWT (SIEMPRE ACTIVA)
  // ------------------------------------------------------
  //  - No pasa por /api, así NUNCA entra en verifyAccessToken.
  //  - Úsala solo para pruebas con curl/Postman.
  // ======================================================
  console.warn(
    "⚠️ /media-debug habilitado SIN JWT (solo uso de debug, recuerda desactivarlo luego)"
  );
  app.use("/media-debug", uploadLimiter, mediaRoutes);

  // ======================================================
  // 📂 RUTA PÚBLICA DE ARCHIVOS (LOCAL o R2)
  // ------------------------------------------------------
  //  /uploads/* → usa uploadsRouter:
  //    - En LOCAL: lee del filesystem
  //    - En R2:    hace GetObject al bucket (con R2_PREFIX)
  //  Además, dentro de uploadsRouter están:
  //    - POST /upload
  //    - GET  /my
  //    - DELETE /:id
  //  con su propio authMiddleware.
// ======================================================
  app.use("/uploads", uploadsRouter);

  // ======================================================
  // Rutas públicas
  // ======================================================
  app.get("/ping", (req, res) => res.json({ message: "pong" }));
  app.use("/api/health", healthRouter);
  app.use("/api/redis-health", RedisHealthRoutes);
  app.use("/api/redis-metrics", RedisMetricsRoutes);

  app.use("/api/ai", AIRoutes);
  app.use("/api/finance", financeRouter);
  app.use("/api/legal", legalRouter);

  app.use("/api/user-activity", userActivityRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/analytics", analyticsRoutes);

  // Check email / username
  try {
    const { checkEmail, checkUsername } = await import(
      "./controllers/userController.js"
    );
    if (checkEmail) {
      app.get("/api/auth/check-email", checkEmail);
      app.post("/api/auth/check-email", checkEmail);
      app.post("/api/check-email", checkEmail);
      app.get("/api/auth/check-email/:email", checkEmail);
    }
    if (checkUsername) {
      app.post("/api/auth/check-username", checkUsername);
      app.post("/api/users/check-username", checkUsername);
      app.post("/api/check-username", checkUsername);
      app.get("/api/users/validate-username", checkUsername);
      app.get(
        "/api/users/check-username/:username",
        checkUsername
      );
    }
  } catch {}

  // Debug news
  const newsService =
    NewsService && typeof NewsService === "function"
      ? new NewsService()
      : NewsService;

  app.get("/api/debug/news-latest", async (req, res) => {
    try {
      const limit = Math.min(
        parseInt(req.query.limit, 10) || 10,
        50
      );
      const news = await newsService.getLatest({
        limit,
        skip: 0,
      });
      return res.json({ success: true, data: news });
    } catch {
      return res
        .status(500)
        .json({ success: false, error: "Error obteniendo noticias" });
    }
  });

  // ======================================================
  // PRIVADAS (JWT)
  // ======================================================
  const protectedRouter = express.Router();
  protectedRouter.use(verifyAccessToken, trackActivity);

  protectedRouter.post("/news/like/:id", async (req, res) => {
    try {
      const newsId = req.params.id;
      const userId = req.user?.id;
      const value =
        typeof req.body?.value === "number" ? req.body.value : 1;

      const result = await newsService.toggleLike({
        newsId,
        userId,
        value,
      });
      if (redis) await redis.del(`news:id:${newsId}`);
      return res.json({ success: true, data: result });
    } catch {
      return res
        .status(500)
        .json({ success: false, error: "Error al registrar like" });
    }
  });

  protectedRouter.use("/feed", feedRoutes);
  protectedRouter.use("/profile", profileRoutes);
  protectedRouter.use("/news", newsRoutes);
  protectedRouter.use("/devices", deviceRoutes);
  protectedRouter.use("/posts", postRoutes);
  protectedRouter.use("/chat", chatRoutes);
  protectedRouter.use("/calls", callRoutes);
  protectedRouter.use("/interactions", interactionRoutes);
  protectedRouter.use("/webrtc", webrtcRoutes);
  protectedRouter.use("/comments", commentRoutes);
  protectedRouter.use("/reactions", reactionRoutes);
  protectedRouter.use("/activity", activityRoutes);
  protectedRouter.use("/media", uploadLimiter, mediaRoutes);

  // ⚠️ Ruta legacy de upload simple (usa uploadMiddleware + UploadService)
  //    Sigue funcionando, y en modo R2 el storage de Multer ya escribe en R2.
  protectedRouter.post(
    "/upload",
    uploadLimiter,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res
            .status(400)
            .json({ success: false, error: "Archivo faltante" });
        }
        const saved = await UploadService.saveFile(
          req.file,
          req.user,
          absoluteUploadDir
        );
        return res.json({ success: true, data: saved });
      } catch (err) {
        console.error("Error guardando archivo:", err);
        return res
          .status(500)
          .json({ success: false, error: "Error guardando archivo" });
      }
    }
  );

  // API de uploads (lista, delete, etc.) protegida bajo /api/uploads
  protectedRouter.use("/uploads", uploadsRouter);

  protectedRouter.post(
    "/admin/broadcast-news",
    broadcastNewsController
  );

  app.use("/api", protectedRouter);

  // ------------------------------------------------------
  // LOGOUT
  // ------------------------------------------------------
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const { token, refreshToken, userId } = req.body || {};

      if (redis) {
        if (token) await redis.del(`session:${token}`);
        if (refreshToken) await redis.del(`refresh:${refreshToken}`);
        if (userId) await redis.del(`user:${userId}`);
      }

      return res.json({
        success: true,
        message: "Sesión cerrada.",
      });
    } catch {
      return res
        .status(500)
        .json({ success: false, error: "Error logout" });
    }
  });

  // REFRESH TOKENS
  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      const r = await refreshTokens(refreshToken);
      return res.json({ success: true, ...r });
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: err?.message || "Refresh inválido",
      });
    }
  });

  // Errores
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
// ======================================================
