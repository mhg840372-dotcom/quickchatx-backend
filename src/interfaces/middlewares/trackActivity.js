// ======================================================
// 📁 src/interfaces/middlewares/trackActivity.js
// ✅ QuickChatX v8.1 — Middleware unificado de tracking (Express + WS + Redis debounce)
// ======================================================

import chalk from "chalk";
import { performance } from "perf_hooks";
import { UserActivity } from "../../domain/UserActivity.js";
import { getRedis } from "../../infrastructure/RedisProvider.js";
import { getSocketService } from "../websockets/SocketService.js";

// ⏱️ Mínimo intervalo entre escrituras Redis por usuario
const REDIS_ACTIVITY_DEBOUNCE_MS = Number(
  process.env.REDIS_ACTIVITY_DEBOUNCE_MS || 10000 // 10s por defecto
);

// Mapa en memoria: userId -> timestamp última escritura Redis
const lastRedisActivity = new Map();

/**
 * 🧭 trackActivity(req, res, next)
 * ------------------------------------------------------
 * Middleware inteligente y no bloqueante que:
 * - Registra actividad REST en Mongo + Redis
 * - Calcula latencia y persistencia temporal
 * - Emite “user:activity:update” vía WS (cluster-safe)
 * - Detecta bots, servicios internos y usuarios reales
 * - Funciona incluso si Redis o WS están fuera de línea
 */
export async function trackActivity(req, res, next) {
  const start = performance.now();

  res.on("finish", async () => {
    try {
      const user = req.user;
      if (!user || !user.id) return; // no logueado

      const userId = user.id;
      const username = user.username || "guest";
      const role = user.role || "user";
      const now = new Date();
      const nowTs = now.getTime();
      const latency = parseFloat((performance.now() - start).toFixed(1));

      /* ======================================================
         🔍 Detectar tipo de actividad
      ====================================================== */
      const activityType =
        req.activityType ||
        req.body?.action ||
        req.route?.path?.replace("/", "") ||
        req.method ||
        "heartbeat";

      const isSystem =
        ["bot", "system", "service"].includes(role) ||
        username.startsWith("sys_") ||
        username.startsWith("bot_");

      /* ======================================================
         🌐 Información contextual
      ====================================================== */
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        req.ip ||
        "unknown";

      const userAgent = req.headers["user-agent"] || "unknown";

      /* ======================================================
         💾 Actualización asíncrona en MongoDB
      ====================================================== */
      const update = {
        $set: {
          lastOnline: now,
          lastAction: activityType,
          lastActionAt: now,
          ip,
          userAgent,
          latency,
          role,
        },
      };

      UserActivity.updateOne({ userId }, update, { upsert: true }).catch(
        (err) =>
          console.warn(
            chalk.yellow("⚠️ [trackActivity] Error Mongo:"),
            err.message
          )
      );

      /* ======================================================
         ⚡ Snapshot rápido en Redis (TTL 15 min) con debounce
      ====================================================== */
      const last = lastRedisActivity.get(userId) || 0;
      const elapsed = nowTs - last;

      if (elapsed >= REDIS_ACTIVITY_DEBOUNCE_MS) {
        lastRedisActivity.set(userId, nowTs);

        try {
          const redis = await getRedis();
          if (redis) {
            const ops = [
              redis.set(
                `user:lastOnline:${userId}`,
                now.toISOString(),
                "EX",
                900
              ),
              redis.hSet?.(`user:meta:${userId}`, {
                username,
                role,
                action: activityType,
                latency,
                ip,
                at: now.toISOString(),
              }) ||
                redis.hset?.(
                  `user:meta:${userId}`,
                  "username",
                  username,
                  "role",
                  role,
                  "action",
                  activityType,
                  "latency",
                  String(latency),
                  "ip",
                  ip,
                  "at",
                  now.toISOString()
                ),
            ].filter(Boolean);

            // Fire-and-forget: no bloqueamos el event loop por latencias de red
            Promise.allSettled(ops).catch(() => {});
          }
        } catch (redisErr) {
          console.warn(
            chalk.yellow("⚠️ [trackActivity] Redis no disponible:"),
            redisErr.message
          );
        }
      }

      /* ======================================================
         🔔 Emitir evento WS (solo si hay socket activo)
      ====================================================== */
      try {
        const socketService =
          req.app?.locals?.socketService || getSocketService?.() || null;

        if (socketService?.emitToUser) {
          socketService.emitToUser(userId, "user:activity:update", {
            userId,
            username,
            role,
            lastOnline: now,
            action: activityType,
            latency,
            isSystem,
          });
        }
      } catch {
        console.warn(chalk.gray("⚠️ [trackActivity] WS no disponible"));
      }

      /* ======================================================
         🧾 Logging en entorno no productivo
      ====================================================== */
      if (process.env.NODE_ENV !== "production") {
        const ts = now.toLocaleTimeString();
        console.log(
          chalk.cyanBright(
            `📶 [${isSystem ? "SYS" : "USER"}] ${username} (${userId}) → ${activityType} @ ${ts} | ${latency}ms`
          )
        );
      }
    } catch (err) {
      console.warn(
        chalk.yellow("⚠️ [trackActivity] Error general:"),
        err.message
      );
    }
  });

  // 🚀 Continuar flujo Express inmediatamente
  next();
}

// ======================================================
// ✅ QuickChatX v8.1 — Mejoras clave
// ------------------------------------------------------
// - 🧩 Integración total con AuthMiddleware v8 (req.user normalizado)
// - ⚡ Registro no bloqueante en Mongo + Redis resiliente
// - 🔔 Emisión WS cluster-safe (emitToUser + Redis Pub/Sub)
// - 🧠 Detección automática de bots/sistemas
// - 🕓 TTL Redis extendido a 15 min
// - 🧱 Debounce de escrituras Redis por usuario (reduce comandos set/hset)
// - 🧾 Logging estructurado y entorno-aware
// ======================================================
