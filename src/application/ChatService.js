/**
 * 💬 ChatService.js (v4.3 PRO – 2025)
 * ------------------------------------------------------
 * ✔ RedisProvider v10.7 compatible
 * ✔ message.mediaSize / mediaMime / thumbnailUrl
 * ✔ Fix multimedia con multer.diskStorage
 * ✔ Fix markAsRead sync WS + Redis
 * ✔ Soft delete + restore 100% consistente
 * ✔ AES encrypt/decrypt
 * ✔ ChatKey soportado
 * ✔ Optimizado para 1GB archivos (configurable)
 */

import fs from "fs";
import path from "path";
import CryptoJS from "crypto-js";
import Message from "../domain/Message.js";

import {
  getRedis,
  saveMessageToRedis,
  getHistoryFromRedis,
} from "../infrastructure/RedisProvider.js";

import { UserActivityService } from "./UserActivityService.js";
import { UserActivity } from "../domain/UserActivity.js";

/* =====================================================
   🔐 CIFRADO AES
====================================================== */
export function encryptMessage(text, key) {
  if (!key || !text) return text;
  try {
    return CryptoJS.AES.encrypt(text, key).toString();
  } catch {
    return text;
  }
}

export function decryptMessage(ciphertext, key) {
  if (!key || !ciphertext) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8) || "⚠️ Mensaje ilegible";
  } catch {
    return "⚠️ Mensaje ilegible";
  }
}

/* =====================================================
   💬 SERVICIO PRINCIPAL DE CHAT
====================================================== */
export class ChatService {
  /**
   * 📤 Enviar mensaje (texto o multimedia)
   */
  static async sendMessage({
    from,
    to,
    text = "",
    mediaFile = null,
    mediaType = null,
    chatKey = null,
    wsEmit = null,
  }) {
    try {
      const room = [from, to].sort().join("_");

      let mediaUrl = null;
      let mediaSize = 0;
      let mediaMime = null;

      /* ========================================================
         📁 Guardar MULTIMEDIA en filesystem
      ======================================================== */
      let type = "text";

      if (mediaFile) {
        mediaMime = mediaFile.mimetype;
        mediaSize = mediaFile.size || 0;

        if (mediaMime.startsWith("video")) type = "video";
        else if (mediaMime.startsWith("audio")) type = "audio";
        else type = "image";

        const userDir = path.resolve(`./uploads/${from}`);
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

        const filename = mediaFile.filename; // multer.diskStorage LO HACE
        const filePath = path.join(userDir, filename);

        // multer ya guardó el archivo, no necesitamos escribirlo
        mediaUrl = `/uploads/${from}/${filename}`;
      }

      /* ========================================================
         🔐 Cifrar texto
      ======================================================== */
      const encryptedText =
        type === "text" && chatKey ? encryptMessage(text, chatKey) : text;

      /* ========================================================
         📝 Crear modelo
      ======================================================== */
      const msg = await Message.create({
        room,
        from,
        to,
        text: encryptedText,
        type,
        mediaUrl,
        mediaSize,
        mediaMime,
        chatKey: chatKey || null,
        deleted: false,
        read: false,
        timestamp: new Date(),
      });

      /* ========================================================
         💾 Guardar en Redis (para historial rápido)
      ======================================================== */
      await saveMessageToRedis(room, msg.toObject());

      const fullMessage = {
        ...msg.toObject(),
        decryptedText:
          type === "text" && chatKey
            ? decryptMessage(encryptedText, chatKey)
            : text,
      };

      /* ========================================================
         📡 Emitir WS (sender + receiver)
      ======================================================== */
      if (wsEmit) wsEmit("NEW_MESSAGE", fullMessage);

      /* ========================================================
         📣 Actualizar UserActivity
      ======================================================== */
      await ChatService._updateUserActivityOnMessage(from, to, room);

      return fullMessage;
    } catch (err) {
      console.error("❌ Error enviando mensaje:", err);
      throw new Error("Error enviando mensaje");
    }
  }

  /* =====================================================
     🟩 UserActivity Sync
  ====================================================== */
  static async _updateUserActivityOnMessage(from, to, room) {
    try {
      let activity = await UserActivity.findOne({ userId: to });

      if (!activity) {
        activity = new UserActivity({ userId: to, notifications: [], chats: [] });
      }

      const idx = activity.chats.findIndex((c) => c.chatId === room);

      if (idx >= 0) {
        activity.chats[idx].unreadCount++;
        activity.chats[idx].lastMessageAt = new Date();
      } else {
        activity.chats.push({
          chatId: room,
          unreadCount: 1,
          lastMessageAt: new Date(),
        });
      }

      await activity.save();

      await UserActivityService.addNotification(
        to,
        "chat",
        `Nuevo mensaje de ${from}`
      );

      await UserActivityService.updateUserStatus(from, "online");
    } catch (err) {
      console.error("⚠️ Error actividad usuario:", err);
    }
  }

