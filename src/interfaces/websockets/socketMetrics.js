import Redis from "ioredis";
import { initRedis } from "../../infrastructure/RedisProvider.js";
import chalk from "chalk";

const METRICS_KEY = "quickchatx:socket:connected";
let redisClient;

/* ======================================================
   🧠 Inicializa Redis si no existe
====================================================== */
async function getRedis() {
  if (!redisClient) {
    redisClient = await initRedis();
    redisClient.on("error", (err) => console.error(chalk.red("❌ Redis Metrics Error:"), err));
  }
  return redisClient;
}

/* ======================================================
   ✅ Registrar conexión
====================================================== */
export async function registerConnection(userId, username) {
  try {
    const redis = await getRedis();
    const data = {
      username,
      connectedAt: new Date().toISOString(),
    };
    await redis.hset(METRICS_KEY, userId, JSON.stringify(data));
  } catch (err) {
    console.warn(chalk.yellow("⚠️ Error registrando conexión en métricas:"), err.message);
  }
}

/* ======================================================
   📴 Eliminar conexión
====================================================== */
export async function unregisterConnection(userId) {
  try {
    const redis = await getRedis();
    await redis.hdel(METRICS_KEY, userId);
  } catch (err) {
    console.warn(chalk.yellow("⚠️ Error eliminando conexión en métricas:"), err.message);
  }
}

/* ======================================================
   📊 Obtener lista de usuarios conectados
====================================================== */
export async function getConnectedUsers() {
  try {
    const redis = await getRedis();
    const users = await redis.hgetall(METRICS_KEY);
    return Object.entries(users).map(([userId, value]) => {
      try {
        const parsed = JSON.parse(value);
        return { userId, ...parsed };
      } catch {
        return { userId, username: value, connectedAt: null };
      }
    });
  } catch (err) {
    console.error(chalk.red("❌ Error obteniendo usuarios conectados:"), err.message);
    return [];
  }
}
