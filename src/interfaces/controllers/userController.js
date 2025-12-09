// ======================================================
// 📁 src/interfaces/controllers/userController.js — FIX v13.10
// ------------------------------------------------------
// ✔ Crea carpeta al registrar usuario
// ✔ Devuelve rutas absolutas de imágenes (profilePhoto + avatarUrl)
// ✔ Incluye TODOS los handlers que exige UserRouter
// ✔ Añade follow / unfollow / follow-state
// ✔ Añade /users/me y /users/:id con posts + followers/following
// ✔ Login / Register devuelven user con postsCount / followersCount / followingCount
// ✔ followers / following SIEMPRE son arrays en serializeUser
// ✔ buildProfilePayload lee posts por authorId / userId / createdBy / author
// ✔ followers / following vienen POPULADOS (username, nombre, avatar)
// ✔ Añadido searchUsers + validación ObjectId en getUserProfileById
// ✔ ✅ checkUsername / checkEmail compatibles con api.ts (body/query/params)
// ======================================================

import chalk from "chalk";
import jwt from "jsonwebtoken";
import config from "../../config/config.js";
import { User } from "../../domain/User.js";
import { UserActivity } from "../../domain/UserActivity.js";
import express from "express";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { logoutUser } from "../middlewares/AuthMiddleware.js";
// ⬇️ FIX: UserService se importa como NAMED export
import { UserService } from "../../application/UserService.js";
import { PostModel } from "../../infrastructure/models/PostModel.js";

const userService = new UserService();

// Redis
let redis = null;
try {
  const { initRedis, getRedisClient } = await import(
    "../../infrastructure/RedisProvider.js"
  );
  redis = await initRedis();
  global.getRedisClient = getRedisClient;
} catch {
  console.warn("⚠️ Redis no disponible. Modo fallback.");
}

const router = express.Router();

// ======================================================
// JWT
// ======================================================
function signJwt(payload) {
  const secret = config.jwt?.secret || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET no definido");
  return jwt.sign(payload, secret, { expiresIn: "365d" });
}

// BASE URL para imágenes
const BASE_URL = "https://api.quickchatx.com";

const resolveImage = (url) => {
  if (!url) return null;
  if (typeof url !== "string") return null;
  if (url.startsWith("http")) return url;
  return `${BASE_URL}${url}`;
};

// Escapar texto para usarlo en RegExp
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 🆕 Helper para normalizar username (igual estilo que en el frontend)
const normalizeUsername = (value = "") =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^a-z0-9._-]/g, ""); // solo caracteres permitidos

// ======================================================
// 👤 Normalizador de usuario público
// ======================================================
function serializeUser(userDoc) {
  const obj = userDoc.toObject ? userDoc.toObject() : userDoc;

  const followers = Array.isArray(obj.followers) ? obj.followers : [];
  const following = Array.isArray(obj.following) ? obj.following : [];

  return {
    ...obj,
    followers,
    following,
    profilePhoto: resolveImage(obj.profilePhoto),
    backgroundPhoto: resolveImage(obj.backgroundPhoto),
    avatarUrl: resolveImage(obj.avatarUrl || obj.profilePhoto),
    backgroundUrl: resolveImage(obj.backgroundUrl || obj.backgroundPhoto),
  };
}