  /* =====================================================
     📜 Obtener historial
  ====================================================== */
  static async getHistory(userA, userB, limit = 200, chatKey = null, includeDeleted = false) {
    try {
      const room = [userA, userB].sort().join("_");

      let messages = await getHistoryFromRedis(room);

      /* Si Redis está vacío → cargar de Mongo */
      if (!messages?.length) {
        const query = includeDeleted ? { room } : { room, deleted: false };

        const history = await Message.find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .lean();

        messages = history.reverse();
      }

      if (!includeDeleted) {
        messages = messages.filter((m) => !m.deleted);
      }

      return messages.slice(-limit).map((m) => ({
        ...m,
        decryptedText:
          m.type === "text" && chatKey
            ? decryptMessage(m.text, chatKey)
            : m.text,
      }));
    } catch (err) {
      console.error("❌ Error cargando historial:", err);
      return [];
    }
  }

  /* =====================================================
     🟢 Marcar como leído
  ====================================================== */
  static async markAsRead(room, userId) {
    try {
      await Message.updateMany(
        { room, to: userId, read: false },
        { $set: { read: true } }
      );

      const redis = await getRedis();

      if (redis) {
        const list = await getHistoryFromRedis(room);

        const updated = list.map((m) =>
          m.to === userId ? { ...m, read: true } : m
        );

        const key = `chat:${room}:messages`;
        const pipe = redis.pipeline();

        pipe.del(key);
        updated.forEach((msg) => pipe.rpush(key, JSON.stringify(msg)));

        await pipe.exec();
      }

      // reset unreadCount
      await UserActivity.updateOne(
        { userId, "chats.chatId": room },
        { $set: { "chats.$.unreadCount": 0 } }
      );
    } catch (err) {
      console.error("❌ markAsRead:", err);
    }
  }

  /* =====================================================
     🗑 Soft delete
  ====================================================== */
  static async softDeleteMessage(messageId, actorId, wsEmit = null) {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) throw new Error("Mensaje no encontrado");

      const allowed =
        String(msg.from) === String(actorId) ||
        String(msg.to) === String(actorId);

      if (!allowed) throw new Error("No autorizado");

      msg.deleted = true;
      msg.deletedAt = new Date();
      msg.deletedBy = actorId;
      msg.updatedAt = new Date();
      await msg.save();

      // Sync Redis
      const redis = await getRedis();
      if (redis) {
        const key = `chat:${msg.room}:messages`;
        const list = await redis.lrange(key, 0, -1);

        for (let i = 0; i < list.length; i++) {
          const row = JSON.parse(list[i]);
          if (row._id === messageId) {
            row.deleted = true;
            row.deletedAt = msg.deletedAt;
            row.deletedBy = actorId;
            row.updatedAt = msg.updatedAt;
            await redis.lset(key, i, JSON.stringify(row));
            break;
          }
        }
      }

      const payload = {
        messageId,
        room: msg.room,
        deletedBy: actorId,
        deletedAt: msg.deletedAt,
      };

      if (wsEmit) wsEmit("message_deleted", payload);

      return payload;
    } catch (err) {
      console.error("❌ softDelete:", err);
      throw err;
    }
  }

  /* =====================================================
     ♻ Restaurar mensaje
  ====================================================== */
  static async restoreMessage(messageId, actorId, wsEmit = null) {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) throw new Error("Mensaje no encontrado");

      if (!msg.deleted) throw new Error("No está eliminado");

      const allowed =
        String(msg.from) === String(actorId) ||
        String(msg.to) === String(actorId) ||
        String(msg.deletedBy) === String(actorId);

      if (!allowed) throw new Error("No autorizado");

      msg.deleted = false;
      msg.deletedAt = null;
      msg.deletedBy = null;
      msg.updatedAt = new Date();
      await msg.save();

      // Redis sync
      const redis = await getRedis();
      if (redis) {
        const key = `chat:${msg.room}:messages`;
        const list = await redis.lrange(key, 0, -1);

        for (let i = 0; i < list.length; i++) {
          const row = JSON.parse(list[i]);
          if (row._id === messageId) {
            row.deleted = false;
            row.deletedAt = null;
            row.deletedBy = null;
            row.updatedAt = msg.updatedAt;
            await redis.lset(key, i, JSON.stringify(row));
            break;
          }
        }
      }

      const payload = {
        messageId,
        room: msg.room,
        restoredBy: actorId,
      };

      if (wsEmit) wsEmit("message_restored", payload);

      return payload;
    } catch (err) {
      console.error("❌ restore:", err);
      throw err;
    }
  }

  /* =====================================================
     🧹 PURGE FÍSICO
  ====================================================== */
  static async purgeDeleted(olderThanMs = 1000 * 60 * 60 * 24 * 30) {
    try {
      const threshold = new Date(Date.now() - olderThanMs);
      const res = await Message.deleteMany({
        deleted: true,
        deletedAt: { $lt: threshold },
      });

      console.log(`🧹 Purge → ${res.deletedCount} mensajes eliminados`);
      return res.deletedCount;
    } catch (err) {
      console.error("❌ purge:", err);
      throw err;
    }
  }

  /* =====================================================
     🗑 BORRAR TODO EL ROOM
  ====================================================== */
  static async deleteRoomHistory(room) {
    try {
      await Message.deleteMany({ room });

      const redis = await getRedis();
      if (redis) await redis.del(`chat:${room}:messages`);
    } catch (err) {
      console.error("❌ deleteRoomHistory:", err);
    }
  }
}

export default ChatService;
