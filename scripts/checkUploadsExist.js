// scripts/checkUploadsExist.js
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Igual que en ExpressApp: usamos la misma carpeta de uploads
import { UPLOADS_BASE_DIR } from "../src/infrastructure/uploadMiddleware.js";

// Import defensivo de modelos (como en tu código)
import * as PostModelModule from "../src/infrastructure/models/PostModel.js";
import * as UserModelModule from "../src/infrastructure/models/UserModel.js";

const PostModel =
  PostModelModule.default ||
  PostModelModule.PostModel ||
  PostModelModule.Post ||
  null;

const UserModel =
  UserModelModule.default ||
  UserModelModule.UserModel ||
  UserModelModule.User ||
  null;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Extrae el path local a partir de la URL completa o relativa
function getLocalPathFromUrl(url) {
  if (!url || typeof url !== "string") return null;

  // Caso 1: URL absoluta
  try {
    const u = new URL(url);
    const pathname = u.pathname || "";
    if (!pathname.startsWith("/uploads/")) return null;

    const relative = pathname.replace("/uploads/", ""); // user/archivo.jpg
    return path.join(UPLOADS_BASE_DIR, relative);
  } catch {
    // No era una URL absoluta, seguimos abajo
  }

  // Caso 2: rutas relativas
  if (url.startsWith("/uploads/")) {
    const relative = url.replace("/uploads/", "");
    return path.join(UPLOADS_BASE_DIR, relative);
  }
  if (url.startsWith("uploads/")) {
    const relative = url.replace("uploads/", "");
    return path.join(UPLOADS_BASE_DIR, relative);
  }

  return null;
}

function resolveMongoUri() {
  const candidates = [
    "MONGO_URI",
    "MONGODB_URI",
    "MONGO_URL",
    "DB_URI",
    "DATABASE_URL",
  ];

  for (const key of candidates) {
    const value = process.env[key];
    if (value) {
      console.log(`🔌 Usando ${key} para conectar a Mongo`);
      return value;
    }
  }

  console.error("❌ No se encontró ninguna variable de Mongo en .env");
  console.error(
    "   Revisa que tengas alguna de estas definidas: MONGO_URI, MONGODB_URI, MONGO_URL, DB_URI, DATABASE_URL"
  );
  return null;
}

async function checkModelUploads({ Model, name, fields }) {
  if (!Model) {
    console.warn(`⚠️ Modelo ${name} no disponible, se omite`);
    return;
  }

  // Buscamos documentos donde ALGUNO de los campos contenga "/uploads/"
  const or = fields.map((f) => ({ [f]: { $regex: "/uploads/" } }));
  const query = { $or: or };

  const docs = await Model.find(query, fields.concat(["createdAt"]))
    .sort({ createdAt: 1 })
    .limit(200);

  console.log(
    `\n🔍 [${name}] Revisando ${docs.length} documentos con referencias a /uploads`
  );

  let missing = 0;
  let ok = 0;

  for (const doc of docs) {
    for (const field of fields) {
      const url = doc[field];
      if (!url || typeof url !== "string") continue;
      if (!url.includes("/uploads/") && !url.startsWith("uploads/")) continue;

      const localPath = getLocalPathFromUrl(url);
      if (!localPath) {
        console.log(
          `⚠️ [${name}] ${doc._id} campo=${field} tiene formato raro: ${url}`
        );
        continue;
      }

      const fileExists = await exists(localPath);

      if (!fileExists) {
        missing++;
        console.log(`❌ [${name}] FALTA archivo para doc ${doc._id}`);
        console.log(`   campo=${field}`);
        console.log(`   URL:  ${url}`);
        console.log(`   PATH: ${localPath}`);
      } else {
        ok++;
      }
    }
  }

  console.log(
    `✅ [${name}] EXISTEN=${ok} | FALTAN=${missing} (sobre ${docs.length} docs)`
  );
}

async function main() {
  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error("❌ No hay URI de Mongo configurada en .env");
  }

  await mongoose.connect(uri);
  console.log("✅ Conectado a Mongo");

  // Campos típicos donde puedes tener imágenes subidas
  await checkModelUploads({
    Model: PostModel,
    name: "Post",
    fields: ["imageUrl", "thumbnailUrl", "image", "mediaUrl", "fileUrl"],
  });

  await checkModelUploads({
    Model: UserModel,
    name: "User",
    fields: ["avatarUrl", "profileImage", "imageUrl"],
  });

  // Si tienes un modelo News con imágenes en /uploads, podrías añadirlo igual aquí.

  await mongoose.disconnect();
  console.log("\n🏁 Fin checkUploadsExist");
}

main().catch((err) => {
  console.error("❌ Error en checkUploadsExist:", err);
  process.exit(1);
});