// ======================================================
// 🧠 Helper: construir perfil completo con stats + posts
//    - Usa authorId / userId / createdBy / author (ObjectId o string)
//    - POPULA followers / following con datos básicos
// ======================================================
async function buildProfilePayload(
  userDoc,
  { includePosts = true, limit = 50 } = {}
) {
  if (!userDoc) return null;

  // 🔄 Intentar volver a cargar el usuario con followers/following populados
  let populatedUser = userDoc;
  try {
    const reloaded = await User.findById(userDoc._id)
      .populate(
        "followers",
        "username firstName lastName avatarUrl profilePhoto backgroundPhoto"
      )
      .populate(
        "following",
        "username firstName lastName avatarUrl profilePhoto backgroundPhoto"
      )
      .exec();

    if (reloaded) {
      populatedUser = reloaded;
    }
  } catch (e) {
    console.warn("⚠️ No se pudo popular followers/following:", e.message);
    populatedUser = userDoc;
  }

  // 👤 ID del usuario en ambos formatos: ObjectId y string
  const userIdObj = populatedUser._id;
  const userIdStr = userIdObj.toString();

  // 🔍 Soportar posts creados en distintas épocas/campos:
  const postQuery = {
    $or: [
      { authorId: userIdObj },
      { authorId: userIdStr },
      { userId: userIdObj },
      { userId: userIdStr },
      { createdBy: userIdObj },
      { createdBy: userIdStr },
      { author: userIdObj },
      { author: userIdStr },
    ],
  };

  const [postsCount, postsDocsRaw] = await Promise.all([
    PostModel.countDocuments(postQuery),
    includePosts
      ? PostModel.find(postQuery)
          .sort({ createdAt: -1 })
          .limit(limit)
          .exec()
      : Promise.resolve([]),
  ]);

  const postsDocs = Array.isArray(postsDocsRaw) ? postsDocsRaw : [];

  // 🧹 Evitar duplicados
  const unique = new Map();
  for (const p of postsDocs) {
    const id = p._id?.toString?.() || Math.random().toString(36);
    if (!unique.has(id)) {
      unique.set(id, p.toPublicJSON ? p.toPublicJSON() : p);
    }
  }

  const posts = Array.from(unique.values());

  const followersCount = Array.isArray(populatedUser.followers)
    ? populatedUser.followers.length
    : 0;

  const followingCount = Array.isArray(populatedUser.following)
    ? populatedUser.following.length
    : 0;

  const user = {
    ...serializeUser(populatedUser),
    posts,
    postsCount,
    followersCount,
    followingCount,
  };

  return {
    success: true,
    user,
    posts,
    data: { posts },
  };
}

// ======================================================
// 📜 GET TERMS
// ======================================================
export async function getTerms(req, res) {
  return res.status(200).json({
    success: true,
    terms: "Términos y condiciones de QuickChatX",
  });
}

// ======================================================
// 🟢 ACCEPT TERMS
// ======================================================
export async function acceptTerms(req, res) {
  try {
    const currentUserId = req.user?.id || req.user?._id;
    let user = null;

    if (currentUserId) {
      user = await User.findById(currentUserId);
    } else {
      const { email } = req.body || {};
      if (!email) {
        return res.status(400).json({
          success: false,
          error: "El email es requerido si no estás autenticado.",
        });
      }
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "Usuario no encontrado." });
    }

    user.acceptedTerms = true;
    user.termsAcceptedAt = new Date();
    await user.save();

    return res.json({
      success: true,
      message: "Términos aceptados correctamente",
    });
  } catch (err) {
    console.error("❌ Error en acceptTerms:", err);
    return res.status(500).json({ success: false, error: "Error interno" });
  }
}

// ======================================================
// 🟢 REGISTER — CREA CARPETA + devuelve perfil con stats
// ======================================================
export async function register(req, res) {
  try {
    const { firstName, lastName, email, username, password, acceptedTerms } =
      req.body || {};

    if (!firstName || !lastName || !email || !username || !password)
      return res
        .status(400)
        .json({ success: false, error: "Faltan campos obligatorios" });

    if (!acceptedTerms)
      return res
        .status(403)
        .json({ success: false, error: "Debes aceptar Términos." });

    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername || normalizedUsername.length < 3) {
      return res.status(400).json({
        success: false,
        error:
          "Nombre de usuario inválido. Usa solo letras, números, puntos, guiones y mínimo 3 caracteres.",
      });
    }

    const existing = await User.exists({ username: normalizedUsername });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: "Este nombre de usuario ya está en uso.",
      });
    }

    const user = await User.register({
      firstName,
      lastName,
      email: email.toLowerCase(),
      username: normalizedUsername,
      password,
      acceptedTerms: true,
      termsAcceptedAt: new Date(),
    });

    // Crear carpeta del usuario
    const uploadsRoot = path.resolve("./uploads");
    const userDir = path.join(uploadsRoot, normalizedUsername);

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
      console.log("📁 Carpeta creada:", userDir);
    }

    const token = signJwt({
      id: user._id,
      username: user.username,
      email: user.email,
    });

    const payload = await buildProfilePayload(user, {
      includePosts: false,
    });

    return res.status(201).json({
      ...payload,
      token,
    });
  } catch (err) {
    console.error("❌ Error en register:", err);
    return res.status(400).json({ success: false, error: err.message });
  }
}

