// ======================================================
// 💬 CommentService v14.1 PRO (2025)
// ------------------------------------------------------
// - Respuestas anidadas (parentId)
// - Contadores: repliesCount y commentsCount (solo raíz)
// - deleteByTarget() para limpiar comentarios de un post
// - Solo el usuario del token puede ser autor
// - Fallback si el usuario no existe en User
// - embeddedPost opcional con resumen del Post
// - Soporte de media opcional en comentarios
// - addCommentToPost para InteractionService
// - ✅ Import defensivo de CommentModel (named o default)
// ======================================================

import * as CommentModelModule from "../infrastructure/models/CommentModel.js";
import { User } from "../domain/User.js";
import { PostModel } from "../infrastructure/models/PostModel.js";

// Import defensivo: soporta default, { Comment }, { CommentModel }, etc.
const Comment =
  CommentModelModule.default ||
  CommentModelModule.Comment ||
  CommentModelModule.CommentModel ||
  CommentModelModule.comment ||
  null;

if (!Comment) {
  throw new Error(
    "CommentService: no se pudo resolver el modelo Comment desde CommentModel.js"
  );
}

export class CommentService {
  /* ======================================================
     🔎 Helper: mini resumen de Post para embeddedPost
  ====================================================== */
  static async _buildEmbeddedPost(postId) {
    if (!postId) return null;

    try {
      const post = await PostModel.findById(postId)
        .select("content authorUsername media")
        .lean();

      if (!post) return null;

      return {
        _id: post._id,
        authorUsername:
          post.authorUsername ||
          (post.author && post.author.username) ||
          "Usuario",
        content: post.content || "",
        media: Array.isArray(post.media) ? post.media : [],
      };
    } catch (err) {
      console.warn(
        "Advertencia: no se pudo cargar Post para embeddedPost:",
        err?.message
      );
      return null;
    }
  }

  /* ======================================================
     🔎 Helper: snapshot de usuario
     - Prioriza userSnapshot (ya resuelto desde fuera)
     - Luego busca en BD
     - Luego usa userData (del token)
  ====================================================== */
  static async _resolveUserSnapshot({
    userId,
    userSnapshot = null, // { _id, username, avatar }
    userData = null, // { username, avatar } desde req.user
  }) {
    if (userSnapshot && userSnapshot._id) {
      return {
        _id: userSnapshot._id,
        username: userSnapshot.username || "Usuario",
        avatar:
          userSnapshot.avatar !== undefined
            ? userSnapshot.avatar
            : null,
      };
    }

    let user = null;
    try {
      user = await User.findById(userId).select("username avatar");
    } catch (e) {
      console.error("Error buscando usuario en BD:", e);
    }

    if (!user) {
      console.warn(
        `Usuario ${userId} no encontrado en colección User, usando datos del token como fallback`
      );
      return {
        _id: userId,
        username: userData?.username || "Usuario",
        avatar:
          userData && userData.avatar !== undefined
            ? userData.avatar
            : null,
      };
    }

    return {
      _id: user._id,
      username: user.username || userData?.username || "Usuario",
      avatar:
        user.avatar !== undefined
          ? user.avatar
          : userData?.avatar ?? null,
    };
  }

