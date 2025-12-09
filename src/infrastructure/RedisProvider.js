// ======================================================
// ⚙️ src/infrastructure/RedisProvider.js
// 🚀 QuickChatX v10.7 — RedisProvider FULL COMPAT + fixes 2025
// ======================================================

import Redis from "ioredis";
import chalk from "chalk";
import dotenv from "dotenv";
import { performance } from "node:perf_hooks";

dotenv.config();

/* ======================================================
   ⚙️ Config
====================================================== */
const REDIS_CONF = {
  mode: process.env.REDIS_MODE || "single",
  nodes: process.env.REDIS_NODES ? process.env.REDIS_NODES.split(",") : [],
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
  sentinelName: process.env.REDIS_SENTINEL_NAME || null,
  tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  url: process.env.REDIS_URL || null,
};

let redisClient = null;
let redisInitPromise = null;
let lastState = "offline";
let lastAlertTime = 0;
let reconnectAttempts = 0;
let stopReconnect = false;

const REDIS_SLOW_CMD_MS = Number(process.env.REDIS_SLOW_CMD_MS || 150);

/* ======================================================
   📊 Métricas
====================================================== */
const metrics = {
  setOps: 0,
  getOps: 0,
  delOps: 0,
  pubOps: 0,
  subOps: 0,
  pushOps: 0,
  readOps: 0,
  errors: 0,
  reconnectAttemptsTotal: 0,
  lastCommandLatencyMs: 0,
  maxCommandLatencyMs: 0,
};

/* ======================================================
   🧪 Instrumentación
====================================================== */
function instrumentClient(client) {
  if (!client || client.__qcxInstrumented) return;
  client.__qcxInstrumented = true;

  const original = client.sendCommand;

  client.sendCommand = function patched(cmd) {
    const start = performance.now();
    const p = original.call(this, cmd);

    if (!p?.then) return p;

    return p
      .then((res) => {
        const ms = performance.now() - start;
        metrics.lastCommandLatencyMs = ms;
        metrics.maxCommandLatencyMs = Math.max(metrics.maxCommandLatencyMs, ms);

        if (ms > REDIS_SLOW_CMD_MS) {
          console.warn(
            chalk.yellow(
              `⏱️ Redis lento (${cmd.name}) → ${ms.toFixed(1)}ms`
            )
          );
        }

        return res;
      })
      .catch((err) => {
        const ms = performance.now() - start;
        metrics.lastCommandLatencyMs = ms;
        metrics.maxCommandLatencyMs = Math.max(metrics.maxCommandLatencyMs, ms);
        throw err;
      });
  };
}

/* ======================================================
   🔌 Crear Cliente
====================================================== */
function createRedisClient() {
  const mode = REDIS_CONF.mode.toLowerCase();

  reconnectAttempts = 0;
  stopReconnect = false;

  if (mode === "cluster") {
    console.log(chalk.cyan("🔗 Redis Cluster"));

    const cluster = new Redis.Cluster(
      REDIS_CONF.nodes.map((n) => {
        const [host, port] = n.split(":");
        return { host, port: Number(port) };
      }),
      {
        redisOptions: {
          password: REDIS_CONF.password,
          tls: REDIS_CONF.tls,
          db: REDIS_CONF.db,
          enableAutoPipelining: true,
        },
      }
    );

    instrumentClient(cluster);
    return cluster;
  }

  if (mode === "sentinel") {
    console.log(chalk.cyan("🛰️ Redis Sentinel"));

    const client = new Redis({
      sentinels: REDIS_CONF.nodes.map((n) => {
        const [host, port] = n.split(":");
        return { host, port: Number(port) };
      }),
      name: REDIS_CONF.sentinelName,
      password: REDIS_CONF.password,
      db: REDIS_CONF.db,
      tls: REDIS_CONF.tls,
      enableAutoPipelining: true,
    });

    instrumentClient(client);
    return client;
  }

  const uri = REDIS_CONF.url || `redis://${REDIS_CONF.host}:${REDIS_CONF.port}`;
  console.log(chalk.cyan(`🔗 Redis Single → ${uri}`));

  const client = new Redis(uri, {
    password: REDIS_CONF.password,
    db: REDIS_CONF.db,
    tls: REDIS_CONF.tls,
    maxRetriesPerRequest: null,
    enableAutoPipelining: true,
    retryStrategy(times) {
      metrics.reconnectAttemptsTotal++;
      reconnectAttempts++;

      if (reconnectAttempts > 10) stopReconnect = true;
      return stopReconnect ? null : Math.min(times * 500, 4000);
    },
  });

  instrumentClient(client);
  return client;
}

