// scripts/scanUploadsInDb.js
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { UPLOADS_BASE_DIR } from "../src/infrastructure/uploadMiddleware.js";

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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Dado un string que contiene "uploads/", intenta resolver la ruta local en disco.
function getLocalPathFromString(str) {
  if (!str || typeof str !== "string") return null;

  // Intentamos tratarlo como URL absoluta primero
  try {
    const u = new URL(str);
    const pathname = u.pathname || "";
    if (!pathname.includes("uploads/")) return null;

    const idx = pathname.indexOf("uploads/");
    const relative = pathname.slice(idx + "uploads/".length); // "user/archivo.jpg"
    return path.join(UPLOADS_BASE_DIR, relative);
  } catch {
    // No es URL, seguimos
  }

  // Rutas relativas
  const idx = str.indexOf("uploads/");
  if (idx === -1) return null;
  const relative = str.slice(idx + "uploads/".length);
  return path.join(UPLOADS_BASE_DIR, relative);
}

// Recorre recursivamente un documento y recopila TODAS las rutas de campos string que contengan "uploads/"
function collectUploadStrings(obj, prefix = "") {
  const results = [];

  if (obj === null || obj === undefined) return results;

  if (typeof obj === "string") {
    if (obj.includes("uploads/")) {
      results.push({ path: prefix || "<root>", value: obj });
    }
    return results;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const childPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      results.push(...collectUploadStrings(item, childPrefix));
    });
    return results;
  }

  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      results.push(...collectUploadStrings(value, childPrefix));
    }
  }

  return results;
}

async function scanCollection(db, collectionName, limit = 100, maxHits = 50) {
  const coll = db.collection(collectionName);
  const docs = await coll.find({}).limit(limit).toArray();

  console.log(`\n🔍 [${collectionName}] Escaneando ${docs.length} documentos...`);

  let hits = 0;

  for (const doc of docs) {
    const {_id, ...rest} = doc;
    const found = collectUploadStrings(rest);

    if (found.length === 0) continue;

    for (const hit of found) {
      const localPath = getLocalPathFromString(hit.value);
      let status = "skip";

      if (localPath) {
        const fileExists = await exists(localPath);
        status = fileExists ? "EXISTS" : "MISSING";
      }

      console.log(
        `  📄 doc=${_id} path=${hit.path} status=${status}\n     value=${hit.value}`
      );

      hits++;
      if (hits >= maxHits) {
        console.log(
          `  ⚠️ Máximo de ${maxHits} coincidencias alcanzado en ${collectionName}, omitiendo más...`
        );
        return;
      }
    }
  }

  if (hits === 0) {
    console.log(`  ℹ️ Ninguna referencia a "uploads/" encontrada en ${collectionName}`);
  }
}

async function main() {
  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error("❌ No hay URI de Mongo configurada en .env");
  }

  await mongoose.connect(uri);
  console.log("✅ Conectado a Mongo");

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  console.log(
    `📚 Colecciones encontradas: ${collections
      .map((c) => c.name)
      .join(", ")}`
  );

  for (const { name } of collections) {
    await scanCollection(db, name, 100, 50);
  }

  await mongoose.disconnect();
  console.log("\n🏁 Fin scanUploadsInDb");
}

main().catch((err) => {
  console.error("❌ Error en scanUploadsInDb:", err);
  process.exit(1);
});
