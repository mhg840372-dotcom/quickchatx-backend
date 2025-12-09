// ======================================================
// 📁 postRoutes.js — v22.1 PRO (2025)
// ------------------------------------------------------
// ✔ postController v27.x estable + VIDEO JSON
// ✔ hybridUpload + uploadMiddleware v17 (anti-corruption)
// ✔ Alias POST / (además de /create)
// ✔ Validación robusta ObjectId con mongoose
// ✔ Manejo de errores unificado
// ✔ 🆕 GET /posts/:id/video-manifest (manifest ligero)
// ✔ 🆕 POST /posts/:id/view (viewsCount++)
// ✔ 🆕 POST /posts/repost  +  POST /posts/:id/repost (repost)
// ======================================================

import express from "express";
import mongoose from "mongoose";
import * as postController from "../controllers/post.js";
import { authMiddleware } from "../middlewares/AuthMiddleware.js";
import { hybridUpload } from "../../infrastructure/hybridUpload.js";

const router = express.Router();

// ======================================================
// 🧪 Validación estricta de postController
// ======================================================
const REQUIRED = [
  "createPost",
  "getFeed",
  "getNewer",
  "getOlder",
  "likePost",
  "addComment",
  "getPostById",
  "getPostsByUser",
  "deletePost",
  "restorePost",
  "getPostVideoManifest", // 🆕 obligatorio
  "registerView", // 🆕 registrar views
  "repostPost", // 🆕 repost
];

for (const fn of REQUIRED) {
  if (typeof postController[fn] !== "function") {
    console.error(`❌ ERROR FATAL: postController.${fn} NO ES UNA FUNCIÓN`);
  }
}

// ======================================================
// 🧹 Helpers
// ======================================================
const wrap = (label, handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    console.error(`❌ ${label}:`, err);
    next(err);
  }
};

const isValidObjectId = (val) => mongoose.isValidObjectId(String(val).trim());

const validateParamId = (param, errorMsg) => (req, res, next) => {
  const id = String(req.params?.[param] || "").trim();
  if (!isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      error: errorMsg,
    });
  }
  next();
};

// ======================================================
// 📝 Crear publicación — con hybridUpload
// ======================================================
const createPostHandler = wrap(
  "Error en /posts/create",
  postController.createPost
);

router.post(
  "/create",
  authMiddleware,
  hybridUpload,
  createPostHandler
);

// Alias moderno: POST /posts
router.post("/", authMiddleware, hybridUpload, createPostHandler);

// ======================================================
// 📰 FEED PRINCIPAL
// ======================================================
router.get(
  "/feed",
  authMiddleware,
  wrap("Error en /posts/feed", postController.getFeed)
);

// ======================================================
// 🔼 Ver posts nuevos (refresh infinito)
// ------------------------------------------------------
// GET /posts/newer?since=2024-01-20T10:00:00.000Z
// ======================================================
router.get(
  "/newer",
  authMiddleware,
  wrap("Error en /posts/newer", postController.getNewer)
);

// ======================================================
// 🔽 Ver posts antiguos (scroll infinito)
// ------------------------------------------------------
// GET /posts/older?before=2024-01-20T10:00:00.000Z
// ======================================================
router.get(
  "/older",
  authMiddleware,
  wrap("Error en /posts/older", postController.getOlder)
);

// ======================================================
// ❤️ LIKE / UNLIKE
// ======================================================
router.post(
  "/like/:id",
  authMiddleware,
  validateParamId("id", "ID de publicación inválido."),
  wrap("Error en /posts/like/:id", async (req, res, next) => {
    console.log(
      `❤️ [LIKE] Post ${req.params.id} → user ${req.user?._id ?? "N/A"}`
    );
    await postController.likePost(req, res, next);
  })
);

// ======================================================
// 🔁 REPOST PUBLICACIÓN
// ------------------------------------------------------
// 1) POST /posts/repost       → body: { postId, note?, url? }
// 2) POST /posts/:id/repost   → param :id + body opcional
// Ambas terminan en postController.repostPost
// ======================================================
router.post(
  "/repost",
  authMiddleware,
  wrap("Error en /posts/repost", postController.repostPost)
);

router.post(
  "/:id/repost",
  authMiddleware,
  validateParamId("id", "ID de publicación inválido."),
  wrap("Error en /posts/:id/repost", postController.repostPost)
);

// ======================================================
// 👁 REGISTER VIEW (viewsCount++)
// ------------------------------------------------------
// POST /posts/:id/view
// ======================================================
router.post(
  "/:id/view",
  authMiddleware,
  validateParamId("id", "ID de publicación inválido."),
  wrap("Error en /posts/:id/view", postController.registerView)
);

// ======================================================
// 💬 COMENTAR PUBLICACIÓN
// ======================================================
router.post(
  "/comment/:id",
  authMiddleware,
  validateParamId("id", "ID de publicación inválido."),
  wrap("Error en /posts/comment/:id", postController.addComment)
);

// ======================================================
// 👤 PERFIL DEL USUARIO
// ------------------------------------------------------
// IMPORTANTE: /user/* va ANTES de /:id
// ======================================================

// 👉 /user/me
router.get("/user/me", authMiddleware, async (req, res, next) => {
  try {
    const uid = req.user?._id || req.user?.id;
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: "Sesión expirada",
      });
    }

    req.params.id = String(uid);
    console.log("👤 [PROFILE] /user/me →", uid);

    await postController.getPostsByUser(req, res, next);
  } catch (err) {
    console.error("❌ Error en /posts/user/me:", err);
    next(err);
  }
});

// ❌ Bloquear /user/edit → evita CastError
router.get("/user/edit", (req, res) => {
  res.status(400).json({
    success: false,
    error: "Ruta /user/edit no está disponible.",
  });
});

// 👉 /user/:id — perfil público
router.get("/user/:id", authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id.trim();

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "ID de usuario inválido.",
      });
    }

    await postController.getPostsByUser(req, res, next);
  } catch (err) {
    console.error("❌ Error en /posts/user/:id:", err);
    next(err);
  }
});

// ======================================================
// 🎬 MANIFEST DE VIDEO (ligero para reproductor)
// ------------------------------------------------------
// GET /posts/:id/video-manifest
// ======================================================
router.get(
  "/:id/video-manifest",
  authMiddleware,
  validateParamId("id", "ID de publicación inválido."),
  wrap(
    "Error en /posts/:id/video-manifest",
    postController.getPostVideoManifest
  )
);

// ======================================================
// 🔥 POST INDIVIDUAL
// ======================================================
router.get("/:id", authMiddleware, async (req, res, next) => {
  try {
    const id = req.params.id.trim();

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: "ID de publicación inválido.",
      });
    }

    await postController.getPostById(req, res, next);
  } catch (err) {
    console.error("❌ Error en /posts/:id:", err);
    next(err);
  }
});

// ======================================================
// 🗑 ELIMINAR PUBLICACIÓN (Soft delete)
// ======================================================
router.delete("/:id", authMiddleware, postController.deletePost);

// ======================================================
// ♻ RESTAURAR PUBLICACIÓN (<24h)
// ======================================================
router.patch(
  "/restore/:id",
  authMiddleware,
  validateParamId("id", "ID de publicación inválido."),
  postController.restorePost
);

// ======================================================
// EXPORT
// ======================================================
export default router;
