import { Server as IOServer } from "socket.io";
import chalk from "chalk";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { initRedis } from "../../infrastructure/RedisProvider.js"; // Cambié a initRedis

/* ======================================================
   ⚙️ Configuración Global
====================================================== */
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_TLS = process.env.REDIS_TLS === "true";
const EVENT_CHANNEL = "quickchatx:events";

/* ======================================================
   🚀 Clase principal SocketService
====================================================== */
class SocketService {
  constructor() {
    this.io = null;
    this.redisPub = null;
    this.redisSub = null;
    this._pubsubReady = false;
    this._userSocketIndex = new Map();
  }

  async init(httpServer) {
    if (!httpServer) {
      console.warn(chalk.yellow("⚠️ init() sin httpServer — instancia no inicializada"));
      return;
    }
    this.httpServer = httpServer;

    // Configuración Redis
    await this._setupRedis();
    await this._setupSocketIO(httpServer);
    this._setupNamespaces();

    console.log(chalk.greenBright("✅ SocketService inicializado para Chat y Videollamadas"));
  }

  /* ======================================================
     🔗 Redis Setup
  ====================================================== */
  async _setupRedis() {
    try {
      const coreRedis = await initRedis(); // Cambio a initRedis
      const options = { host: REDIS_HOST, port: REDIS_PORT, tls: REDIS_TLS ? {} : undefined };

      // Conexión a Redis (pub/sub)
      this.redisPub = coreRedis?.duplicate?.() || new Redis(options);
      this.redisSub = coreRedis?.duplicate?.() || new Redis(options);

      this.redisPub.on("connect", () => console.log(chalk.cyan("🔗 RedisPub conectado")));
      this.redisSub.on("connect", () => console.log(chalk.cyan("🔗 RedisSub conectado")));

      this._pubsubReady = true;
    } catch (err) {
      console.error(chalk.red("❌ Error inicializando Redis:"), err.message);
      this._pubsubReady = false;
    }
  }

  /* ======================================================
     ⚙️ Socket.IO Setup
  ====================================================== */
  async _setupSocketIO(httpServer) {
    this.io = new IOServer(httpServer, {
      cors: { origin: process.env.CLIENT_URL || "*", methods: ["GET", "POST"] },
      transports: ["websocket", "polling"],
      pingTimeout: 25000,
      pingInterval: 10000,
      connectionStateRecovery: { maxDisconnectionDuration: 120000 },
    });

    if (this._pubsubReady) {
      try {
        this.io.adapter(createAdapter(this.redisPub, this.redisSub));
        console.log(chalk.cyan("🔗 RedisAdapter conectado a Socket.IO"));
      } catch (err) {
        console.warn(chalk.yellow("⚠️ RedisAdapter no disponible:"), err.message);
      }
    }
  }

  /* ======================================================
     🧠 Namespaces (solo para chat y llamadas)
  ====================================================== */
  _setupNamespaces() {
    const namespaces = {
      "/chats": "💬 Chat",
      "/calls": "📞 Calls",
    };

    for (const [path, label] of Object.entries(namespaces)) {
      this.io.of(path).on("connection", (socket) => {
        console.log(chalk.cyan(`${label} → conectado: ${socket.id}`));

        socket.on("private_message", ({ to, message }) => {
          if (to) this.emitToUser(to, "private_message", { from: socket.id, message });
        });

        socket.on("disconnect", (reason) => {
          console.log(chalk.yellow(`${label} → desconectado: ${socket.id} (${reason})`));
        });
      });
    }
  }

  /* ======================================================
     🎯 Emisión dirigida a un usuario
  ====================================================== */
  emitToUser(userId, event, payload) {
    this._emitLocalToUser(userId, event, payload);
  }

  _emitLocalToUser(userId, event, payload) {
    const socketIds = this._userSocketIndex.get(userId);
    if (socketIds && this.io) {
      for (const id of socketIds) {
        const socket = this.io.sockets.sockets.get(id);
        if (socket) socket.emit(event, payload);
      }
    }

    if (this._pubsubReady) {
      this.redisPub.publish(
        EVENT_CHANNEL,
        JSON.stringify({ action: "emitToUser", userId, event, payload })
      );
    }
  }

  /* ======================================================
     🔄 Redis Pub/Sub para sincronización entre servidores
  ====================================================== */
  _subscribeRedisEvents() {
    this.redisSub.subscribe(EVENT_CHANNEL, (err) => {
      if (err) console.error("❌ No se pudo suscribir a Redis:", err);
    });

    this.redisSub.on("message", (channel, message) => {
      if (channel !== EVENT_CHANNEL) return;
      try {
        const { action, userId, event, payload } = JSON.parse(message);
        if (action === "emitToUser") this._emitLocalToUser(userId, event, payload);
      } catch (err) {
        console.error(chalk.red("❌ Error procesando evento Redis:"), err.message);
      }
    });
  }

  async close() {
    try {
      await Promise.all([
        this.io?.close(),
        this.redisPub?.quit(),
        this.redisSub?.quit(),
      ]);
      console.log(chalk.gray("🧹 SocketService cerrado correctamente"));
    } catch (err) {
      console.error(chalk.red("❌ Error cerrando SocketService:"), err);
    }
  }
}

/* ======================================================
   🔄 Singleton + Export
====================================================== */
const socketServiceInstance = new SocketService();

export async function createSocketService(httpServer) {
  await socketServiceInstance.init(httpServer);
  return socketServiceInstance;
}

export function getSocketService() {
  return socketServiceInstance;
}

export const socketService = socketServiceInstance;

export default {
  createSocketService,
  getSocketService,
  socketService,
};
