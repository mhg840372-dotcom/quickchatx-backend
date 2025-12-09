// ======================================================
// 💓 ReactionService.js
// ✅ Maneja likes y reacciones en publicaciones
// 🚀 QuickChatX v4.0.0 — Estable, optimizado + tracking PRO
// ======================================================

import { Post } from "../domain/Post.js";
import { PostModel } from "../infrastructure/models/PostModel.js";
import { UserInterestService } from "./UserInterestService.js";
import { logContentInteraction } from "./UserActivityService.js";

/**
 * 🧩 Servicio de Reacciones
 * - Gestiona likes y reacciones en publicaciones
 * - Compatible con el sistema de notificaciones y métricas
 */
export class ReactionService {
  /**
   * ❤️ Alternar "like" en una publicación
   */
  static async toggleLike(postId, userId) {
    if (!postId || !userId) {
      throw new Error("Faltan parámetros obligatorios (postId, userId)");
    }

    try {
      const postDoc = await PostModel.findById(postId);
      if (!postDoc)
        throw new Error(`Publicación no encontrada (ID: ${postId})`);

      const post = new Post(postDoc.toObject());
      post.toggleLike(userId);

      postDoc.likes = post.likes;
      await postDoc.save();

      const liked = postDoc.likes.some(
        (id) => id.toString() === userId.toString()
      );

      console.log(
        `💓 [ReactionService] Usuario ${userId} ${
          liked ? "dio like" : "quitó like"
        } en publicación ${postId}`
      );

      // 🧠 Actualizar intereses básicos (solo cuando da like)
      try {
        if (liked) {
          await UserInterestService.registerPostInteraction({
            userId,
            post: postDoc,
            type: "like",
          });
        }
      } catch (err) {
        console.error(
          "⚠️ [ReactionService] Error actualizando intereses:",
          err?.message || err
        );
      }

      // 📊 Log de interacción para A/B / analítica
      try {
        await logContentInteraction({
          userId,
          contentId: postId,
          contentType: "post",
          action: liked ? "like" : "clear",
          // no tenemos aquí variant/algoName, pero se puede extender luego
        });
      } catch (err) {
        console.error(
          "⚠️ [ReactionService] Error registrando interacción:",
          err?.message || err
        );
      }

      return {
        liked,
        totalLikes: postDoc.likes.length,
      };
    } catch (err) {
      console.error("❌ Error en ReactionService.toggleLike:", err);
      throw new Error("No se pudo procesar la reacción en la publicación");
    }
  }

  /**
   * 🔢 Obtener contador de likes
   */
  static async getLikeCount(postId) {
    if (!postId) throw new Error("Falta el parámetro postId");

    try {
      const post = await PostModel.findById(postId).select("likes");
      return post ? post.likes.length : 0;
    } catch (err) {
      console.error("⚠️ Error obteniendo contador de likes:", err);
      return 0;
    }
  }

  /**
   * 🧍‍♂️ Verificar si el usuario ya dio like
   */
  static async hasUserLiked(postId, userId) {
    if (!postId || !userId) return false;

    try {
      const post = await PostModel.findById(postId).select("likes");
      return post?.likes?.some((id) => id.toString() === userId.toString());
    } catch (err) {
      console.error("⚠️ Error verificando like del usuario:", err);
      return false;
    }
  }
}

export default ReactionService;
