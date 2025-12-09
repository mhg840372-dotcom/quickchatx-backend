// ======================================================
// 💬 commentRoutes.js — QuickChatX v9.1 MEDIA READY (OK)
// ======================================================

import express from "express";
import {
  getComments,
  addComment,
  updateComment,
  deleteComment,
  toggleCommentLike,
} from "../controllers/commentController.js";
import {
  authMiddleware,
  authOptionalMiddleware,
} from "../middlewares/AuthMiddleware.js";
import { hybridUpload } from "../../infrastructure/hybridUpload.js";

const router = express.Router();

/* ======================================================
   ➕ Crear comentario (texto + media opcional)
   - Soporta JSON o multipart/form-data
   - Campo de archivo esperado: "media" (hybridUpload)
====================================================== */
router.post("/add", authMiddleware, hybridUpload, addComment);

/* ======================================================
   📥 Obtener comentarios (permite usuario opcional)
====================================================== */
router.get("/:targetId", authOptionalMiddleware, getComments);

/* ======================================================
   ✏️ Editar comentario
====================================================== */
router.put("/:id", authMiddleware, updateComment);

/* ======================================================
   🗑️ Eliminar comentario
====================================================== */
router.delete("/:id", authMiddleware, deleteComment);

/* ======================================================
   ❤️ Like / Unlike comentario
====================================================== */
router.post("/like/:id", authMiddleware, toggleCommentLike);

export default router;
