// ======================================================
// ⚙️ src/workers/UserActivityQueueWorker.js
// ✅ QuickChatX v8.1.0 — Multi-Worker BullMQ
// ------------------------------------------------------
// • Procesamiento distribuido de eventos de usuario
// • Auto-reintentos, prioridades y tolerancia a fallos
// • Integración con SocketService + Redis Provider
// ======================================================

import chalk from "chalk";
import { Worker, Queue, QueueScheduler, JobsOptions } from "bullmq";
import { getRedis } from "../infrastructure/RedisProvider.js";
import { getSocketService } from "../interfaces/websockets/SocketService.js";

const QUEUE_NAME = "user:activity:queue";
let queue, worker, scheduler;

/* ======================================================
   🚀 Inicializar Cola y Worker
====================================================== */
export async function initializeUserActivityQueue() {
  const redis = await getRedis();
  if (!redis) throw new Error("Redis no disponible");

  const connection = redis.options;

  // 🧱 Inicializamos la cola + scheduler (requerido por BullMQ)
  scheduler = new QueueScheduler(QUEUE_NAME, { connection });
  queue = new Queue(QUEUE_NAME, { connection });

  console.log(chalk.cyan(`📦 [BullMQ] Cola inicializada → ${QUEUE_NAME}`));

  // 🧠 Worker concurrente
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { userId, username, lastAction, lastOnline, latency, priority } = job.data;

      try {
        const socketService = getSocketService?.();
        if (socketService?.emitToUser) {
          socketService.emitToUser(userId, "user:activity:update", {
            userId,
            username,
            lastAction,
            lastOnline,
            latency,
            priority,
          });
        }

        if (process.env.DEBUG_USER_ACTIVITY === "true") {
          console.log(
            chalk.blueBright(
              `🎯 [Worker:${QUEUE_NAME}] ${userId} → ${lastAction} (${priority || "normal"})`
            )
          );
        }

        return { ok: true, emitted: true };
      } catch (err) {
        console.error(chalk.red("❌ [Worker] Error procesando evento:"), err.message);
        throw err;
      }
    },
    {
      connection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
    }
  );

  worker.on("failed", (job, err) => {
    console.warn(
      chalk.yellow(
        `⚠️ [Worker] Job ${job.id} falló (${job.name || "anon"}): ${err.message}`
      )
    );
  });

  worker.on("completed", (job) => {
    if (process.env.DEBUG_USER_ACTIVITY === "true") {
      console.log(chalk.green(`✅ [Worker] Job completado → ${job.id}`));
    }
  });
}

/* ======================================================
   📤 Publicar un nuevo evento a la cola
====================================================== */
export async function enqueueUserActivity(activityData, priority = "normal") {
  const redis = await getRedis();
  if (!redis) throw new Error("Redis no disponible");

  if (!queue) {
    const connection = redis.options;
    queue = new Queue(QUEUE_NAME, { connection });
  }

  const opts = {
    priority: priority === "high" ? 1 : priority === "low" ? 10 : 5,
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  };

  await queue.add("user-activity", activityData, opts);

  if (process.env.DEBUG_USER_ACTIVITY === "true") {
    console.log(
      chalk.magenta(
        `📨 [Queue] Encolado → ${activityData.userId} (${activityData.lastAction})`
      )
    );
  }
}

/* ======================================================
   🔁 Standalone
====================================================== */
if (process.argv[1].includes("UserActivityQueueWorker.js")) {
  initializeUserActivityQueue().catch((err) =>
    console.error(chalk.red("❌ Error iniciando Worker Queue:"), err)
  );
}

// ======================================================
// ✅ QuickChatX v8.1.0 — Multi-Worker BullMQ Final
// ------------------------------------------------------
// - 🧩 Integración con Redis resiliente (BullMQ v4.x)
// - ⚙️ Prioridades + reintentos automáticos
// - 💬 Emisión WS concurrente sin duplicación
// - 🚀 Escalable con PM2, Docker o K8s
// ======================================================