  /* ======================================================
     🔎 Helper: creación centralizada de comentarios
  ====================================================== */
  static async _createComment({
    postId,
    userId,
    text,
    parentId = null,
    media = null,
    userSnapshot = null,
    userData = null,
    updatePostCommentsCount = true, // InteractionService lo pone en false
  }) {
    const content = (text || "").trim();
    const hasMedia =
      Array.isArray(media) && media.length > 0;

    if (!content && !hasMedia) {
      throw new Error("El comentario no puede estar vacío");
    }

    if (!userId) {
      throw new Error("Usuario no autenticado");
    }

    if (!postId) {
      throw new Error("ID de publicación (postId) requerido");
    }

    // Verificar existencia del post
    const postExists = await PostModel.exists({ _id: postId });
    if (!postExists) {
      throw new Error("Post no encontrado");
    }

    // Validar parentId si viene (que pertenezca al mismo post)
    let parentComment = null;
    if (parentId) {
      parentComment = await Comment.findById(parentId);
      if (
        !parentComment ||
        String(parentComment.targetId) !== String(postId)
      ) {
        throw new Error(
          "El comentario padre no pertenece a este post o no existe"
        );
      }
    }

    // Resolver snapshot de usuario
    const snapshot = await CommentService._resolveUserSnapshot({
      userId,
      userSnapshot,
      userData,
    });

    const createdBy = snapshot._id;
    const mediaArray = Array.isArray(media) ? media : [];

    const comment = await Comment.create({
      content, // puede ser cadena vacía si solo hay media (lo controla el pre-validate)
      targetId: postId,
      targetType: "post",
      createdBy,
      parentId,
      media: mediaArray,
    });

    // Si es respuesta, incrementar repliesCount del padre
    if (parentId && parentComment) {
      Comment.findByIdAndUpdate(parentId, {
        $inc: { repliesCount: 1 },
      }).catch(() => {});
    }

    // Actualizar contador de comentarios en el Post
    // 🔹 Solo cuenta comentarios raíz (parentId == null), como antes
    if (updatePostCommentsCount && !parentId) {
      PostModel.updateOne(
        { _id: postId },
        { $inc: { commentsCount: 1 } }
      ).catch(() => {});
    }

    const json = comment.toJSON();
    return {
      ...json,
      createdBy: {
        _id: String(snapshot._id),
        username: snapshot.username,
        avatar: snapshot.avatar,
      },
    };
  }

  /* ======================================================
     🆕 API principal para InteractionService
     addCommentToPost({ postId, userId, text, parentId?, userSnapshot?, media? })
     - NO toca commentsCount (lo hace InteractionService)
  ====================================================== */
  static async addCommentToPost({
    postId,
    userId,
    text,
    parentId = null,
    userSnapshot = null,
    media = null,
  }) {
    return CommentService._createComment({
      postId,
      userId,
      text,
      parentId,
      media,
      userSnapshot,
      userData: null,
      updatePostCommentsCount: false, // InteractionService ya hace el $inc
    });
  }

  /* ======================================================
     ➕ Crear comentario o respuesta (legacy / rutas antiguas)
     - Soporta media opcional
  ====================================================== */
  static async addComment({
    userId,
    targetId,
    content,
    parentId = null,
    userData = null, // { username, avatar } desde req.user
    media = null,
  }) {
    return CommentService._createComment({
      postId: targetId,
      userId,
      text: content,
      parentId,
      media,
      userSnapshot: null,
      userData,
      updatePostCommentsCount: true,
    });
  }

  /* ======================================================
     📥 Obtener comentarios de un post (anidados)
  ====================================================== */
  static async getComments(postId) {
    const embeddedPost =
      await CommentService._buildEmbeddedPost(postId);

    const comments = await Comment.find({
      targetId: postId,
      targetType: "post",
    })
      .populate("createdBy", "username avatar")
      .sort({ createdAt: -1 })
      .lean();

    const list = comments.map((c) => ({
      ...c,
      id: c._id.toString(),
      parentId: c.parentId ? c.parentId.toString() : null,
      likeCount: Array.isArray(c.likes) ? c.likes.length : 0,
      embeddedPost,
    }));

    // Construir árbol de comentarios (padres → hijos)
    const map = new Map();
    const roots = [];

    list.forEach((c) => {
      map.set(c.id, { ...c, replies: [] });
    });

    list.forEach((c) => {
      if (c.parentId && map.has(String(c.parentId))) {
        const parent = map.get(String(c.parentId));
        parent.replies.push(map.get(c.id));
      } else {
        roots.push(map.get(c.id));
      }
    });

    return roots;
  }

  /* ======================================================
     📌 Obtener comentario por ID
  ====================================================== */
  static async getCommentById(id) {
    const c = await Comment.findById(id)
      .populate("createdBy", "username avatar")
      .lean();
    if (!c) return null;

    const embeddedPost =
      await CommentService._buildEmbeddedPost(c.targetId);

    return {
      ...c,
      id: c._id.toString(),
      parentId: c.parentId ? c.parentId.toString() : null,
      likeCount: Array.isArray(c.likes) ? c.likes.length : 0,
      embeddedPost,
    };
  }

