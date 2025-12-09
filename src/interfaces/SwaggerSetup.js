// ======================================================
// 📘 src/interfaces/SwaggerSetup.js
// ✅ QuickChatX v4.5.3 — Documentación Swagger unificada (API completa)
// ======================================================

import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import chalk from "chalk";

// ======================================================
// 📍 Rutas base (compatibilidad con ESM)
// ======================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// 🧩 Cargar todos los YAML disponibles
// ======================================================
function loadSwaggerFiles() {
  const docsPath = path.join(__dirname, "../docs");
  const files = [
    "auth.yaml",
    "youtube.yaml",
    "news.yaml",
    "profile.yaml",
    "feed.yaml",
    "activity.yaml",
    "redis.yaml",
  ];

  const combined = {
    openapi: "3.0.3",
    info: {
      title: "QuickChatX API",
      version: "4.5.3",
      description:
        "🚀 Documentación oficial de la API QuickChatX v4.5.3 — backend modular con Express, Redis y WebSockets",
      contact: { name: "QuickChatX Dev Team", email: "support@quickchatx.com" },
    },
    servers: [
      { url: "http://localhost:8085", description: "Servidor local" },
      { url: "https://api.quickchatx.com", description: "Producción" },
    ],
    tags: [],
    paths: {},
    components: { schemas: {}, securitySchemes: {} },
  };

  for (const file of files) {
    const fullPath = path.join(docsPath, file);
    if (!fsExists(fullPath)) continue;
    const doc = YAML.load(fullPath);

    // Combinar metadatos
    if (doc.tags) combined.tags.push(...doc.tags);
    if (doc.paths) Object.assign(combined.paths, doc.paths);
    if (doc.components?.schemas)
      Object.assign(combined.components.schemas, doc.components.schemas);
    if (doc.components?.securitySchemes)
      Object.assign(combined.components.securitySchemes, doc.components.securitySchemes);
  }

  return combined;
}

// ======================================================
// 🧰 Helper: verificar existencia de archivo
// ======================================================
function fsExists(file) {
  try {
    return !!(file && require("fs").existsSync(file));
  } catch {
    return false;
  }
}

// ======================================================
// 🚀 Middleware inicializador
// ======================================================
export function setupSwagger(app) {
  const swaggerDocument = loadSwaggerFiles();

  // Rutas estáticas y Swagger UI
  app.use("/docs", express.static(path.join(__dirname, "../docs")));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  console.log(
    chalk.blueBright("📘 Swagger UI disponible en: ") +
      chalk.cyan("http://localhost:8085/api-docs")
  );
  console.log(
    chalk.gray("📂 Documentos fuente: ") +
      path.join(__dirname, "../docs/*.yaml")
  );
}

// ======================================================
// ✅ Endpoints Swagger QuickChatX
// ------------------------------------------------------
// - GET /api-docs   → Interfaz Swagger UI (toda la API)
// - GET /docs       → Archivos YAML originales
// ------------------------------------------------------
// Incluye:
//  • Auth, YouTube, News, Profile, Feed, Activity, Redis
//  • Compatibilidad con múltiples servidores (local/prod)
// ======================================================