/* ======================================================
   🎧 Listeners
====================================================== */
function attachListeners(client) {
  client.on("ready", () => {
    console.log(chalk.green("🟢 Redis READY"));
    lastState = "ready";
  });

  client.on("error", (err) => {
    metrics.errors++;
    console.error("❌ Redis error:", err.message);
    lastState = "error";
  });

  client.on("end", () => {
    console.warn(chalk.red("🔴 Redis desconectado"));
    lastState = "disconnected";
  });
}

/* ======================================================
   ♻️ initRedis
====================================================== */
export async function initRedis() {
  if (redisClient?.status === "ready") return redisClient;

  if (!redisInitPromise) {
    redisInitPromise = (async () => {
      const client = createRedisClient();
      attachListeners(client);

      try {
        await client.ping();
      } catch (err) {
        console.warn("⚠️ Redis ping falló:", err.message);
      }

      redisClient = client;
      return client;
    })();
  }

  return redisInitPromise;
}

/* ======================================================
   getRedis
====================================================== */
export async function getRedis() {
  if (redisClient?.status === "ready") return redisClient;
  return await initRedis();
}

/* ======================================================
   🚀 ADD: getRedisClient (fix UserActivityController)
====================================================== */
export const getRedisClient = getRedis;

/* ======================================================
   saveMessageToRedis
====================================================== */
export async function saveMessageToRedis(room, message, maxHistory = 200) {
  try {
    const client = await getRedis();
    const key = `chat:${room}:messages`;

    const payload =
      typeof message === "string" ? message : JSON.stringify(message);

    await client.rpush(key, payload);
    await client.ltrim(key, -maxHistory, -1);

    metrics.pushOps++;
    return true;
  } catch (err) {
    metrics.errors++;
    console.warn("⚠️ Redis saveMessage:", err.message);
    return false;
  }
}

/* ======================================================
   getHistoryFromRedis
====================================================== */
export async function getHistoryFromRedis(room, limit = 200) {
  try {
    const client = await getRedis();
    const key = `chat:${room}:messages`;

    const list = await client.lrange(key, -limit, -1);
    metrics.readOps++;

    return list.map((row) => {
      try {
        return JSON.parse(row);
      } catch {
        return row;
      }
    });
  } catch (err) {
    metrics.errors++;
    return [];
  }
}

/* ======================================================
   Helpers
====================================================== */
export async function setValue(key, value, ttl) {
  const client = await getRedis();
  const str = JSON.stringify(value);
  metrics.setOps++;

  if (ttl) return client.set(key, str, "EX", ttl);
  return client.set(key, str);
}

export async function getValue(key) {
  const client = await getRedis();
  metrics.getOps++;

  const val = await client.get(key);
  if (!val) return null;

  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

export async function deleteValue(key) {
  const client = await getRedis();
  metrics.delOps++;
  return client.del(key);
}

export function getRedisMetrics() {
  return metrics;
}

export async function getRedisStatus() {
  try {
    const client = await getRedis();
    return {
      status: client.status,
      lastState,
      metrics,
      mode: REDIS_CONF.mode,
    };
  } catch {
    return {
      status: "offline",
      lastState,
      metrics,
      mode: REDIS_CONF.mode,
    };
  }
}
