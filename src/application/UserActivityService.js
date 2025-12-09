// ======================================================
// 📡 src/application/UserActivityService.js
// ✅ QuickChatX v9.3 — Actividad distribuida (Mongo + Redis + WS chat/calls)
// ======================================================

import chalk from "chalk";
import { UserActivity } from "../domain/UserActivity.js";
import { ActivityLog } from "../domain/ActivityLog.js";
import { initRedis } from "../infrastructure/RedisProvider.js";

let socketServiceRef = null;

// ======================================================
// 🔌 Vincular instancia de SocketService
// ======================================================
function attachSocketService(serviceInstance) {
  if (!serviceInstance) {
    console.warn(
      chalk.yellow("⚠️ attachSocketService() llamado sin instancia válida")
    );
    return;
  }
  socketServiceRef = serviceInstance;
  console.log(
    chalk.cyan(
      "🔗 UserActivityService conectado correctamente a SocketService"
    )
  );
}

// ======================================================
// ⚙️ Obtener instancia actual de socketService
// ======================================================
function getSocketService() {
  return socketServiceRef;
}

// ======================================================
// 🧠 Redis seguro (fallback silencioso)
// ======================================================
async function safeRedis() {
  try {
    return await initRedis();
  } catch {
    console.warn(chalk.yellow("⚠️ Redis no disponible temporalmente"));
    return null;
  }
}

// ======================================================
// 🔧 Helper común para comandos de lista (node-redis v4 / ioredis)
// ======================================================
function getRedisListFns(redis) {
  if (!redis) return { lpush: null, ltrim: null };
  const lpush = redis.lPush || redis.lpush;
  const ltrim = redis.lTrim || redis.ltrim;
  return { lpush, ltrim };
}

const flattenHash = (hash = {}) =>
  Object.entries(hash).flatMap(([k, v]) => [k, v]);

function hsetCompat(client, key, hash) {
  if (!client) return null;
  if (typeof client.hSet === "function") return client.hSet(key, hash);
  if (typeof client.hset === "function")
    return client.hset(key, ...flattenHash(hash));
  if (typeof client.hmset === "function") return client.hmset(key, hash);
  return null;
}

// Helper: push + trim con pipeline si está disponible
async function pushListWithTrim(redis, key, payload, start, end) {
  if (!redis) return;

  if (typeof redis.pipeline === "function") {
    const pipe = redis.pipeline();
    pipe.lpush(key, payload);
    pipe.ltrim(key, start, end);
    await pipe.exec();
    return;
  }

  const { lpush, ltrim } = getRedisListFns(redis);
  if (lpush && ltrim) {
    await lpush.call(redis, key, payload);
    await ltrim.call(redis, key, start, end);
  } else {
    console.warn(
      chalk.yellow(
        "⚠️ Redis cliente sin lpush/ltrim en pushListWithTrim"
      )
    );
  }
}

