// ======================================================
// 📊 src/interfaces/controllers/RedisMetricsController.js
// ✅ QuickChatX v4.6 — Métricas Prometheus para Redis
// ======================================================

import client from "prom-client";
import chalk from "chalk";
import { initRedis, getRedisStatus } from "../../infrastructure/RedisProvider.js";

/* =====================================================
   📦 Registro y definiciones Prometheus
   ===================================================== */
const register = new client.Registry();

// Etiquetas comunes
register.setDefaultLabels({
  app: "QuickChatX",
  service: "RedisProvider",
});

// Métricas
const redisUp = new client.Gauge({
  name: "redis_up",
  help: "Indica si Redis está operativo (1 = OK, 0 = error)",
});

const redisLatency = new client.Gauge({
  name: "redis_latency_ms",
  help: "Latencia en milisegundos para PING Redis",
});

const redisMemoryUsed = new client.Gauge({
  name: "redis_memory_used_bytes",
  help: "Memoria utilizada por Redis en bytes",
});

const redisReconnects = new client.Counter({
  name: "redis_reconnect_attempts_total",
  help: "Número total de reconexiones de Redis",
});

const redisCommandLatencyLast = new client.Gauge({
  name: "redis_command_latency_last_ms",
  help: "Última latencia de comando medida por RedisProvider.sendCommand",
});

const redisCommandLatencyMax = new client.Gauge({
  name: "redis_command_latency_max_ms",
  help: "Máxima latencia de comando observada desde el arranque",
});

// Registrar todas las métricas
register.registerMetric(redisUp);
register.registerMetric(redisLatency);
register.registerMetric(redisMemoryUsed);
register.registerMetric(redisReconnects);
register.registerMetric(redisCommandLatencyLast);
register.registerMetric(redisCommandLatencyMax);

// Último valor visto de reconnects para evitar contar doble
let lastReconnectCount = 0;

/* =====================================================
   🔍 Controlador principal de métricas Redis
   ===================================================== */
export async function getRedisMetrics(req, res) {
  try {
    const clientRedis = await initRedis(); // Usamos initRedis para obtener la conexión de Redis
    const status = await getRedisStatus();

    // PING para medir latencia
    const start = Date.now();
    await clientRedis.ping();
    const latency = Date.now() - start;

    // Obtener info de memoria
    const info = await clientRedis.info("memory");
    const memMatch = info.match(/used_memory:(\d+)/);
    const usedBytes = memMatch ? parseInt(memMatch[1], 10) : 0;

    // Total de reconnects acumulado en RedisProvider
    const reconnectTotal =
      status?.metrics?.reconnectAttemptsTotal ??
      status?.reconnectAttemptsTotal ??
      0;

    // Actualizar métricas
    redisUp.set(status.connected ? 1 : 0);
    redisLatency.set(latency);
    redisMemoryUsed.set(usedBytes);

    redisCommandLatencyLast.set(
      status.metrics?.lastCommandLatencyMs ?? 0
    );
    redisCommandLatencyMax.set(
      status.metrics?.maxCommandLatencyMs ?? 0
    );

    // ✅ Solo incrementamos el Counter con el delta desde la última vez
    if (reconnectTotal > lastReconnectCount) {
      redisReconnects.inc(reconnectTotal - lastReconnectCount);
      lastReconnectCount = reconnectTotal;
    }

    // Enviar respuesta Prometheus
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());

    if (process.env.NODE_ENV !== "production") {
      console.log(
        chalk.green(
          `📊 Redis metrics — Latency: ${latency}ms | Memory: ${usedBytes} bytes | ReconnectsTotal=${reconnectTotal}`
        )
      );
    }
  } catch (err) {
    redisUp.set(0);
    console.error(
      chalk.red("❌ Error generando métricas Redis:"),
      err.message
    );
    res.status(500).send(`# Error en métricas Redis\n${err.message}`);
  }
}
