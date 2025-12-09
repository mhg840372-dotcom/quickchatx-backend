// ======================================================
// 💾 src/application/UserActivityService.legacy.js
// ✅ QuickChatX v8.7 — Compatibilidad Retroactiva (v5–v8)
// ------------------------------------------------------
// • Presencia, notificaciones y llamadas
// • WS, Redis, Mongo integrados
// • Fallback seguro sin dependencias rotas
// • + Stubs ligeros para A/B testing (no rompen nada)
// ======================================================

import chalk from "chalk";
import { getRedis } from "../infrastructure/RedisProvider.js";
import { UserActivity } from "../domain/UserActivity.js";

let socketServiceRef = null;

/* ======================================================
   🔌 attachSocketService (si no se inyecta en el nuevo)
====================================================== */
export function attachSocketService(socketService) {
  socketServiceRef = socketService;
  console.log(chalk.cyan("🔗 [legacy] SocketService vinculado"));
}

/* ======================================================
   ⚙️ Redis Helper — Fallback seguro
====================================================== */
async function safeRedis() {
  try {
    return await getRedis();
  } catch (err) {
    console.warn(chalk.yellow("⚠️ Redis no disponible (legacy mode)"));
    return null;
  }
}

/* ======================================================
   🧠 updateUserStatus — Estado (online/offline/away)
====================================================== */
export async function updateUserStatus(userId, status) {
  try {
    const redis = await safeRedis();
    const key = `user:status:${userId}`;

    if (redis) {
      await redis.set(key, status, "EX", 300); // 5 min TTL
    }

    await UserActivity.updateOne(
      { userId },
      { $set: { status, lastStatusAt: new Date() } },
      { upsert: true }
    );

    socketServiceRef?.emitToAll?.("user:status:update", { userId, status });

    console.log(chalk.gray(`🌐 Estado actualizado: ${userId} → ${status}`));
  } catch (err) {
    console.error(chalk.red("❌ Error en updateUserStatus:"), err);
  }
}

/* ======================================================
   ⏰ updateLastOnline — Marca la hora de salida
====================================================== */
export async function updateLastOnline(userId) {
  try {
    await UserActivity.updateOne(
      { userId },
      { $set: { lastOnline: new Date() } },
      { upsert: true }
    );

    const redis = await safeRedis();
    if (redis) await redis.del(`user:status:${userId}`);

    socketServiceRef?.emitToAll?.("user:offline", { userId });

    console.log(chalk.gray(`🕒 Última conexión actualizada → ${userId}`));
  } catch (err) {
    console.error(chalk.red("❌ Error en updateLastOnline:"), err);
  }
}

/* ======================================================
   ✉️ addNotification — Notificación instantánea
====================================================== */
export async function addNotification(userId, notification) {
  try {
    const redis = await safeRedis();
    const now = new Date();

    const record = { ...notification, createdAt: now };

    await UserActivity.updateOne(
      { userId },
      { $push: { notifications: record } },
      { upsert: true }
    );

    if (redis) {
      const key = `user:notifications:${userId}`;
      await redis.lpush(key, JSON.stringify(record));
      await redis.ltrim(key, 0, 50);
    }

    socketServiceRef?.emitToUser?.(userId, "user:notification:new", record);

    console.log(chalk.blue(`🔔 Notificación enviada a ${userId}`));
  } catch (err) {
    console.error(chalk.red("❌ Error en addNotification:"), err);
  }
}

/* ======================================================
   ✅ markNotificationsAsRead — Marca como leídas
====================================================== */
export async function markNotificationsAsRead(userId) {
  try {
    await UserActivity.updateOne(
      { userId },
      { $set: { "notifications.$[].read": true } }
    );

    const redis = await safeRedis();
    if (redis) await redis.del(`user:notifications:${userId}`);

    socketServiceRef?.emitToUser?.(userId, "user:notification:read_all");

    console.log(chalk.gray(`📭 Notificaciones leídas para ${userId}`));
  } catch (err) {
    console.error(
      chalk.red("❌ Error en markNotificationsAsRead:"),
      err
    );
  }
}

/* ======================================================
   💬 setTypingStatus — Indicador “escribiendo...”
====================================================== */
export async function setTypingStatus(userId, chatId, isTyping) {
  try {
    const redis = await safeRedis();
    const key = `chat:${chatId}:typing:${userId}`;

    if (redis) {
      if (isTyping) await redis.set(key, "1", "EX", 10);
      else await redis.del(key);
    }

    socketServiceRef?.emitToRoom?.("chat:" + chatId, "chat:typing:update", {
      userId,
      chatId,
      isTyping,
    });
  } catch (err) {
    console.error(chalk.red("❌ Error en setTypingStatus:"), err);
  }
}

