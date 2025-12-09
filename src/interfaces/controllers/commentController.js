// ======================================================
// 💬 CommentController v10.7 — Media + Avatares + Uploads
// ------------------------------------------------------
// - Acepta parentId en creación
// - Soporta JSON o multipart/form-data (hybridUpload)
// - Permite comentario solo con media (sin texto)
// - Guarda media en colección Upload usando UploadService
// - Devuelve avatarUrl y media[] para el frontend móvil
// ======================================================

import fs from "fs";          // (por compatibilidad, aunque casi no lo usamos ya)
import path from "path";      // idem
import chalk from "chalk";

import { CommentService } from "../../application/CommentService.js";
import { UploadService } from "../../application/UploadService.js";
import { UPLOADS_BASE_DIR } from "../../infrastructure/uploadMiddleware.js";

/* ======================================================
   Normalizador universal → formato amigable para móvil
====================================================== */
function toMobileComment(c, currentUserId) {
  if (!c) return null;

  const likesArr = Array.isArray(c.likes) ? c.likes : [];
  const likeCount = likesArr.length;

  const createdBy = c.createdBy || c.author || c.user || null;

  const authorUsername =
    createdBy?.username ||
    c.authorUsername ||
    c.author ||
    "Usuario";

  const authorId =
    createdBy?._id ||
    createdBy?.id ||
    c.createdBy ||
    null;

  const avatarUrl =
    createdBy?.safeAvatar ||
    createdBy?.avatarUrl ||
    createdBy?.profilePhoto ||
    createdBy?.photoUrl ||
    createdBy?.picture ||
    createdBy?.image ||
    c.avatarUrl ||
    null;

  const mediaArray = Array.isArray(c.media)
    ? c.media
    : c.media
    ? [c.media]
    : [];

  return {
    id: c.id || c._id?.toString(),
    author: authorUsername,
    authorId: authorId,
    avatarUrl: avatarUrl || null,

    text: c.content,
    likes: likeCount,
    likedByUser: likesArr.some(
      (u) => String(u) === String(currentUserId)
    ),

    parentId: c.parentId || null,
    repliesCount:
      typeof c.repliesCount === "number"
        ? c.repliesCount
        : Array.isArray(c.replies)
        ? c.replies.length
        : 0,

    replies: Array.isArray(c.replies)
      ? c.replies.map((r) => toMobileComment(r, currentUserId))
      : [],

    media: mediaArray,
    embeddedPost: c.embeddedPost || null,
    createdAt: c.createdAt || new Date(),
  };
}

/* ======================================================
   📥 GET /api/comments/:targetId
====================================================== */
export const getComments = async (req, res) => {
  try {
    const { targetId } = req.params;
    const userId = req.user?.id || null;

    const comments = await CommentService.getComments(targetId);

    return res.json({
      success: true,
      data: comments.map((c) => toMobileComment(c, userId)),
    });
  } catch (err) {
    console.error(chalk.red("Error GET comments:"), err);
    return res.status(400).json({
      success: false,
      error: "Error al obtener comentarios",
    });
  }
};