// ======================================================
// 🔢 Helpers para A/B testing (hash determinístico)
// ======================================================
function hashStringToInt(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function chooseVariant(userId, variants) {
  if (!userId || !Array.isArray(variants) || variants.length === 0) return null;
  const h = hashStringToInt(String(userId));
  return variants[h % variants.length];
}

// ======================================================
// 🧪 getOrAssignExperimentVariant — asignación estable
// ======================================================
async function getOrAssignExperimentVariant(
  userId,
  experimentKey,
  variants,
  meta = {}
) {
  try {
    if (!userId || !experimentKey || !variants?.length) return null;

    const redis = await safeRedis();
    const redisKey = `exp:${experimentKey}:${userId}`;

    // 1️⃣ Intentar leer desde Redis
    if (redis) {
      try {
        const cached = await redis.get(redisKey);
        if (cached) return cached;
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠️ getOrAssignExperimentVariant: error leyendo Redis (${redisKey}):`
          ),
          err?.message || err
        );
      }
    }

    // 2️⃣ Buscar en UserActivity (Mongo)
    let activity =
      (await UserActivity.findOne({ userId })) ||
      new UserActivity({ userId, status: "offline" });

    const current =
      activity.experiments?.find((e) => e.key === experimentKey) || null;

    if (current?.variant) {
      // Guardar en Redis con TTL si es posible
      if (redis) {
        try {
          const ttl = 60 * 60 * 24;
          if (typeof redis.pipeline === "function") {
            const pipe = redis.pipeline();
            pipe.set(redisKey, current.variant);
            pipe.expire(redisKey, ttl);
            await pipe.exec();
          } else {
            await redis.set(redisKey, current.variant);
            await redis.expire(redisKey, ttl);
          }
        } catch (err) {
          console.warn(
            chalk.yellow(
              `⚠️ getOrAssignExperimentVariant: error escribiendo Redis (current, ${redisKey}):`
            ),
            err?.message || err
          );
        }
      }
      return current.variant;
    }

    // 3️⃣ Asignar nueva variante determinística
    const variant = chooseVariant(userId, variants);
    if (!variant) return null;

    activity.experiments ||= [];
    activity.experiments.push({
      key: experimentKey,
      variant,
      assignedAt: new Date(),
      meta,
    });

    await activity.save();

    await ActivityLog.create({
      userId,
      type: "EXPERIMENT_EVENT",
      description: `Asignado experimento ${experimentKey} → ${variant}`,
      meta: { experimentKey, variant, ...meta },
      timestamp: new Date(),
    });

    await UserActivity.log({
      userId,
      type: "EXPERIMENT_EVENT",
      description: `Asignado experimento ${experimentKey} → ${variant}`,
      meta: { experimentKey, variant, ...meta },
    });

    // Guardar en Redis con TTL
    if (redis) {
      try {
        const ttl = 60 * 60 * 24;
        if (typeof redis.pipeline === "function") {
          const pipe = redis.pipeline();
          pipe.set(redisKey, variant);
          pipe.expire(redisKey, ttl);
          await pipe.exec();
        } else {
          await redis.set(redisKey, variant);
          await redis.expire(redisKey, ttl);
        }
      } catch (err) {
        console.warn(
          chalk.yellow(
            `⚠️ getOrAssignExperimentVariant: error escribiendo Redis (new, ${redisKey}):`
          ),
          err?.message || err
        );
      }
    }

    console.log(
      chalk.cyan(
        `🧪 Experimento ${experimentKey} asignado a ${userId} → ${variant}`
      )
    );

    return variant;
  } catch (err) {
    console.error(
      chalk.red("❌ Error en getOrAssignExperimentVariant:"),
      err
    );
    return null;
  }
}

// ======================================================
// 🧪 logExperimentEvent — evento custom de experimento
// ======================================================
async function logExperimentEvent(userId, eventName, meta = {}) {
  try {
    if (!userId || !eventName) return false;

    const payloadMeta = { eventName, ...meta };

    await ActivityLog.create({
      userId,
      type: "EXPERIMENT_EVENT",
      description: eventName,
      meta: payloadMeta,
      timestamp: new Date(),
    });

    await UserActivity.log({
      userId,
      type: "EXPERIMENT_EVENT",
      description: eventName,
      meta: payloadMeta,
    });

    return true;
  } catch (err) {
    console.error(chalk.red("❌ Error en logExperimentEvent:"), err);
    return false;
  }
}

// ======================================================
// 📰 logFeedExposure — cuando se sirve un feed al usuario
// ======================================================
async function logFeedExposure({
  userId,
  experimentKey = null,
  variant = null,
  algoName = null,
  items = [],
  meta = {},
}) {
  try {
    if (!userId) return false;

    const now = new Date();
    const trimmedItems = Array.isArray(items)
      ? items.slice(0, 200).map((x, idx) => ({
          id: x.id || x._id || x.postId || x.newsId || null,
          type: x.type || "post",
          position: x.position ?? idx,
          score: x.score ?? x.finalScore ?? null,
          similarTo: x.similarTo || null,
        }))
      : [];

    const baseMeta = {
      experimentKey,
      variant,
      algoName,
      items: trimmedItems,
      ...meta,
    };

    await ActivityLog.create({
      userId,
      type: "FEED_EXPOSURE",
      description: "Feed servido al usuario",
      meta: baseMeta,
      timestamp: now,
    });

    await UserActivity.log({
      userId,
      type: "FEED_EXPOSURE",
      description: "Feed servido al usuario",
      meta: baseMeta,
    });

    const redis = await safeRedis();
    if (redis) {
      try {
        const key = `user:feed:exposures:${userId}`;
        const payload = JSON.stringify({
          at: now.toISOString(),
          experimentKey,
          variant,
          algoName,
          items: trimmedItems,
        });

        await pushListWithTrim(redis, key, payload, 0, 49);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error logFeedExposure (Redis):"),
          err?.message || err
        );
      }
    }

    return true;
  } catch (err) {
    console.error(chalk.red("❌ Error en logFeedExposure:"), err);
    return false;
  }
}

// ======================================================
// 👁️ logContentView — vista de contenido con duración
// ======================================================
async function logContentView({
  userId,
  contentId,
  contentType = "post",
  durationMs = 0,
  fullyViewed = false,
  algoVariant = null,
  algoName = null,
  rank = null,
  position = null,
  meta = {},
}) {
  try {
    if (!userId || !contentId) return false;

    const now = new Date();
    const baseMeta = {
      contentId,
      contentType,
      durationMs,
      fullyViewed,
      algoVariant,
      algoName,
      rank,
      position,
      ...meta,
    };

    await ActivityLog.create({
      userId,
      type: "CONTENT_VIEW",
      description: `Vista de ${contentType}`,
      meta: baseMeta,
      timestamp: now,
    });

    await UserActivity.log({
      userId,
      type: "CONTENT_VIEW",
      description: `Vista de ${contentType}`,
      meta: baseMeta,
    });

    const redis = await safeRedis();
    if (redis) {
      try {
        const key = `user:content:views:${userId}`;
        const payload = JSON.stringify({
          at: now.toISOString(),
          ...baseMeta,
        });

        await pushListWithTrim(redis, key, payload, 0, 199);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error logContentView (Redis):"),
          err?.message || err
        );
      }
    }

    return true;
  } catch (err) {
    console.error(chalk.red("❌ Error en logContentView:"), err);
    return false;
  }
}

// ======================================================
// 🎯 logContentInteraction — like / comment / share...
// ======================================================
async function logContentInteraction({
  userId,
  contentId,
  contentType = "post",
  action,
  algoVariant = null,
  algoName = null,
  rank = null,
  position = null,
  meta = {},
}) {
  try {
    if (!userId || !contentId || !action) return false;

    const now = new Date();
    const baseMeta = {
      contentId,
      contentType,
      action,
      algoVariant,
      algoName,
      rank,
      position,
      ...meta,
    };

    await ActivityLog.create({
      userId,
      type: "CONTENT_INTERACTION",
      description: `${action} en ${contentType}`,
      meta: baseMeta,
      timestamp: now,
    });

    await UserActivity.log({
      userId,
      type: "CONTENT_INTERACTION",
      description: `${action} en ${contentType}`,
      meta: baseMeta,
    });

    const redis = await safeRedis();
    if (redis) {
      try {
        const key = `user:content:interactions:${userId}`;
        const payload = JSON.stringify({
          at: now.toISOString(),
          ...baseMeta,
        });

        await pushListWithTrim(redis, key, payload, 0, 199);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error logContentInteraction (Redis):"),
          err?.message || err
        );
      }
    }

    return true;
  } catch (err) {
    console.error(chalk.red("❌ Error en logContentInteraction:"), err);
    return false;
  }
}

// ======================================================
// 🧩 Registro de actividad genérica del usuario
// ======================================================
async function registerUserAction(userId, action, details = {}) {
  try {
    await ActivityLog.create({
      userId,
      type: action.toUpperCase(),
      description: details.description || `Acción: ${action}`,
      meta: details,
      timestamp: new Date(),
    });

    const redis = await safeRedis();
    if (redis) {
      try {
        const key = `user:activity:${userId}`;
        const payload = JSON.stringify({
          action,
          at: new Date().toISOString(),
          meta: details,
        });

        await pushListWithTrim(redis, key, payload, 0, 99);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error registerUserAction (Redis):"),
          err?.message || err
        );
      }
    }

    console.log(chalk.green(`🧠 Acción registrada → ${userId}: ${action}`));
    return true;
  } catch (err) {
    console.error(
      chalk.red("❌ Error registrando acción de usuario:"),
      err
    );
    return false;
  }
}

// ======================================================
// 🔔 Enviar notificación persistente + WS (si aplica)
// ======================================================
async function addNotification(userId, type, message, extra = {}) {
  try {
    const now = new Date();
    let activity = await UserActivity.findOne({ userId });
    if (!activity) activity = new UserActivity({ userId });

    activity.notifications ||= [];
    activity.notifications.push({
      type,
      message,
      read: false,
      meta: extra,
      createdAt: now,
    });

    if (activity.notifications.length > 300)
      activity.notifications.splice(0, activity.notifications.length - 300);

    await activity.save();

    const redis = await safeRedis();
    if (redis) {
      try {
        const key = `user:notifications:${userId}`;
        const payload = JSON.stringify({
          id: `notif_${Date.now()}`,
          type,
          message,
          meta: extra,
          createdAt: now.toISOString(),
          read: false,
        });

        await pushListWithTrim(redis, key, payload, 0, 99);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error addNotification (Redis):"),
          err?.message || err
        );
      }
    }

    await ActivityLog.create({
      userId,
      type: "NOTIFICATION_SENT",
      description: message,
      meta: extra,
    });

    const payload = { userId, type, message, extra, createdAt: now };
    socketServiceRef?.emitToUser?.(
      userId,
      "user:notification:new",
      payload
    );

    console.log(
      chalk.green(`🔔 Notificación enviada → ${userId}: ${message}`)
    );
    return payload;
  } catch (err) {
    console.error(chalk.red("❌ Error al agregar notificación:"), err);
    throw err;
  }
}

// ======================================================
// 🟢 Actualizar estado del usuario
// ======================================================
async function updateUserStatus(userId, status = "offline", meta = {}) {
  try {
    const now = new Date();

    await UserActivity.updateOne(
      { userId },
      {
        $set: {
          status,
          lastSeen: now,
          lastOnline: status === "online" ? now : undefined,
          ip: meta.ip || null,
          device: meta.device || "unknown",
          userAgent: meta.userAgent || null,
          platform: meta.platform || null,
          lastAction: status === "online" ? "USER_ONLINE" : "USER_OFFLINE",
          lastActionAt: now,
        },
        $setOnInsert: { userId },
      },
      { upsert: true }
    );

    const redis = await safeRedis();
    if (redis) {
      try {
        const ttl = status === "online" ? 1200 : 300;
        const statusKey = `user:${userId}:status`;
        const metaKey = `user:meta:${userId}`;
        const metaPayload = {
          status,
          ip: meta.ip || "",
          device: meta.device || "unknown",
          updatedAt: now.toISOString(),
        };

        if (typeof redis.pipeline === "function") {
          const pipe = redis.pipeline();
          pipe.set(statusKey, status, "EX", ttl);
          hsetCompat(pipe, metaKey, metaPayload);
          await pipe.exec();
        } else {
          await redis.set(statusKey, status, "EX", ttl);
          await hsetCompat(redis, metaKey, metaPayload);
        }
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error updateUserStatus (Redis):"),
          err?.message || err
        );
      }
    }

    await ActivityLog.create({
      userId,
      type: "STATUS_CHANGE",
      description: `Estado actualizado a ${status}`,
      meta,
    });

    const payload = { userId, status, at: now };
    socketServiceRef?.emitToUser?.(
      userId,
      "user:status:update",
      payload
    );
    socketServiceRef?.emitToRoom?.(
      "system:presence",
      "user:status:update",
      payload
    );

    console.log(chalk.blue(`🟢 Estado actualizado (${userId}) → ${status}`));
    return payload;
  } catch (err) {
    console.error(
      chalk.red("❌ Error actualizando estado de usuario:"),
      err
    );
    throw err;
  }
}

// ======================================================
// ✍️ Estado de escritura (typing)
// ======================================================
async function setTypingStatus(userId, chatId, isTyping) {
  try {
    if (!chatId) return;
    const now = new Date();

    let activity =
      (await UserActivity.findOne({ userId })) ||
      new UserActivity({ userId });
    activity.typing = {
      isTyping: Boolean(isTyping),
      chatId,
      updatedAt: now,
    };
    await activity.save();

    const redis = await safeRedis();
    if (redis) {
      try {
        const key = `chat:${chatId}:typing:${userId}`;
        if (isTyping) await redis.set(key, "1", "EX", 10);
        else await redis.del(key);
      } catch (err) {
        console.warn(
          chalk.yellow("⚠️ Error setTypingStatus (Redis):"),
          err?.message || err
        );
      }
    }

    const payload = {
      userId,
      chatId,
      isTyping: Boolean(isTyping),
      at: now,
    };
    socketServiceRef?.emitToRoom?.(
      chatId,
      "chat:typing:update",
      payload
    );

    await ActivityLog.create({
      userId,
      type: "TYPING_STATUS",
      description: `${
        isTyping ? "Escribiendo" : "Dejó de escribir"
      } en chat ${chatId}`,
      meta: { chatId, isTyping },
    });

    console.log(
      chalk.magenta(
        `✍️ ${userId} ${isTyping ? "escribiendo" : "detuvo"} en ${chatId}`
      )
    );
    return payload;
  } catch (err) {
    console.error(
      chalk.red("❌ Error actualizando estado de escritura:"),
      err
    );
    throw err;
  }
}

// ======================================================
// 📞 Gestión de llamadas
// ======================================================
async function setCurrentCall(
  userId,
  { callId, type, action, participants = [] }
) {
  try {
    let activity =
      (await UserActivity.findOne({ userId })) ||
      new UserActivity({ userId });
    activity.calls ||= [];
    activity.currentCall ||= null;

    if (action === "start") {
      activity.calls.push({
        callId,
        type,
        participants,
        startedAt: new Date(),
      });
      activity.currentCall = {
        callId,
        type,
        startedAt: new Date(),
        participants,
      };
    } else if (action === "end") {
      const c = activity.calls.find(
        (c) => c.callId === callId && !c.endedAt
      );
      if (c) {
        c.endedAt = new Date();
        c.duration = c.endedAt - c.startedAt;
      }
      if (activity.currentCall?.callId === callId)
        activity.currentCall = null;
    }

    if (activity.calls.length > 100)
      activity.calls.splice(0, activity.calls.length - 100);
    await activity.save();

    await ActivityLog.create({
      userId,
      type: "CALL_EVENT",
      description: `Llamada ${action} (${type})`,
      meta: { callId, participants },
    });

    const payload = {
      userId,
      callId,
      type,
      action,
      participants,
      at: new Date(),
    };
    socketServiceRef?.emitToRoom?.("calls", "call:update", payload);
    console.log(
      chalk.cyan(`📞 ${userId} → ${action} llamada (${type})`)
    );
    return payload;
  } catch (err) {
    console.error(chalk.red("❌ Error gestionando llamada:"), err);
    throw err;
  }
}

// ======================================================
// 🧩 Objeto unificado + export dual + compatibilidad retro
// ======================================================
const UserActivityService = {
  attachSocketService,
  getSocketService,
  registerUserAction,
  addNotification,
  updateUserStatus,
  setTypingStatus,
  setCurrentCall,
  // A/B & recomendador
  getOrAssignExperimentVariant,
  logExperimentEvent,
  logFeedExposure,
  logContentView,
  logContentInteraction,
};

export default UserActivityService;
export {
  UserActivityService,
  attachSocketService,
  getSocketService,
  registerUserAction,
  addNotification,
  updateUserStatus,
  setTypingStatus,
  setCurrentCall,
  // A/B & recomendador
  getOrAssignExperimentVariant,
  logExperimentEvent,
  logFeedExposure,
  logContentView,
  logContentInteraction,
};
