import express from "express";
import os from "os";
import client from "prom-client"; // Prometheus metrics
import { MongoProvider } from "../../infrastructure/MongoProvider.js";
import Redis from "ioredis";

const router = express.Router();

// ===============================
// 📊 Configuración de Prometheus
// ===============================
client.collectDefaultMetrics({
  prefix: "quickchatx_",
  timeout: 5000,
});

// Métricas personalizadas
const mongoStatusGauge = new client.Gauge({
  name: "quickchatx_mongo_status",
  help: "Estado de conexión MongoDB (0=down, 1=up)",
});

const redisStatusGauge = new client.Gauge({
  name: "quickchatx_redis_status",
  help: "Estado de conexión Redis (0=down, 1=up)",
});

const uptimeGauge = new client.Gauge({
  name: "quickchatx_process_uptime_seconds",
  help: "Tiempo de actividad del proceso en segundos",
});

const memoryUsageGauge = new client.Gauge({
  name: "quickchatx_memory_rss_megabytes",
  help: "Uso de memoria RSS del proceso en MB",
});

const requestCounter = new client.Counter({
  name: "quickchatx_health_requests_total",
  help: "Número total de solicitudes al endpoint /api/health",
});

// ===============================
// 🧠 Helpers
// ===============================
const mongoStateLabel = (state) => {
  switch (state) {
    case 0: return "disconnected";
    case 1: return "connected";
    case 2: return "connecting";
    case 3: return "disconnecting";
    default: return "unknown";
  }
};

async function checkRedis() {
  if (!process.env.REDIS_URL) return { available: false, state: "not_configured" };
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  try {
    await redis.connect();
    await redis.ping();
    await redis.quit();
    return { available: true, state: "connected" };
  } catch (err) {
    return { available: true, state: "error", error: err.message };
  }
}

async function checkRabbitMQ() {
  if (!process.env.RABBITMQ_URL) return { available: false, state: "not_configured" };
  try {
    const amqp = await import("amqplib");
    const conn = await amqp.connect(process.env.RABBITMQ_URL);
    await conn.close();
    return { available: true, state: "connected" };
  } catch (err) {
    return { available: true, state: "error", error: err.message };
  }
}

function checkSocketIO(io) {
  if (!io) return { available: false, state: "not_configured" };
  const clients = io.engine?.clientsCount || 0;
  return { available: true, state: "running", clients };
}

// ===============================
// 🩺 /api/health
// ===============================
router.get("/", async (req, res) => {
  requestCounter.inc();
  const start = Date.now();

  try {
    const uptimeSec = process.uptime();
    const memory = process.memoryUsage();
    const mongoState = mongoStateLabel(global?.mongoose?.connection?.readyState ?? 0);
    const dbStatus = MongoProvider.getStatus();

    const [redisStatus, rabbitStatus] = await Promise.all([
      checkRedis(),
      checkRabbitMQ(),
    ]);
    const socketStatus = checkSocketIO(global.io);

    // Actualizar métricas Prometheus
    uptimeGauge.set(uptimeSec);
    memoryUsageGauge.set(Math.round(memory.rss / 1024 / 1024));
    mongoStatusGauge.set(mongoState === "connected" ? 1 : 0);
    redisStatusGauge.set(redisStatus.state === "connected" ? 1 : 0);

    const result = {
      service: "quickchatx-backend",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      uptime: `${Math.round(uptimeSec)}s`,
      version: process.env.APP_VERSION || "1.0.0",
      latencyMs: Date.now() - start,
      hostname: os.hostname(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        loadavg: os.loadavg(),
        freeMemMB: Math.round(os.freemem() / 1024 / 1024),
        totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      },
      memory: {
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
      },
      dependencies: {
        mongo: dbStatus,
        redis: redisStatus,
        rabbitmq: rabbitStatus,
        socketio: socketStatus,
      },
    };

    const allHealthy =
      mongoState === "connected" &&
      (!redisStatus.available || redisStatus.state === "connected") &&
      (!rabbitStatus.available || rabbitStatus.state === "connected");

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "ok" : "degraded",
      ...result,
    });
  } catch (err) {
    console.error("❌ Error en /api/health:", err);
    res.status(500).json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ===============================
// 📈 /metrics (Prometheus endpoint)
// ===============================
router.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).send(`Error generando métricas: ${err.message}`);
  }
});

export default router;
