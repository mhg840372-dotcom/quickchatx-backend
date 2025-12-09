// ======================================================
// 🩺 src/interfaces/controllers/RedisHealthController.js
// ✅ QuickChatX v4.5.1 — Controlador de estado y diagnóstico Redis
// ======================================================

import chalk from "chalk";
import os from "os";
import { initRedis, getRedisStatus } from "../../infrastructure/RedisProvider.js";

/**
 * 🧠 Obtener información del sistema + Redis
 * ------------------------------------------------------
 * Devuelve un resumen del estado actual del servicio Redis:
 * conexión, latencia, memoria, modo y número de reconexiones.
 */
export async function getRedisHealth(req, res) {
  try {
    const client = await initRedis(); // Inicializa el cliente de Redis de forma segura
    const status = await getRedisStatus(); // Obtener el estado de Redis

    // 📡 Latencia con PING
    const start = Date.now();
    const pong = await client.ping();
    const latency = Date.now() - start;

    // 💾 Información de memoria
    const infoRaw = await client.info("memory");
    const memoryUsed =
      parseInt(infoRaw.match(/used_memory_human:(.*?)\r\n/)?.[1] || 0, 10) || "N/A";

    const uptime = process.uptime();

    const diagnostics = {
      ok: true,
      message: "Redis operativo",
      service: "RedisProvider",
      redis: {
        pong,
        ...status, // Añadir el estado obtenido
        latencyMs: latency,
        memoryUsed,
      },
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        loadavg: os.loadavg(),
        uptime,
        timestamp: new Date(),
      },
    };

    if (process.env.NODE_ENV !== "production") {
      console.log(chalk.greenBright("🩺 Redis Health Check:"), diagnostics.redis);
    }

    res.status(200).json(diagnostics);
  } catch (err) {
    console.error(chalk.red("❌ Error obteniendo estado de Redis:"), err.message);
    res.status(500).json({
      ok: false,
      error: err.message,
      service: "RedisProvider",
      redis: await getRedisStatus(), // Llamar a getRedisStatus() de manera segura
    });
  }
}