// ======================================================
// 🟢 LOGIN — devuelve perfil con stats (sin posts)
// ======================================================
export async function login(req, res) {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password)
      return res
        .status(400)
        .json({ success: false, error: "Faltan credenciales." });

    const user = await User.login(identifier, password);

    const token = signJwt({
      id: user._id,
      username: user.username,
      email: user.email,
    });

    const payload = await buildProfilePayload(user, {
      includePosts: false,
    });

    return res.json({
      ...payload,
      token,
    });
  } catch (err) {
    console.error("❌ Error en login:", err);
    return res.status(401).json({ success: false, error: err.message });
  }
}

// ======================================================
// 🚪 LOGOUT
// ======================================================
export async function logout(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, error: "No autenticado" });

    await logoutUser(userId);

    return res.json({ success: true, message: "Logout correcto" });
  } catch (err) {
    console.error("❌ Error en logout:", err);
    return res.status(500).json({ success: false, error: "Error interno" });
  }
}

// ======================================================
// 🔍 CHECK USERNAME (body / query / params) — COMPAT API
// ======================================================
export async function checkUsername(req, res) {
  try {
    const raw =
      (req.body?.username ||
        req.query?.username ||
        req.params?.username ||
        "") + "";

    const clean = normalizeUsername(raw);

    if (!clean) {
      return res.status(400).json({
        success: false,
        error: "Username requerido",
      });
    }

    const exists = await User.exists({ username: clean });

    // sugerencias simples si está ocupado
    const suggestions = [];
    if (exists) {
      suggestions.push(
        `${clean}${Math.floor(Math.random() * 90 + 10)}`,
        `${clean}_${Math.floor(Math.random() * 900 + 100)}`
      );
    }

    return res.json({
      success: true,
      data: {
        available: !exists,
        suggestions,
      },
    });
  } catch (err) {
    console.error("❌ Error en checkUsername:", err);
    return res.status(500).json({
      success: false,
      error: "Error validando username",
    });
  }
}

// ======================================================
// 🔍 CHECK EMAIL (body / query / params) — COMPAT API
// ======================================================
export async function checkEmail(req, res) {
  try {
    const raw =
      (req.body?.email ||
        req.query?.email ||
        req.params?.email ||
        "") + "";

    const email = raw.trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email requerido",
      });
    }

    const exists = await User.exists({ email });

    return res.json({
      success: true,
      data: {
        available: !exists,
        // por compatibilidad con api.ts, si algún día quieres: exists: !!exists
      },
    });
  } catch (err) {
    console.error("❌ Error en checkEmail:", err);
    return res.status(500).json({
      success: false,
      error: "Error validando email",
    });
  }
}

// ======================================================
// 🔎 SEARCH USERS: /users/search
// ======================================================
export async function searchUsers(req, res) {
  try {
    const raw =
      (req.query.q ||
        req.query.query ||
        req.query.search ||
        "").toString();

    const term = raw.trim();

    if (!term) {
      return res.json({ success: true, users: [] });
    }

    const safe = escapeRegex(term);
    const regex = new RegExp(safe, "i");

    const users = await User.find({
      $or: [
        { username: regex },
        { firstName: regex },
        { lastName: regex },
        { email: regex },
      ],
    })
      .limit(50)
      .exec();

    const serialized = users.map((u) => serializeUser(u));

    return res.json({
      success: true,
      users: serialized,
    });
  } catch (err) {
    console.error("❌ Error en searchUsers:", err);
    return res.status(500).json({
      success: false,
      error: "Error al buscar usuarios",
    });
  }
}

// ======================================================
// 👤 PERFIL: /users/me
// ======================================================
export async function getMeProfile(req, res) {
  try {
    const currentUserId = req.user?.id || req.user?._id;
    if (!currentUserId) {
      return res
        .status(401)
        .json({ success: false, error: "No autenticado" });
    }

    const userDoc = await User.findById(currentUserId);
    if (!userDoc) {
      return res
        .status(404)
        .json({ success: false, error: "Usuario no encontrado" });
    }

    const payload = await buildProfilePayload(userDoc, {
      includePosts: true,
      limit: 50,
    });

    return res.json(payload);
  } catch (err) {
    console.error("❌ Error en getMeProfile:", err);
    return res.status(500).json({
      success: false,
      error: "Error al obtener tu perfil",
    });
  }
}

