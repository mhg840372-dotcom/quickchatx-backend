// ======================================================
// 📊 src/infrastructure/MonitoringService.js
// ✅ QuickChatX v8.2 — Módulo de monitoreo y reportes
// ======================================================

import os from "os";
import chalk from "chalk";
import { getRedisStatus } from "./RedisProvider.js";
import dotenv from "dotenv";

dotenv.config();

/* ======================================================
   🧠 generateActivityReport()
   - Devuelve métricas del sistema, Redis y proceso
====================================================== */
export async function generateActivityReport() {
  const redisStatus = await getRedisStatus();

  const report = {
    timestamp: new Date().toISOString(),
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: `${os.uptime()}s`,
      loadavg: os.loadavg(),
      memory: {
        total: Math.round(os.totalmem() / 1024 / 1024) + " MB",
        free: Math.round(os.freemem() / 1024 / 1024) + " MB",
      },
      cpuCount: os.cpus()?.length || 0,
    },
    process: {
      pid: process.pid,
      uptime: `${process.uptime().toFixed(1)}s`,
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      env: process.env.NODE_ENV || "development",
    },
    redis: {
      status: redisStatus.status,
      lastState: redisStatus.lastState,
      connected: redisStatus.connected,
      reconnectAttempts:
        redisStatus.reconnectAttemptsTotal ??
        redisStatus.reconnectAttempts ??
        0,
      metrics: redisStatus.metrics,
      mode: redisStatus.mode,
      host: redisStatus.host,
      db: redisStatus.db,
    },
  };

  console.log(
    chalk.cyan("📊 Generado reporte de actividad:"),
    report.system.hostname
  );
  return report;
}

/* ======================================================
   🧾 generateTextReport()
   - Devuelve versión legible para Telegram o logs
====================================================== */
export async function generateTextReport() {
  const r = await generateActivityReport();
  const { system, process: proc, redis } = r;

  return `
🧠 *QuickChatX — Estado del sistema*
🕓 ${r.timestamp}

💻 *Servidor:* ${system.hostname}
🧩 *SO:* ${system.platform}
⚙️ *CPU:* ${system.cpuCount} núcleos
💾 *Memoria libre:* ${system.memory.free} / ${system.memory.total}
⏱️ *Uptime:* ${proc.uptime}

📡 *Redis:* ${redis.connected ? "🟢 Conectado" : "🔴 Desconectado"} (${redis.status}/${redis.lastState})
🔁 Intentos reconexión: ${redis.reconnectAttempts}
📊 Operaciones: set=${redis.metrics.setOps}, get=${redis.metrics.getOps}, push=${redis.metrics.pushOps}

🚀 *Proceso Node:*
PID ${proc.pid} | ${proc.nodeVersion}
Env: ${proc.env}
`;
}

/* ======================================================
   🔁 Export unificado
====================================================== */
export default {
  generateActivityReport,
  generateTextReport,
};