  /* ======================================================
     ✏ Editar comentario
  ====================================================== */
  static async updateComment(id, user, content) {
    const comment = await Comment.findById(id).populate(
      "createdBy",
      "username avatar"
    );

    if (!comment)
      throw new Error("Comentario no encontrado");

    if (
      comment.createdBy._id.toString() !== user.id &&
      user.role !== "admin"
    ) {
      throw new Error(
        "No tienes permiso para editar este comentario"
      );
    }

    const text = (content || "").trim();
    if (!text)
      throw new Error("El comentario no puede estar vacío");

    comment.content = text;
    comment.editedAt = new Date();
    await comment.save();

    return { ...comment.toJSON(), id: comment._id.toString() };
  }

  /* ======================================================
     🗑 Eliminar comentario individual (y actualizar contadores)
  ====================================================== */
  static async deleteComment(id, user) {
    const comment = await Comment.findById(id);
    if (!comment)
      throw new Error("Comentario no encontrado");

    if (
      comment.createdBy.toString() !== user.id &&
      user.role !== "admin"
    ) {
      throw new Error(
        "No tienes permiso para eliminar este comentario"
      );
    }

    const { targetId, parentId } = comment;

    await Comment.findByIdAndDelete(id);

    if (parentId) {
      // Reducimos repliesCount del comentario padre
      Comment.findByIdAndUpdate(parentId, {
        $inc: { repliesCount: -1 },
      }).catch(() => {});
    } else {
      // Comentario raíz: recalcular comentarios raíz del post
      const totalRoot = await Comment.countDocuments({
        targetId,
        targetType: "post",
        parentId: null,
      });

      PostModel.findByIdAndUpdate(targetId, {
        $set: { commentsCount: totalRoot },
      }).catch(() => {});
    }

    return { message: "Comentario eliminado correctamente" };
  }

  /* ======================================================
     🗑️ ELIMINAR TODOS LOS COMENTARIOS DE UN POST
     (usado cuando se elimina una publicación)
  ====================================================== */
  static async deleteByTarget(targetId) {
    if (!targetId) return { deletedCount: 0 };

    const result = await Comment.deleteMany({
      targetId,
      targetType: "post",
    }).catch((err) => {
      console.error(
        "Error al eliminar comentarios del post:",
        err
      );
      return { deletedCount: 0 };
    });

    // Reiniciar contador del post
    PostModel.findByIdAndUpdate(targetId, {
      $set: { commentsCount: 0 },
    }).catch(() => {});

    const deletedCount =
      result && typeof result.deletedCount === "number"
        ? result.deletedCount
        : 0;

    console.log(
      `Comentarios eliminados para post ${targetId}: ${deletedCount}`
    );

    return { deletedCount };
  }

  /* ======================================================
     ❤️ Like / Unlike comentario
  ====================================================== */
  static async toggleLike(id, userId) {
    const comment = await Comment.findById(id);
    if (!comment)
      throw new Error("Comentario no encontrado");

    const userStr = userId.toString();
    const already = comment.likes.some(
      (u) => u.toString() === userStr
    );

    if (already) {
      comment.likes = comment.likes.filter(
        (u) => u.toString() !== userStr
      );
    } else {
      comment.likes.push(userId);
    }

    await comment.save();
    return CommentService.getCommentById(id);
  }

  /* ======================================================
     🕒 Obtener últimos comentarios de un usuario
     (para mostrar actividad en perfil)
  ====================================================== */
  static async getRecentByUser(userId, limit = 10) {
    const comments = await Comment.find({ createdBy: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("targetId", "content authorUsername")
      .lean();

    return comments.map((c) => ({
      id: c._id.toString(),
      content: c.content,
      targetPost: c.targetId?._id || null,
      targetAuthor: c.targetId?.authorUsername || null,
      createdAt: c.createdAt,
    }));
  }
}

export default CommentService;