/* ======================================================
   ➕ POST /api/comments/add
   - Soporta JSON puro o multipart/form-data (hybridUpload)
   - Acepta:
     - solo texto
     - texto + media
     - solo media
====================================================== */
export const addComment = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const userId = req.user.id;
    const { targetId, content, text, parentId } = req.body;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        error: "targetId es obligatorio",
      });
    }

    // ==========================
    //  Detectar archivo (media)
    // ==========================
    const rawFile =
      req.file ||
      (Array.isArray(req.files) && req.files[0]) ||
      (req.files?.media && req.files.media[0]) ||
      null;

    const finalText = (text ?? content ?? "").trim();

    // Permitir:
    //  - solo texto
    //  - texto + media
    //  - solo media
    if (!finalText && !rawFile) {
      return res.status(400).json({
        success: false,
        error: "El comentario no puede estar vacío",
      });
    }

    // ======================================================
    // 🖼️ MEDIA OPCIONAL → se guarda también en Uploads
    // ======================================================
    let mediaArray = [];

    if (rawFile) {
      try {
        // Normalizamos los campos que espera UploadService
        const fileForUpload = {
          originalname:
            rawFile.originalname ||
            rawFile.filename ||
            `comment-${Date.now()}`,
          mimetype: rawFile.mimetype || rawFile.mime,
          size: rawFile.size,
          buffer: rawFile.buffer,
          path: rawFile.path, // por si hybridUpload ya lo guardó en disco
        };

        // Usuario mínimo para UploadService
        const userForUpload = {
          _id: userId,
          username: (req.user.username || "user").toLowerCase(),
        };

        const savedUpload = await UploadService.saveFile(
          fileForUpload,
          userForUpload,
          UPLOADS_BASE_DIR
        );

        const mime =
          savedUpload?.mimetype ||
          savedUpload?.mime ||
          rawFile.mimetype ||
          rawFile.mime ||
          null;

        let type = "image";
        if (mime?.includes("gif")) type = "gif";
        else if (mime?.startsWith("video/")) type = "video";

        mediaArray.push({
          path: savedUpload.path,         // /uploads/username/filename.ext
          url: savedUpload.path,          // por compatibilidad con frontend
          type,
          mime,
          size: savedUpload.size || rawFile.size || null,
          uploadId:
            savedUpload.id ||
            savedUpload._id?.toString?.() ||
            null,
        });
      } catch (fileErr) {
        console.error(
          chalk.red("Error al guardar media de comentario en Uploads:"),
          fileErr
        );
        // No rompemos el comentario si falla la parte de Upload;
        // simplemente no adjuntamos media.
        mediaArray = [];
      }
    }

    const created = await CommentService.addComment({
      userId, // SIEMPRE del token
      targetId,
      content: finalText, // puede ser "" si hay media
      parentId: parentId || null,
      userData: {
        username: req.user.username,
        avatar: req.user.avatarUrl || req.user.avatar || null,
      },
      media: mediaArray, // siempre array (vacío o con 1 elemento)
    });

    return res.status(201).json({
      success: true,
      data: toMobileComment(created, userId),
    });
  } catch (err) {
    console.error("Error ADD comment:", err);
    return res.status(400).json({
      success: false,
      error: err?.message || "Error al crear comentario",
    });
  }
};

/* ======================================================
   ✏️ PUT /api/comments/:id
====================================================== */
export const updateComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, text } = req.body;
    const user = req.user;

    const updated = await CommentService.updateComment(
      id,
      user,
      (text ?? content ?? "").trim()
    );

    return res.json({
      success: true,
      data: toMobileComment(updated, user.id),
    });
  } catch (err) {
    console.error("Error UPDATE comment:", err);
    return res.status(400).json({
      success: false,
      error: err?.message || "Error al editar comentario",
    });
  }
};

/* ======================================================
   🗑️ DELETE /api/comments/:id
====================================================== */
export const deleteComment = async (req, res) => {
  try {
    const user = req.user;

    const result = await CommentService.deleteComment(req.params.id, user);

    return res.json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    console.error("Error DELETE comment:", err);
    return res.status(400).json({
      success: false,
      error: err?.message || "Error al eliminar comentario",
    });
  }
};

/* ======================================================
   ❤️ POST /api/comments/like/:id
====================================================== */
export const toggleCommentLike = async (req, res) => {
  try {
    const userId = req.user.id;
    const updated = await CommentService.toggleLike(req.params.id, userId);

    return res.json({
      success: true,
      data: toMobileComment(updated, userId),
    });
  } catch (err) {
    console.error("Error LIKE comment:", err);
    return res.status(400).json({
      success: false,
      error: err?.message || "Error al procesar like",
    });
  }
};
