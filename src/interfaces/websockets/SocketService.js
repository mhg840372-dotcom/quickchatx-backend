// ======================================================
// 🌐 src/interfaces/websockets/SocketService.js — FIX v10.8 (2025)
// ------------------------------------------------------
// ✔ ChatService integrado (send, delete, restore, read)
// ✔ Typing real
// ✔ Namespaces: chats / calls / activity
// ✔ Redis Pub/Sub multi-servidor
// ✔ userId real (no socket.id)
// ✔ FULL compatible con tu frontend actual
// ======================================================

import { Server as IOServer } from "socket.io";
import chalk from "chalk";
import { createAdapter } from "@socket.io/redis-adapter";
import { initRedis } from "../../infrastructure/RedisProvider.js";

import { registerConnection, unregisterConnection } from "./socketMetrics.js";
import { ChatService } from "../../application/ChatService.js";
import CallService from "../../application/CallService.js";

class SocketService {
  constructor() {
    this.io = null;

    this.redisPub = null;
    this.redisSub = null;
    this._pubsubReady = false;

    this.clients = new Map();
    this._userSocketIndex = new Map();
  }

  async init(httpServer) {
    if (!httpServer) return;

    this.httpServer = httpServer;

    await this._setupRedis();
    await this._setupSocketIO(httpServer);
    this._setupNamespaces();

    if (this._pubsubReady) this._subscribeRedisEvents();

    console.log(chalk.green("✅ SocketService listo (chat + calls + redis sync)"));
  }

  // ======================================================
  // 🔗 Redis Setup
  // ======================================================
  async _setupRedis() {
    try {
      const baseRedis = await initRedis();

      this.redisPub = baseRedis.duplicate();
      this.redisSub = baseRedis.duplicate();

      this._pubsubReady = true;

      console.log(chalk.cyan("🔗 Redis duplicado para pub/sub"));
    } catch (err) {
      console.error("❌ Redis no disponible:", err.message);
      this._pubsubReady = false;
    }
  }

  // ======================================================
  // ⚙️ SocketIO Setup
  // ======================================================
  async _setupSocketIO(httpServer) {
    this.io = new IOServer(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      transports: ["websocket", "polling"],
    });

