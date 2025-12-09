// ======================================================
// 📁 src/interfaces/controllers/authController.js
// ✅ QuickChatX v9.1 PRO FIX (2025)
// ------------------------------------------------------
// • Compatibilidad con frontend (identifier + password)
// • Registro, Login y Perfil con UserActivityService
// • JWT seguro, bcrypt y Redis Ready
// • Payload del token incluye id y _id coherentes
// ======================================================

import { User } from "../../domain/User.js";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import bcrypt from "bcryptjs";
import { UserActivityService } from "../../application/UserActivityService.js";

const uploadDir = path.resolve("./uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

export function authController(JWT_SECRET) {
  if (!JWT_SECRET) throw new Error("❌ JWT_SECRET no definido");

  const signAuthToken = (user) => {
    return jwt.sign(
      {
        id: user._id.toString(),
        _id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role || "user",
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
  };

  return {
    // ======================================================
    // 🧾 REGISTRO DE USUARIO
    // ======================================================
    register: async (req, res) => {
      try {
        const {
          firstName,
          lastName,
          username,
          email,
          password,
          confirmPassword,
          phone,
        } = req.body;

        if (
          !firstName ||
          !lastName ||
          !username ||
          !email ||
          !password ||
          !confirmPassword
        ) {
          return res
            .status(400)
            .json({ error: "Todos los campos son obligatorios." });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return res
            .status(400)
            .json({ error: "Correo electrónico inválido." });

        if (password !== confirmPassword)
          return res
            .status(400)
            .json({ error: "Las contraseñas no coinciden." });

        if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/.test(password))
          return res.status(400).json({
            error:
              "La contraseña debe tener mínimo 6 caracteres, incluir mayúsculas, minúsculas y números.",
          });

        const exists = await User.findOne({
          $or: [
            { username: username.toLowerCase() },
            { email: email.toLowerCase() },
            { phone },
          ],
        });
        if (exists)
          return res.status(400).json({
            error:
              "El nombre de usuario, correo o teléfono ya están registrados.",
          });

        const userDir = path.join(uploadDir, username.toLowerCase());
        if (!fs.existsSync(userDir))
          fs.mkdirSync(userDir, { recursive: true });

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
          firstName,
          lastName,
          username: username.toLowerCase(),
          email: email.toLowerCase(),
          password: hashedPassword,
          phone: phone || null,
          profilePhoto: "/uploads/default-avatar.png",
          settings: { notifications: true, privacy: "everyone" },
          isVerified: true,
        });

        await UserActivityService.registerUserAction(
          user._id,
          "register",
          {
            description: "Usuario completó el registro.",
            ip: req.ip,
            userAgent: req.headers["user-agent"],
          }
        );

        // Opcional: podrías emitir token aquí también si quieres login directo
        return res.status(201).json({
          success: true,
          message: "Usuario registrado correctamente.",
          user: {
            _id: user._id,
            id: user._id.toString(),
            username: user.username,
            email: user.email,
            profilePhoto: user.profilePhoto,
          },
        });
      } catch (err) {
        console.error(chalk.red("❌ Error en registro:"), err);
        return res.status(500).json({ error: "Error interno del servidor." });
      }
    },

    // ======================================================
    // 🔐 LOGIN DE USUARIO (identifier + password)
    // ======================================================
    login: async (req, res) => {
      try {
        // 🔹 Ahora acepta { identifier, password } del frontend
        let { identifier, password } = req.body;

        if (!identifier || !password)
          return res
            .status(400)
            .json({ error: "Debe ingresar usuario y contraseña." });

        identifier = identifier.trim().toLowerCase();

        const user = await User.findOne({
          $or: [{ username: identifier }, { email: identifier }],
        });

        if (!user)
          return res.status(404).json({
            error: "Usuario no encontrado o credenciales inválidas.",
          });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid)
          return res.status(401).json({
            error: "Usuario no encontrado o credenciales inválidas.",
          });

        const token = signAuthToken(user);

        // 🧩 Registrar actividad
        await UserActivityService.registerUserAction(user._id, "login", {
          description: "Inicio de sesión exitoso.",
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });

        return res.json({
          success: true,
          message: "Inicio de sesión exitoso.",
          token,
          user: {
            _id: user._id,
            id: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role || "user",
            profilePhoto: user.profilePhoto,
          },
        });
      } catch (err) {
        console.error(chalk.red("❌ Error en login:"), err);
        return res
          .status(500)
          .json({ error: "Error interno del servidor." });
      }
    },

    // ======================================================
    // 🔍 CHEQUEAR USERNAME DISPONIBLE
    // ======================================================
    checkUsername: async (req, res) => {
      try {
        const { username } = req.query;
        if (!username)
          return res.status(400).json({ error: "Username requerido." });

        const normalized = String(username).toLowerCase();
        const exists = await User.findOne({ username: normalized });

        if (!exists) return res.json({ available: true, suggestions: [] });

        const suggestions = [
          `${normalized}_${Math.floor(Math.random() * 100)}`,
          `${normalized}${new Date().getFullYear()}`,
          `${normalized}_${Math.floor(Math.random() * 9999)}`,
          `${normalized}_x`,
          `${normalized}_1`,
        ];

        return res.json({ available: false, suggestions });
      } catch (err) {
        console.error(chalk.red("❌ checkUsername error:"), err);
        return res
          .status(500)
          .json({ error: "Error interno del servidor." });
      }
    },

    // ======================================================
    // 📧 CHEQUEAR EMAIL DISPONIBLE
    // ======================================================
    checkEmail: async (req, res) => {
      try {
        const { email } = req.query;
        if (!email)
          return res.status(400).json({ error: "Email requerido." });

        const exists = await User.findOne({
          email: String(email).toLowerCase(),
        });
        return res.json({ available: !exists });
      } catch (err) {
        console.error(chalk.red("❌ checkEmail error:"), err);
        return res
          .status(500)
          .json({ error: "Error interno del servidor." });
      }
    },

    // ======================================================
    // ✏️ ACTUALIZAR PERFIL DE USUARIO
    // ======================================================
    updateProfile: async (req, res) => {
      try {
        const userId = req.user?._id || req.user?.id;
        if (!userId)
          return res
            .status(401)
            .json({ error: "Token inválido o ausente." });

        const user = await User.findById(userId);
        if (!user)
          return res.status(404).json({ error: "Usuario no encontrado." });

        if (req.body.firstName) user.firstName = req.body.firstName;
        if (req.body.lastName) user.lastName = req.body.lastName;

        const pickFile = (names = []) => {
          if (!req.files) return null;
          for (const n of names) {
            const arr = req.files[n];
            if (Array.isArray(arr) && arr.length) return arr[0];
          }
          // fallback si vino como req.file
          if (req.file && names.includes(req.file.fieldname)) return req.file;
          return null;
        };

        const moveAndAssign = (file, dbField) => {
          if (!file) return;
          const userFolder = path.join(uploadDir, user.username.toLowerCase());
          if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });

          const original = file.originalname || file.filename || file.name || "";
          const ext = path.extname(original).toLowerCase() || ".jpg";
          const filename = `${dbField}-${Date.now()}${ext}`;
          const target = path.join(userFolder, filename);

          try {
            if (file.path && fs.existsSync(file.path)) fs.renameSync(file.path, target);
            else if (file.buffer) fs.writeFileSync(target, file.buffer);
            else throw new Error("Archivo sin path ni buffer");
          } catch (err) {
            console.warn(`⚠️ No se pudo guardar ${dbField}:`, err.message);
            return;
          }

          user[dbField] = `/uploads/${user.username.toLowerCase()}/${filename}`;
        };

        const avatarFile = pickFile(["avatar", "avatarFile", "avatarData"]);
        const backgroundFile = pickFile(["background", "backgroundFile", "backgroundData"]);

        moveAndAssign(avatarFile, "profilePhoto");
        moveAndAssign(backgroundFile, "backgroundPhoto");

        await user.save();

        await UserActivityService.registerUserAction(
          user._id,
          "profile_update",
          {
            description: "Usuario actualizó su perfil.",
            ip: req.ip,
            userAgent: req.headers["user-agent"],
          }
        );

        const safeUser = user.toJSON();
        const resolveImage = (url) => {
          if (!url) return null;
          if (url.startsWith("http")) return url;
          return `${process.env.API_BASE_URL || "https://api.quickchatx.com"}${url}`;
        };

        return res.json({
          success: true,
          message: "Perfil actualizado correctamente.",
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
          },
        });
      } catch (err) {
        console.error(chalk.red("❌ updateProfile error:"), err);
        return res
          .status(500)
          .json({ error: "Error interno del servidor." });
      }
    },
  };
}
