// ======================================================
// 📂 src/application/InteractionService.js
// ------------------------------------------------------
// ✅ Solo permite interacciones en POSTS (según tu lógica nueva)
// ✅ Actualiza UserInterest para view / like / dislike / comment
// ✅ Loguea vistas e interacciones para A/B (UserActivityService)
// ✅ Views de IA solo cuentan si el post tiene VIDEO
// ✅ Comentarios en colección propia via CommentService
// ======================================================

import { PostModel } from "../infrastructure/models/PostModel.js";
import { User } from "../domain/User.js";
import { UserInterestService } from "./UserInterestService.js";
import CommentService from "./CommentService.js";
import UserActivityService, {
  logContentView,
  logContentInteraction,
} from "./UserActivityService.js";

/*
  Solo se permiten interacciones (likes, comentarios, vistas)
  en POSTS según tu nueva lógica.
*/

export class InteractionService {
  /* =====================================================
     👁️ Registro de vistas SOLO para Posts (con duración)
     👉 La actualización de intereses SOLO aplica si el post tiene VIDEO
     👉 viewsCount se incrementa solo si tiene al menos un video
     ===================================================== */
  static async registerView({
    itemId,
    type,
    userId,
    durationMs = 0,
    fullyViewed = false,
    algoVariant = null,
    algoName = null,
    position = null,
    rank = null,
    score = null,
    reason = null, // ej: "autoplay", "unmute", "fullscreen", etc.
  }) {
    if (!itemId || !type || !userId)
      throw new Error("Parámetros faltantes: itemId, type o userId.");

    if (type !== "post")
      throw new Error("Solo los posts pueden registrar vistas.");

    const item = await PostModel.findById(itemId).lean();
    if (!item) throw new Error("Post no encontrado.");

    // 🧩 Detectar si el post tiene al menos un VIDEO
    const hasVideo =
      Array.isArray(item.media) &&
      item.media.some((m) => {
        const rawType = (m?.type || "").toString().toLowerCase();
        const mime = (
          m?.mime ||
          m?.mimetype ||
          ""
        )
          .toString()
          .toLowerCase();

        return rawType === "video" || mime.startsWith("video/");
      });

    // 🔁 Actualizar intereses según duración de vista
    //    SOLO si el post es de video (o tiene al menos un video)
    try {
      if (hasVideo) {
        let eventType = "view";
        if (durationMs > 15000) eventType = "long_view";

        await UserInterestService.registerPostInteraction({
          userId,
          post: item,
          type: eventType,
        });
      }
    } catch (err) {
      console.error(
        "⚠️ Error actualizando intereses en registerView:",
        err?.message || err
      );
    }

    // 🧮 Incrementar contador duro de vistas en el Post
    //     (solo cuenta si tiene video para mantener semántica de "video views")
    if (hasVideo) {
      try {
        await PostModel.updateOne(
          { _id: itemId },
          { $inc: { viewsCount: 1 } }
        );
      } catch (err) {
        console.error(
          "⚠️ Error incrementando viewsCount en registerView:",
          err?.message || err
        );
      }
    }

    // 📊 Log para A/B testing / analítica
    //    (incluye flag hasVideo + reason en el meta)
    try {
      await logContentView({
        userId,
        contentId: itemId,
        contentType: "post",
        durationMs,
        fullyViewed,
        algoVariant,
        algoName,
        position,
        rank,
        meta: {
          score,
          reason,
          hasVideo: !!hasVideo,
        },
      });
    } catch (err) {
      console.error(
        "⚠️ Error registrando vista para A/B en registerView:",
        err?.message || err
      );
    }

    return {
      success: true,
      message: "👁️ Vista registrada",
    };
  }

