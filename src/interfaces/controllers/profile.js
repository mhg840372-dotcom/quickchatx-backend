// ======================================================
// 📄 controllers/profile.js — v6.2 FINAL (2025)
// ------------------------------------------------------
// ✔ Crea carpeta si no existe
// ✔ Mueve avatar y background correctamente
// ✔ Borra archivos antiguos
// ✔ Devuelve rutas ABSOLUTAS correctas
// ✔ Incluye postsCount + followersCount + followingCount
// ======================================================

import path from "path";
import fs from "fs";
import { User } from "../../domain/User.js";
import { PostModel } from "../../infrastructure/models/PostModel.js";

const uploadDir = path.resolve("./uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const BASE_URL = "https://api.quickchatx.com";
const resolveImage = (url) => {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${BASE_URL}${url}`;
};

export function profileController() {
  return {
    // ======================================================
    // ✏️ PUT /api/profile/update
    // ======================================================
    updateProfile: async (req, res) => {
      try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
          return res
            .status(401)
            .json({ success: false, error: "Usuario no autenticado" });
        }

        const user = await User.findById(userId);
        if (!user) {
          return res
            .status(404)
            .json({ success: false, error: "Usuario no encontrado" });
        }

        const { firstName, lastName, username, bio } = req.body || {};
        const files = req.files || {};
        const updateData = {};
        const updatedFields = [];

        let currentUsername = user.username.toLowerCase();
        let userDir = path.join(uploadDir, currentUsername);

        // Crear carpeta si falta
        if (!fs.existsSync(userDir)) {
          fs.mkdirSync(userDir, { recursive: true });
        }

        // ======================================================
        // 1️⃣ Actualizar campos de texto
        // ======================================================
        if (firstName && firstName !== user.firstName) {
          updateData.firstName = firstName;
          updatedFields.push("firstName");
        }

        if (lastName && lastName !== user.lastName) {
          updateData.lastName = lastName;
          updatedFields.push("lastName");
        }

        if (bio && bio !== user.bio) {
          updateData.bio = bio;
          updatedFields.push("bio");
        }

        // ======================================================
        // 2️⃣ Cambiar username (y mover carpeta)
        // ======================================================
        if (username && username.toLowerCase() !== currentUsername) {
          const newUsername = username.trim().toLowerCase();

          const exists = await User.findOne({ username: newUsername });
          if (exists) {
            return res.status(400).json({
              success: false,
              error: "Ese nombre de usuario ya está en uso.",
            });
          }

          const newUserDir = path.join(uploadDir, newUsername);

          if (!fs.existsSync(newUserDir)) {
            fs.mkdirSync(newUserDir, { recursive: true });
          }

          if (fs.existsSync(userDir)) {
            try {
              fs.renameSync(userDir, newUserDir);
            } catch (err) {
              console.warn("⚠️ No se pudo renombrar carpeta:", err.message);
            }
          }

          userDir = newUserDir;
          currentUsername = newUsername;

          updateData.username = newUsername;
          updatedFields.push("username");
        }

        // ======================================================
        // 3️⃣ Procesar archivos (avatar / background)
        // ======================================================
        const processFile = (fieldNames, dbKey) => {
          const nameList = Array.isArray(fieldNames)
            ? fieldNames
            : [fieldNames];

          let file = null;
          for (const fn of nameList) {
            const arr = files?.[fn];
            if (Array.isArray(arr) && arr.length) {
              file = arr[0];
              break;
            }
          }

          // Fallback: si vino como req.file (single) lo tomamos igual
          if (!file && req.file) file = req.file;

          if (!file) return;

          const originalName =
            file.originalname || file.filename || file.name || "";
          const ext = path.extname(originalName).toLowerCase();
          const safeExt = ext || ".jpg";
          const filename = `${dbKey}-${Date.now()}${safeExt}`;
          const targetPath = path.join(userDir, filename);

          try {
            if (file.path && fs.existsSync(file.path)) {
              fs.renameSync(file.path, targetPath);
            } else if (file.buffer) {
              fs.writeFileSync(targetPath, file.buffer);
            } else {
              throw new Error("Archivo sin path ni buffer");
            }
          } catch (err) {
            console.warn(
              `⚠️ No se pudo mover archivo ${dbKey}:`,
              err.message
            );
            return;
          }

          // Borrar archivo anterior si existía
          if (user[dbKey]) {
            try {
              const oldPath = path.join(".", user[dbKey]);
              if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch {
              // ignoramos errores al borrar
            }
          }

          const relativeUrl = `/uploads/${currentUsername}/${filename}`;

          updateData[dbKey] = relativeUrl;
          updatedFields.push(dbKey);
        };

        processFile(["avatar", "avatarFile", "avatarData"], "avatarUrl");
        processFile(
          ["background", "backgroundFile", "backgroundData"],
          "backgroundUrl"
        );

        // ======================================================
        // 4️⃣ Guardar cambios
        // ======================================================
        if (Object.keys(updateData).length === 0) {
          // Aún así devolvemos el usuario actual con counts para refrescar el front
          const safeUser = await User.findById(userId)
            .select("-password")
            .lean();

          let postsCount = 0;
          try {
            postsCount = await PostModel.countDocuments({
              authorId: String(userId),
            });
          } catch {
            postsCount = 0;
          }

          return res.json({
            success: true,
            message: "No hay cambios",
            updatedFields: [],
            user: {
              id: safeUser._id,
              firstName: safeUser.firstName,
              lastName: safeUser.lastName,
              username: safeUser.username,
              bio: safeUser.bio,
              avatarUrl: resolveImage(safeUser.avatarUrl),
              backgroundUrl: resolveImage(safeUser.backgroundUrl),
              followers: safeUser.followers || [],
              following: safeUser.following || [],
              followersCount: Array.isArray(safeUser.followers)
                ? safeUser.followers.length
                : 0,
              followingCount: Array.isArray(safeUser.following)
                ? safeUser.following.length
                : 0,
              postsCount,
            },
          });
        }

        const updatedUser = await User.findByIdAndUpdate(
          userId,
          updateData,
          {
            new: true,
          }
        )
          .select("-password")
          .lean();

        // 🤏 Por si acaso updatedUser viene null (borrrado entre tanto)
        if (!updatedUser) {
          return res.status(404).json({
            success: false,
            error: "Usuario no encontrado tras la actualización",
          });
        }

        // ======================================================
        // 5️⃣ Contar posts para postsCount
        // ======================================================
        let postsCount = 0;
        try {
          postsCount = await PostModel.countDocuments({
            authorId: String(userId),
          });
        } catch {
          postsCount = 0;
        }

        // ======================================================
        // 6️⃣ Respuesta final con URLs completas + counts
        // ======================================================
        return res.json({
          success: true,
          message: "Perfil actualizado",
          updatedFields,
          user: {
            id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            username: updatedUser.username,
            bio: updatedUser.bio,
            avatarUrl: resolveImage(updatedUser.avatarUrl),
            backgroundUrl: resolveImage(updatedUser.backgroundUrl),
            followers: updatedUser.followers || [],
            following: updatedUser.following || [],
            followersCount: Array.isArray(updatedUser.followers)
              ? updatedUser.followers.length
              : 0,
            followingCount: Array.isArray(updatedUser.following)
              ? updatedUser.following.length
              : 0,
            postsCount,
          },
        });
      } catch (error) {
        console.error("❌ Error en /profile/update:", error);
        return res.status(500).json({
          success: false,
          error: "Ocurrió un error al actualizar el perfil",
        });
      }
    },
  };
}
