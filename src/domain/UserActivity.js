// ======================================================
// 🧠 src/domain/UserActivity.js — QuickChatX v8.7.0 PRO
// ✅ Modelo integral sincronizado con Redis + WS + Controladores v8+
// + Soporte para eventos de Experimentos / Feed / Recomendador
// ======================================================

import mongoose from "mongoose";
import chalk from "chalk";
import { initRedis } from "../infrastructure/RedisProvider.js";  // Usar initRedis
import { getSocketService } from "../interfaces/websockets/SocketService.js";

const { Schema } = mongoose;
const flattenHash = (hash = {}) =>
  Object.entries(hash).flatMap(([k, v]) => [k, v]);

async function hsetCompat(client, key, hash) {
  if (!client) return null;
  if (typeof client.hSet === "function") return client.hSet(key, hash);
  if (typeof client.hset === "function")
    return client.hset(key, ...flattenHash(hash));
  if (typeof client.hmset === "function") return client.hmset(key, hash);
  return null;
}

/* =====================================================
   🔔 Subdocumentos auxiliares
   ===================================================== */

const NotificationSchema = new Schema(
  {
    type: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    meta: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ChatActivitySchema = new Schema(
  {
    chatId: { type: String, required: true },
    lastMessageAt: { type: Date, default: Date.now },
    unreadCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const CallActivitySchema = new Schema(
  {
    callId: { type: String, required: true },
    type: { type: String, enum: ["audio", "video"], required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    duration: { type: Number, default: 0 },
  },
  { _id: false }
);

const TypingStateSchema = new Schema(
  {
    isTyping: { type: Boolean, default: false },
    chatId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CurrentCallSchema = new Schema(
  {
    callId: { type: String },
    type: { type: String, enum: ["audio", "video"] },
    startedAt: { type: Date },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { _id: false }
);

const SessionInfoSchema = new Schema(
  {
    device: { type: String, default: "unknown" },
    platform: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    region: { type: String, default: "global" },
    locale: { type: String, default: "en-US" },
    avgLatency: { type: Number, default: 0 },
  },
  { _id: false }
);

/* =====================================================
   🧩 Esquema principal — UserActivity
   ===================================================== */

const UserActivitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    email: { type: String }, // Se eliminó el índice duplicado sobre "email"

    // 🟢 Estado de conexión
    status: {
      type: String,
      enum: ["online", "offline", "away", "busy"],
      default: "offline",
    },
    isConnected: { type: Boolean, default: false },
    sockets: { type: [String], default: [] },
    lastSocketId: { type: String, default: null },

    lastSeen: { type: Date, default: Date.now },
    lastOnline: { type: Date, default: Date.now },
    lastAction: { type: String, default: "login" },
    lastActionAt: { type: Date, default: Date.now },
    latency: { type: Number, default: 0 },

    // 🌐 Información de sesión
    sessionInfo: { type: SessionInfoSchema, default: () => ({}) },

    // 💬 Comunicación
    chats: { type: [ChatActivitySchema], default: [] },
    calls: { type: [CallActivitySchema], default: [] },
    notifications: { type: [NotificationSchema], default: [] },
    typing: { type: TypingStateSchema, default: () => ({}) },
    currentCall: { type: CurrentCallSchema, default: null },

    // 🧾 Logs de acciones
    logs: [
      {
        type: {
          type: String,
          required: true,
          enum: [
            "USER_LOGIN",
            "USER_REGISTERED",
            "TERMS_ACCEPTED",
            "PASSWORD_CHANGED",
            "PROFILE_UPDATED",
            "SESSION_EXPIRED",
            "CUSTOM_EVENT",
            // 🔥 Nuevos tipos para recomendador / A/B testing
            "EXPERIMENT_EVENT",
            "FEED_EXPOSURE",
            "CONTENT_INTERACTION",
            "CONTENT_VIEW",
          ],
        },
        description: { type: String },
        timestamp: { type: Date, default: Date.now },
        meta: { type: Object, default: {} },
      },
    ],

    // 🧩 Acciones rápidas (para servicio legacy)
    actions: [
      {
        type: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // 🧪 Experimentos / A/B testing asignados al usuario
    experiments: [
      {
        key: { type: String, required: true }, // ej: "feed_algo_v1"
        variant: { type: String, required: true }, // ej: "A" | "B"
        assignedAt: { type: Date, default: Date.now },
        meta: { type: Object, default: {} }, // info extra (pct, seed, etc.)
      },
    ],

    // 🧭 Región y expiración
    region: { type: String, default: "global" },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true, versionKey: false }
);

/* =====================================================
   ⚙️ Middlewares de consistencia
   ===================================================== */

UserActivitySchema.pre("save", function (next) {
  const now = new Date();

  if (this.isModified("status")) {
    if (this.status === "online") {
      this.isConnected = true;
      this.lastOnline = now;
      this.lastSeen = now;
    } else if (this.status === "offline") {
      this.isConnected = false;
      this.sockets = [];
      this.currentCall = null;
      this.typing = { isTyping: false, chatId: null, updatedAt: now };
    }
  }

  // 🧹 Limitar tamaño
  if (this.calls?.length > 100) this.calls.splice(0, this.calls.length - 100);
  if (this.notifications?.length > 300)
    this.notifications.splice(0, this.notifications.length - 300);
  if (this.logs?.length > 1000) this.logs.splice(0, this.logs.length - 1000);
  if (this.chats?.length > 500) this.chats.splice(0, this.chats.length - 500);
  if (this.actions?.length > 500)
    this.actions.splice(0, this.actions.length - 500);
  if (this.experiments?.length > 200)
    this.experiments.splice(0, this.experiments.length - 200);

  // 🔁 Refrescar expiración (TTL)
  this.expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  next();
});

/* =====================================================
   ⚡ Post-save autosync — Redis + WS
   ===================================================== */

UserActivitySchema.post("save", async function (doc) {
  try {
    const redis = await initRedis().catch(() => null);  // Cambiado a initRedis
    const socketService = getSocketService?.() || null;

    const payload = {
      userId: doc.userId?.toString?.() || doc.email,
      status: doc.status,
      lastOnline: doc.lastOnline,
      lastAction: doc.lastAction,
      latency: doc.latency,
      region: doc.region,
    };

    if (redis) {
      const metaKey = `user:meta:${doc.userId}`;
      const metaPayload = {
        status: doc.status,
        lastAction: doc.lastAction,
        latency: doc.latency,
        at: doc.lastOnline.toISOString(),
      };
      await Promise.allSettled([
        hsetCompat(redis, metaKey, metaPayload),
        redis.expire?.(metaKey, 600),
      ]);
    }

    socketService?.emitToUser?.(
      payload.userId,
      "user:activity:update",
      payload
    );

    if (process.env.DEBUG_USER_ACTIVITY === "true") {
      console.log(
        chalk.cyan(
          `🧠 [UserActivity] Sync → ${payload.userId} (${payload.status}) ${payload.lastAction}`
        )
      );
    }
  } catch (err) {
    console.warn(
      chalk.yellow("⚠️ [UserActivity.postSave] Error:"),
      err.message
    );
  }
});

/* =====================================================
   🧩 Métodos de instancia
   ===================================================== */

UserActivitySchema.methods.addSocket = function (socketId) {
  if (!this.sockets.includes(socketId)) this.sockets.push(socketId);
  this.lastSocketId = socketId;
  this.isConnected = true;
  this.status = "online";
};

UserActivitySchema.methods.removeSocket = function (socketId) {
  this.sockets = this.sockets.filter((id) => id !== socketId);
  if (this.sockets.length === 0) {
    this.isConnected = false;
    this.status = "offline";
  }
};

UserActivitySchema.methods.registerAction = function (
  action,
  ip,
  agent,
  latency = 0
) {
  this.lastAction = action || this.lastAction;
  this.lastActionAt = new Date();
  this.lastOnline = new Date();
  if (ip) this.sessionInfo.ip = ip;
  if (agent) this.sessionInfo.userAgent = agent;
  this.latency = latency;
};

UserActivitySchema.methods.touchOnline = function (socketId = null) {
  const now = new Date();
  this.status = "online";
  this.isConnected = true;
  this.lastOnline = now;
  this.lastSeen = now;
  if (socketId) this.addSocket(socketId);
};

/* =====================================================
   📘 Métodos estáticos — usados por servicios/controladores
   ===================================================== */

UserActivitySchema.statics.log = async function (data = {}) {
  try {
    const { userId, email, type, description, meta } = data;
    if (!type) throw new Error("Tipo de log requerido");

    let activity =
      (userId && (await this.findOne({ userId }))) ||
      (email && (await this.findOne({ email })));

    if (!activity) activity = new this({ userId, email, status: "offline" });

    activity.logs.push({
      type,
      description,
      timestamp: new Date(),
      meta: meta || {},
    });

    activity.lastAction = type;
    activity.lastActionAt = new Date();

    await activity.save();
    return activity;
  } catch (err) {
    console.error(chalk.red("❌ [UserActivity.log] Error:"), err.message);
    return null;
  }
};

UserActivitySchema.statics.findLast = async function (identifier, type) {
  try {
    if (!identifier || !type) return null;
    const query = mongoose.isValidObjectId(identifier)
      ? { userId: identifier }
      : { email: identifier };

    const activity = await this.findOne(query, { logs: 1 }).lean();
    if (!activity?.logs?.length) return null;

    return activity.logs
      .filter((l) => l.type === type)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  } catch (err) {
    console.error(
      chalk.red("❌ [UserActivity.findLast] Error:"),
      err.message
    );
    return null;
  }
};

/* =====================================================
   ⚡ Índices optimizados
   ===================================================== */

UserActivitySchema.index({ userId: 1 });
UserActivitySchema.index({ status: 1, lastOnline: -1 });
UserActivitySchema.index({ lastActionAt: -1, status: 1 });
UserActivitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
UserActivitySchema.index({ "experiments.key": 1 });

/* =====================================================
   ✅ Exportación
   ===================================================== */

export const UserActivity =
  mongoose.models.UserActivity ||
  mongoose.model("UserActivity", UserActivitySchema);

/* =====================================================
   🚀 QuickChatX v8.7.0 — Mejoras Clave
   -----------------------------------------------------
   - 🧪 Soporte integrado para A/B testing (experiments[])
   - 📊 Nuevos tipos de log: FEED_EXPOSURE, CONTENT_VIEW,
     CONTENT_INTERACTION, EXPERIMENT_EVENT
   - 💾 Sync no bloqueante con Redis + WS
   - 💬 Soporte total para chats, llamadas y typing
   - 🧹 Optimización de límites y limpieza segura
   ===================================================== */