  /* =====================================================
     ❤️ Like / Dislike SOLO para Posts
     ===================================================== */
  static async toggleLike({
    itemId,
    type,
    userId,
    value,
    algoVariant = null,
    algoName = null,
    position = null,
    rank = null,
    score = null,
  }) {
    if (!itemId || !type || !userId)
      throw new Error("Parámetros faltantes: itemId, type o userId.");

    if (type !== "post")
      throw new Error("Solo los posts pueden recibir likes.");

    const item = await PostModel.findById(itemId);
    if (!item) throw new Error("Post no encontrado.");

    // Asegurar arrays existentes
    item.likes = Array.isArray(item.likes) ? item.likes : [];
    item.dislikes = Array.isArray(item.dislikes)
      ? item.dislikes
      : [];

    // Eliminar like/dislike previo del usuario
    item.likes = item.likes.filter(
      (id) => id.toString() !== userId.toString()
    );
    item.dislikes = item.dislikes.filter(
      (id) => id.toString() !== userId.toString()
    );

    // Aplicar interacción
    if (value === 1) item.likes.push(String(userId));
    else if (value === -1) item.dislikes.push(String(userId));

    await item.save();

    // 🔁 Actualizar intereses del usuario según like/dislike (no rompe nada si falla)
    try {
      let interestType = null;
      if (value === 1) interestType = "like";
      else if (value === -1) interestType = "dislike";

      if (interestType) {
        await UserInterestService.registerPostInteraction({
          userId,
          post: item.toObject ? item.toObject() : item,
          type: interestType,
        });
      }
    } catch (err) {
      console.error(
        "⚠️ Error actualizando intereses en toggleLike:",
        err?.message || err
      );
    }

    // 📊 Log detallado para A/B (likes/dislikes)
    try {
      const actionLabel =
        value === 1 ? "like" : value === -1 ? "dislike" : "clear";

      await logContentInteraction({
        userId,
        contentId: itemId,
        contentType: "post",
        action: actionLabel,
        algoVariant,
        algoName,
        position,
        rank,
        meta: { score },
      });
    } catch (err) {
      console.error(
        "⚠️ Error registrando interacción para A/B en toggleLike:",
        err?.message || err
      );
    }

    return {
      success: true,
      message:
        value === 1
          ? "👍 Like aplicado"
          : value === -1
          ? "👎 Dislike aplicado"
          : "Interacción eliminada",
      likes: item.likes.length,
      dislikes: item.dislikes.length,
    };
  }

  /* =====================================================
     💬 Comentarios SOLO para Posts (colección propia)
     ===================================================== */
  static async addComment({
    itemId,
    type,
    userId,
    text,
    algoVariant = null,
    algoName = null,
    position = null,
    rank = null,
    score = null,
  }) {
    if (!itemId || !type || !userId || !text)
      throw new Error("Faltan parámetros requeridos para comentar.");

    if (type !== "post")
      throw new Error("Solo los posts pueden tener comentarios.");

    const postDoc = await PostModel.findById(itemId).lean();
    if (!postDoc) throw new Error("Post no encontrado.");

    const user = await User.findById(userId).select("username avatar");

    const cleanedText = String(text || "").trim();
    if (!cleanedText)
      throw new Error("El comentario no puede estar vacío.");

    // 🧩 Snapshot mínimo de usuario (útil para denormalizar en comentarios)
    const userSnapshot = user
      ? { _id: user._id, username: user.username, avatar: user.avatar }
      : { _id: userId, username: "Usuario", avatar: null };

    // 🗄 Crear comentario en la colección de comentarios
    // ⚠️ Ajusta el nombre del método según tu CommentService real
    const createdComment =
      await CommentService.addCommentToPost({
        postId: itemId,
        userId,
        text: cleanedText,
        userSnapshot,
      });

    // 📈 Incrementar contador de comentarios en el post
    try {
      await PostModel.updateOne(
        { _id: itemId },
        { $inc: { commentsCount: 1 } }
      );
    } catch (err) {
      console.error(
        "⚠️ Error incrementando commentsCount en addComment:",
        err?.message || err
      );
    }

    // 🔁 Actualizar intereses del usuario por comentar ese post
    try {
      await UserInterestService.registerPostInteraction({
        userId,
        post: postDoc,
        type: "comment",
      });
    } catch (err) {
      console.error(
        "⚠️ Error actualizando intereses en addComment:",
        err?.message || err
      );
    }

    // 📊 Log detallado para A/B (comentarios)
    try {
      await logContentInteraction({
        userId,
        contentId: itemId,
        contentType: "post",
        action: "comment",
        algoVariant,
        algoName,
        position,
        rank,
        meta: { score },
      });
    } catch (err) {
      console.error(
        "⚠️ Error registrando interacción para A/B en addComment:",
        err?.message || err
      );
    }

    return {
      success: true,
      message: "💬 Comentario agregado exitosamente",
      comment: createdComment,
      // Para no romper front que espere un array "comments"
      comments: [createdComment],
    };
  }
}

export default InteractionService;
