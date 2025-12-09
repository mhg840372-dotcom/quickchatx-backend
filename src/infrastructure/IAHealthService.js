// ======================================================
// 🤖 src/infrastructure/IAHealthService.js
// ✅ QuickChatX v7.0 — Servicio de diagnóstico y estado de IA
// ======================================================

import os from "os";
import { getMongoStatus, isMongoConnected } from "./MongoProvider.js";
import { initRedis } from "./RedisProvider.js"; // Actualizado a initRedis

// 🧩 Estado IA global
let aiState = {
  openai: "ok",
  embeddings: "idle",
  lastCheck: null,
  uptime: process.uptime(),
};

export const IAHealthService = {
  /**
   * ✅ Obtiene el estado actual de la IA, Mongo y Redis
   */
  async checkStatus() {
    const mongoStatus = getMongoStatus();

    // Usar initRedis para obtener el estado de Redis
    const redis = await initRedis();
    const redisStatus = redis?.isOpen ? "connected" : "disconnected";

    const uptime = `${process.uptime().toFixed(0)}s`;

    const memory = process.memoryUsage();
    const cpuLoad = os.loadavg();

    aiState.lastCheck = new Date().toISOString();
    aiState.uptime = uptime;

    return {
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpuLoad,
        totalMemMB: (os.totalmem() / 1024 / 1024).toFixed(0),
        freeMemMB: (os.freemem() / 1024 / 1024).toFixed(0),
        uptime,
      },
      mongo: mongoStatus,
      redis: redisStatus,
      ai: aiState,
      node: {
        version: process.version,
        pid: process.pid,
        rssMB: (memory.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: (memory.heapUsed / 1024 / 1024).toFixed(1),
      },
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * 🔄 Actualiza un valor del estado IA
   */
  updateStatus(key, value) {
    aiState[key] = value;
    aiState.lastCheck = new Date().toISOString();
  },
};

export default IAHealthService;
