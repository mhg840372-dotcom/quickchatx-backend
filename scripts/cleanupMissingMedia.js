// scripts/cleanupMissingMedia.js
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { UPLOADS_BASE_DIR } from "../src/infrastructure/uploadMiddleware.js";
import * as PostModelModule from "../src/infrastructure/models/PostModel.js";

const PostModel =
  PostModelModule.default ||
  PostModelModule.PostModel ||
  PostModelModule.Post ||
  null;

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

  throw new Error(
    "❌ No se encontró ninguna URI de Mongo (MONGO_URI, MONGODB_URI, MONGO_URL, DB_URI, DATABASE_URL)"
  );
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getLocalPathFromString(str) {
  if (!str || typeof str !== "string") return null;

  // 1) URL absoluta
  try {
    const u = new URL(str);
    const pathname = u.pathname || "";
    const idx = pathname.indexOf("uploads/");
    if (idx === -1) return null;
    const relative = pathname.slice(idx + "uploads/".length);
    return path.join(UPLOADS_BASE_DIR, relative);
  } catch {
    // no era URL, seguimos
  }

  // 2) String con "uploads/" dentro
  const idx = str.indexOf("uploads/");
  if (idx === -1) return null;
  const relative = str.slice(idx + "uploads/".length);
  return path.join(UPLOADS_BASE_DIR, relative);
}

async function cleanupPost(post) {
  if (!Array.isArray(post.media) || post.media.length === 0) return false;

  const original = post.media;
  const cleaned = [];

  for (const m of original) {
    if (!m || typeof m !== "object") continue;

    const candidate = m.path || m.filePath || m.url;
    if (!candidate || typeof candidate !== "string") {
      cleaned.push(m);
      continue;
    }

    const localPath = getLocalPathFromString(candidate);
    if (!localPath) {
      // No parece apuntar a /uploads → lo dejamos
      cleaned.push(m);
      continue;
    }

    const ok = await exists(localPath);
    if (!ok) {
      console.log(
        `❌ [cleanup] Post ${post._id} media eliminado. candidate=${candidate} local=${localPath}`
      );
      continue; // NO añadimos este media
    }

    cleaned.push(m);
  }

  if (cleaned.length === original.length) return false;

  post.media = cleaned;
  return true;
}

async function main() {
  if (!PostModel) {
    throw new Error("❌ No se pudo resolver PostModel");
  }

  const uri = resolveMongoUri();
  await mongoose.connect(uri);
  console.log("✅ Conectado a Mongo");

  const cursor = PostModel.find(
    { media: { $exists: true, $ne: [] } },
    { media: 1 }
  ).cursor();

  let checked = 0;
  let modified = 0;

  for (let post = await cursor.next(); post != null; post = await cursor.next()) {
    const changed = await cleanupPost(post);
    checked++;

    if (changed) {
      await post.save();
      modified++;
    }

    if (checked % 50 === 0) {
      console.log(`🔄 Revisados ${checked} posts... modificados=${modified}`);
    }
  }

  console.log(`🏁 Limpieza completada. Revisados=${checked} modificados=${modified}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Error en cleanupMissingMedia:", err);
  process.exit(1);
});