/* ======================================================
   📞 setCurrentCall — Control de llamadas activas
====================================================== */
export async function setCurrentCall(userId, callData) {
  try {
    await UserActivity.updateOne(
      { userId },
      { $set: { currentCall: callData } },
      { upsert: true }
    );

    socketServiceRef?.emitToUser?.(userId, "user:call:update", callData);
  } catch (err) {
    console.error(chalk.red("❌ Error en setCurrentCall:"), err);
  }
}

/* ======================================================
   🧩 registerUserAction — Registro simple (click, vista)
====================================================== */
export async function registerUserAction(userId, action) {
  try {
    const now = new Date();

    await UserActivity.updateOne(
      { userId },
      {
        $push: {
          actions: { type: action, createdAt: now },
        },
      },
      { upsert: true }
    );

    console.log(chalk.gray(`🧩 Acción registrada: ${userId} → ${action}`));
  } catch (err) {
    console.error(chalk.red("❌ Error en registerUserAction:"), err);
  }
}

/* ======================================================
   🔍 getUserActivity — Recupera logs de actividad
====================================================== */
export async function getUserActivity(userId) {
  try {
    const redis = await safeRedis();
    if (redis) {
      const logs = await redis.lrange(
        `user:activity:logs:${userId}`,
        0,
        50
      );
      return logs.map((x) => JSON.parse(x));
    }

    const user = await UserActivity.findOne({ userId }).lean();
    return user?.logs || [];
  } catch (err) {
    console.error(chalk.red("❌ Error en getUserActivity:"), err);
    return [];
  }
}

/* ======================================================
   ⚡ getUserStatusFast — Solo estado actual (Redis)
====================================================== */
export async function getUserStatusFast(userId) {
  try {
    const redis = await safeRedis();
    if (redis) {
      return (await redis.get(`user:status:${userId}`)) || "offline";
    }
    const user = await UserActivity.findOne({ userId }).lean();
    return user?.status || "offline";
  } catch {
    return "offline";
  }
}

/* ======================================================
   🟢 getActiveUsers — Lista rápida de usuarios online
====================================================== */
export async function getActiveUsers() {
  try {
    const redis = await safeRedis();
    if (!redis) return [];
    const keys = await redis.keys("user:status:*");
    return keys.map((k) => k.replace("user:status:", ""));
  } catch {
    return [];
  }
}

/* ======================================================
   🔄 handleUserDisconnect — Cierre de sesión / socket
====================================================== */
export async function handleUserDisconnect(userId) {
  await updateLastOnline(userId);
}

/* ======================================================
   🔁 syncPresenceWithSocket — WS <-> Redis/Mongo Sync
====================================================== */
export async function syncPresenceWithSocket(userId, socketId) {
  try {
    const redis = await safeRedis();
    if (redis) {
      await redis.set(`socket:${socketId}:user`, userId, "EX", 600);
      await redis.set(`user:${userId}:socket`, socketId, "EX", 600);
    }

    await updateUserStatus(userId, "online");
  } catch (err) {
    console.error(chalk.red("❌ Error en syncPresenceWithSocket:"), err);
  }
}

/* ======================================================
   🧪 Stubs ligeros A/B (legacy) — no rompen nada
====================================================== */

// Hash simple determinístico para elegir variante
function hashStringToInt(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export async function getOrAssignExperimentVariant(
  userId,
  experimentKey,
  variants
) {
  try {
    if (!userId || !experimentKey || !variants?.length) return null;

    const redis = await safeRedis();
    const redisKey = `exp:${experimentKey}:${userId}`;

    if (redis) {
      const cached = await redis.get(redisKey);
      if (cached) return cached;
    }

    const idx = hashStringToInt(String(userId)) % variants.length;
    const variant = variants[idx];

    if (redis) {
      await redis.set(redisKey, variant, "EX", 60 * 60 * 24);
    }

    console.log(
      chalk.gray(
        `🧪 [legacy] Experimento ${experimentKey} → ${userId}: ${variant}`
      )
    );
    return variant;
  } catch (err) {
    console.error(
      chalk.red("❌ [legacy] Error en getOrAssignExperimentVariant:"),
      err
    );
    return null;
  }
}

export async function logFeedExposure(_payload) {
  // En legacy solo logueamos a consola para no romper nada
  console.log(
    chalk.gray("📰 [legacy] logFeedExposure recibido (no-op ligero)")
  );
}

export async function logContentView(_payload) {
  console.log(
    chalk.gray("👁️ [legacy] logContentView recibido (no-op ligero)")
  );
}

export async function logContentInteraction(_payload) {
  console.log(
    chalk.gray(
      "🎯 [legacy] logContentInteraction recibido (no-op ligero)"
    )
  );
}

/* ======================================================
   ✅ QuickChatX v8.7 — Legacy Final
   ------------------------------------------------------
   • Totalmente sincronizado con UserActivityService.js
   • WS + Redis + Mongo + Fallback seguro
   • Soporte completo para presencia y eventos
   • Stubs A/B testing compatibles sin romper versiones viejas
====================================================== */