// ======================================================
// 👤 PERFIL PÚBLICO: /users/:id
// ======================================================
export async function getUserProfileById(req, res) {
  try {
    const targetUserId = req.params.id;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        error: "Id de usuario requerido",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        error: "Id de usuario inválido",
      });
    }

    const userDoc = await User.findById(targetUserId);
    if (!userDoc) {
      return res
        .status(404)
        .json({ success: false, error: "Usuario no encontrado" });
    }

    const payload = await buildProfilePayload(userDoc, {
      includePosts: true,
      limit: 50,
    });

    return res.json(payload);
  } catch (err) {
    console.error("❌ Error en getUserProfileById:", err);
    return res.status(500).json({
      success: false,
      error: "Error al obtener perfil de usuario",
    });
  }
}

// ======================================================
// 👥 FOLLOW / UNFOLLOW / STATE
// ======================================================
export async function followUser(req, res) {
  try {
    const currentUserId = req.user?.id || req.user?._id;
    const targetUserId = req.params.id;

    if (!currentUserId)
      return res
        .status(401)
        .json({ success: false, error: "No autenticado" });

    if (!targetUserId)
      return res
        .status(400)
        .json({ success: false, error: "Usuario destino requerido" });

    console.log("👥 [FOLLOW]", currentUserId, "→", targetUserId);

    const { me, target } = await userService.followUser(
      currentUserId,
      targetUserId
    );

    return res.json({
      success: true,
      following: true,
      followersCount: Array.isArray(target.followers)
        ? target.followers.length
        : 0,
      followingCount: Array.isArray(me.following)
        ? me.following.length
        : 0,
    });
  } catch (err) {
    console.error("❌ Error en followUser:", err);
    return res
      .status(400)
      .json({ success: false, error: err.message || "Error al seguir" });
  }
}

export async function unfollowUser(req, res) {
  try {
    const currentUserId = req.user?.id || req.user?._id;
    const targetUserId = req.params.id;

    if (!currentUserId)
      return res
        .status(401)
        .json({ success: false, error: "No autenticado" });

    if (!targetUserId)
      return res
        .status(400)
        .json({ success: false, error: "Usuario destino requerido" });

    console.log("👥 [UNFOLLOW]", currentUserId, "✖", targetUserId);

    const { me, target } = await userService.unfollowUser(
      currentUserId,
      targetUserId
    );

    return res.json({
      success: true,
      following: false,
      followersCount: Array.isArray(target.followers)
        ? target.followers.length
        : 0,
      followingCount: Array.isArray(me.following)
        ? me.following.length
        : 0,
    });
  } catch (err) {
    console.error("❌ Error en unfollowUser:", err);
    return res.status(400).json({
      success: false,
      error: err.message || "Error al dejar de seguir",
    });
  }
}

export async function getFollowState(req, res) {
  try {
    const currentUserId = req.user?.id || req.user?._id;
    const targetUserId = req.params.id;

    if (!currentUserId)
      return res
        .status(401)
        .json({ success: false, error: "No autenticado" });

    if (!targetUserId)
      return res
        .status(400)
        .json({ success: false, error: "Usuario destino requerido" });

    const isFollowing = await userService.isFollowing(
      currentUserId,
      targetUserId
    );
    const target = await User.findById(targetUserId).select(
      "followers following"
    );

    return res.json({
      success: true,
      following: isFollowing,
      followersCount: target?.followers?.length || 0,
      followingCount: target?.following?.length || 0,
    });
  } catch (err) {
    console.error("❌ Error en getFollowState:", err);
    return res.status(400).json({
      success: false,
      error: err.message || "Error al consultar follow",
    });
  }
}

// ======================================================
// EXPORT DEFAULT ROUTER (legacy, por compatibilidad)
// ======================================================
router.get("/terms", getTerms);
router.post("/accept-terms", acceptTerms);
router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/check-username/:username", checkUsername);
router.get("/check-email/:email", checkEmail);
router.get("/search", searchUsers);

export default router;
/* ===============================
   📥 Registro de usuario (FIX)
   =============================== */