    if (this._pubsubReady) {
      this.io.adapter(createAdapter(this.redisPub, this.redisSub));
      console.log(chalk.cyan("🔗 RedisAdapter conectado"));
    }
  }

  // ======================================================
  // 🧠 Namespaces
  // ======================================================
  _setupNamespaces() {
    const namespaces = {
      "/chats": "💬 Chats",
      "/calls": "📞 Calls",
      "/activity": "🧾 Activity",
    };

    for (const [path, label] of Object.entries(namespaces)) {
      const ns = this.io.of(path);

      ns.on("connection", (socket) => {
        const userId = socket.handshake.query.userId;
        const username = socket.handshake.query.username || "anon";

        if (!userId) {
          socket.disconnect();
          return;
        }

        // Registrar session
        this.clients.set(socket.id, { userId, username });

        if (!this._userSocketIndex.has(userId))
          this._userSocketIndex.set(userId, []);

        this._userSocketIndex.get(userId).push(socket.id);

        registerConnection(userId, username);

        console.log(
          chalk.green(`${label} conectado → ${userId} (${socket.id})`)
        );

        socket.emit("connected", { id: socket.id, user: username });

        // ======================================================
        // 🔥 HANDLERS para namespace de CHAT
        // ======================================================
        if (path === "/chats") {
          this._attachChatHandlers(socket, userId);
        }

        // ======================================================
        // 🔥 HANDLERS para CALLS
        // ======================================================
        if (path === "/calls") {
          this._attachCallHandlers(socket, userId);
        }

        socket.on("disconnect", () => {
          unregisterConnection(userId);
          this.clients.delete(socket.id);

          const list = this._userSocketIndex.get(userId) || [];

          this._userSocketIndex.set(
            userId,
            list.filter((id) => id !== socket.id)
          );

          console.log(chalk.yellow(`${label} desconectado → ${userId}`));
        });
      });
    }
  }

  // ======================================================
  // 💬 Chat Handlers
  // ======================================================
  _attachChatHandlers(socket, userId) {
    // 1️⃣ NEW MESSAGE
    socket.on("private_message", async ({ to, message, type = "text" }) => {
      try {
        if (!to || !message) return;

        await ChatService.sendMessage({
          from: userId,
          to,
          text: message,
          mediaType: type,
          chatKey: null,
          mediaFile: null,
          wsEmit: (event, payload) => {
            this.emitToUser(to, event, payload);
            this.emitToUser(userId, event, payload);
          },
        });
      } catch (err) {
        console.error("❌ error private_message:", err.message);
      }
    });

    // 2️⃣ Typing
    socket.on("typing", ({ to }) => {
      if (!to) return;
      this.emitToUser(to, "typing", { from: userId });
    });

    // 3️⃣ Mark Read
    socket.on("mark_read", async ({ room }) => {
      try {
        await ChatService.markAsRead(room, userId);
        this.emitToUser(userId, "messages_read", { room });
      } catch (err) {
        console.error("❌ mark_read error:", err.message);
      }
    });

    // 4️⃣ Delete message
    socket.on("delete_message", async ({ messageId }) => {
      try {
        await ChatService.softDeleteMessage(
          messageId,
          userId,
          (event, data) => {
            this.emitToUser(data.deletedBy, event, data);
          }
        );
      } catch (err) {
        console.error("❌ delete_message error:", err.message);
      }
    });

    // 5️⃣ Restore message
    socket.on("restore_message", async ({ messageId }) => {
      try {
        await ChatService.restoreMessage(
          messageId,
          userId,
          (event, data) => {
            this.emitToUser(data.restoredBy, event, data);
          }
        );
      } catch (err) {
        console.error("❌ restore_message error:", err.message);
      }
    });
  }

  // ======================================================
  // 📞 Call Handlers
  // ======================================================
  _attachCallHandlers(socket, userId) {
    // Entrante
    socket.on("start_call", async ({ receiverId, type }) => {
      try {
        const call = await CallService.startCall({
          callerId: userId,
          receiverId,
          type,
          socketService: this,
        });
      } catch (err) {
        console.error("❌ start_call error:", err.message);
      }
    });

    // Aceptar
    socket.on("accept_call", async ({ callId }) => {
      try {
        await CallService.acceptCall(callId, userId, this);
      } catch (err) {
        console.error("❌ accept_call error:", err.message);
      }
    });

    // Rechazar
    socket.on("reject_call", async ({ callId }) => {
      try {
        await CallService.rejectCall(callId, userId, this);
      } catch (err) {
        console.error("❌ reject_call error:", err.message);
      }
    });

    // Finalizar
    socket.on("end_call", async ({ callId }) => {
      try {
        await CallService.endCall(callId, userId, this);
      } catch (err) {
        console.error("❌ end_call error:", err.message);
      }
    });
  }

  // ======================================================
  // 🔄 Redis Sync
  // ======================================================
  _subscribeRedisEvents() {
    this.redisSub.subscribe("quickchatx:events");

    this.redisSub.on("message", (channel, msg) => {
      try {
        const { action, userId, event, payload } = JSON.parse(msg);

        if (action === "emitToUser") {
          this._emitLocalToUser(userId, event, payload, false);
        }
      } catch {}
    });
  }

  // ======================================================
  // 🎯 Emisión
  // ======================================================
  emitToUser(userId, event, payload) {
    this._emitLocalToUser(userId, event, payload, true);
  }

  _emitLocalToUser(userId, event, payload, broadcastRedis = true) {
    const sockets = this._userSocketIndex.get(userId);

    if (sockets) {
      for (const id of sockets) {
        const sock = this.io.sockets.sockets.get(id);
        if (sock) sock.emit(event, payload);
      }
    }

    if (broadcastRedis && this._pubsubReady) {
      this.redisPub.publish(
        "quickchatx:events",
        JSON.stringify({ action: "emitToUser", userId, event, payload })
      );
    }
  }
}

// ======================================================
// SINGLETON EXPORTS
// ======================================================

const socketServiceInstance = new SocketService();

export async function createSocketService(httpServer) {
  await socketServiceInstance.init(httpServer);
  return socketServiceInstance;
}

export function getSocketService() {
  return socketServiceInstance;
}

export default socketServiceInstance;
