// ======================================================
// 🧾 src/domain/ActivityLog.js — QuickChatX v11.5 ULTRA PRO (2025)
// ------------------------------------------------------
// ✅ ActivityLog distribuido con Mongo + Redis + WS + TTL
// ✅ Compatible con UserActivityService v9.0+
// ✅ Enum ampliado (FEED_EXPOSURE / CONTENT_VIEW / CONTENT_INTERACTION / EXPERIMENT_EVENT / CALL_EVENT)
// ✅ Compatibilidad Redis (node-redis v4 / ioredis)
// ======================================================

import mongoose from "mongoose";
import chalk from "chalk";
import { initRedis } from "../infrastructure/RedisProvider.js";
import { getSocketService } from "../interfaces/websockets/SocketService.js";

const { Schema } = mongoose;

/* =====================================================
   🧩 Esquema — Registro de actividad
   ===================================================== */
const ActivityLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    email: { type: String },

    type: {
      type: String,
      required: true,
      enum: [
        // 🔐 Autenticación
        "LOGIN",
        "LOGOUT",
        "REGISTER",
        "SESSION_EXPIRED",
        "REFRESH_TOKEN",

        // ⚙️ Perfil
        "PROFILE_UPDATE",
        "PASSWORD_CHANGED",
        "TERMS_ACCEPTED",

        // 📝 Publicaciones
        "POST_CREATED",
        "POST_DELETED",
        "POST_LIKED",
        "POST_UNLIKED",

        // 💬 Comentarios
        "COMMENT_ADDED",
        "COMMENT_DELETED",
        "COMMENT_LIKED",

        // 💬 Chat / Estado
        "MESSAGE_SENT",
        "TYPING_STATUS",
        "STATUS_CHANGE",
        "NOTIFICATIONS_CLEARED",

        // 📞 Llamadas
        "CALL_STARTED",
        "CALL_ENDED",
        "CALL_EVENT",

        // 🔔 Sistema
        "NOTIFICATION_SENT",
        "CUSTOM_EVENT",

        // 🧪 Experimentos / Feed / Contenido
        "FEED_EXPOSURE",
        "CONTENT_VIEW",
        "CONTENT_INTERACTION",
        "EXPERIMENT_EVENT",
      ],
    },

    description: { type: String, default: "" },
    meta: { type: Object, default: {} },
    region: { type: String, default: "global" },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

/* =====================================================
   ⚡ Configuración de Redis
   ===================================================== */
const REDIS_TTL_SECONDS = 3600; // 1 hora
const REDIS_MAX_LOGS = 100; // últimos 100 eventos por usuario

/* =====================================================
   🧠 Registrar actividad + Sync Redis + WS
   ===================================================== */
ActivityLogSchema.statics.log = async function (data) {
  try {
    const { userId, email, type, description, meta, region } = data || {};
    if (!type) throw new Error("❌ Tipo de log requerido");

    const entry = await this.create({
      userId,
      email,
      type,
      description: description || "",
      meta: meta || {},
      region: region || "global",
      createdAt: new Date(),
    });

    const redis = await initRedis().catch(() => null);
    const socketService = getSocketService?.();

    // 🔁 Redis Sync (compatible con lpush / lPush)
    if (redis && (userId || email)) {
      const key = `activitylog:${userId || email}`;
      const payload = JSON.stringify({
        activityId: entry._id.toString(),
        type,
        description,
        meta,
        createdAt: entry.createdAt,
      });

      const lpush = redis.lpush || redis.lPush;
      const ltrim = redis.ltrim || redis.lTrim;

      if (lpush && ltrim) {
        await Promise.allSettled([
          lpush.call(redis, key, payload),
          ltrim.call(redis, key, 0, REDIS_MAX_LOGS - 1),
          redis.expire?.(key, REDIS_TTL_SECONDS),
        ]);
      } else if (process.env.DEBUG_USER_ACTIVITY === "true") {
        console.warn(
          chalk.yellow(
            "⚠️ Redis no tiene comandos de lista lpush/ltrim disponibles"
          )
        );
      }
    }

    // 🔊 WebSocket Sync
    if (socketService && (userId || email)) {
      const channel = `activity:${userId?.toString?.() || email}`;
      socketService.emitToUser?.(userId || email, "activity:log:new", {
        activityId: entry._id,
        type,
        description,
        meta,
        createdAt: entry.createdAt,
      });
      socketService.broadcast?.(channel, {
        type,
        description,
        meta,
        createdAt: entry.createdAt,
      });
    }

    if (process.env.DEBUG_USER_ACTIVITY === "true") {
      console.log(
        chalk.greenBright(
          `🧾 [ActivityLog] ${type} → ${email || userId} (${entry._id.toString()})`
        )
      );
    }

    return entry;
  } catch (err) {
    console.error(chalk.red("❌ [ActivityLog.log] Error:"), err.message);
    return null;
  }
};

/* =====================================================
   🔍 Últimos logs (con Redis fallback)
   ===================================================== */
ActivityLogSchema.statics.findRecent = async function (identifier, limit = 20) {
  try {
    const redis = await initRedis().catch(() => null);
    const key = `activitylog:${identifier}`;

    if (redis) {
      const lrange = redis.lrange || redis.lRange;
      if (lrange) {
        const cached = await lrange.call(redis, key, 0, limit - 1);
        if (cached?.length) return cached.map((json) => JSON.parse(json));
      }
    }

    const query = mongoose.isValidObjectId(identifier)
      ? { userId: identifier }
      : { email: identifier };

    const logs = await this.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return logs.map((log) => ({
      activityId: log._id.toString(),
      type: log.type,
      description: log.description,
      meta: log.meta,
      createdAt: log.createdAt,
    }));
  } catch (err) {
    console.error(chalk.red("❌ [ActivityLog.findRecent] Error:"), err.message);
    return [];
  }
};

/* =====================================================
   ⚙️ Índices optimizados
   ===================================================== */
ActivityLogSchema.index({ userId: 1, createdAt: -1 });
ActivityLogSchema.index({ email: 1, createdAt: -1 });
ActivityLogSchema.index({ type: 1 });
ActivityLogSchema.index({ region: 1 });

/* =====================================================
   ✅ Exportación del modelo
   ===================================================== */
export const ActivityLog =
  mongoose.models.ActivityLog || mongoose.model("ActivityLog", ActivityLogSchema);
