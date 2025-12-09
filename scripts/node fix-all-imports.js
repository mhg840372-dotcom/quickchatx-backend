// fix-imports-safe.js
// ================================
// Corrige imports duplicados y .js repetidos
// ================================

import fs from "fs";
import path from "path";

const ROOT_DIR = path.resolve("./src/interfaces");
const BACKUP_DIR = path.resolve("./backup_interfaces");

// Paquetes externos que no deben tener .js
const EXTERNAL_PACKAGES = [
  "fs", "path", "crypto", "jsonwebtoken", "express", "cors",
  "dotenv", "chalk", "node-fetch", "ws", "multer", "ua-parser-js"
];

// Crear backup
function backupFile(filePath) {
  const relative = path.relative(ROOT_DIR, filePath);
  const backupPath = path.join(BACKUP_DIR, relative);
  const dir = path.dirname(backupPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(filePath, backupPath);
}

// Procesar archivo
function fixFile(filePath) {
  backupFile(filePath);

  let content = fs.readFileSync(filePath, "utf8");

  // 1️⃣ Eliminar "import import"
  content = content.replace(/^import import /gm, "import ");

  // 2️⃣ Reducir .js repetidos
  content = content.replace(/\.js(\.js)+/g, ".js");

  // 3️⃣ Quitar .js de paquetes externos
  content = content.replace(/from ['"]([^'"]+)['"]/g, (match, p1) => {
    const pkgName = p1.split("/")[0];
    if (EXTERNAL_PACKAGES.includes(pkgName)) return `from '${p1.replace(/\.js$/, "")}'`;
    return match;
  });

  fs.writeFileSync(filePath, content, "utf8");
  console.log(`✅ Fixed: ${filePath}`);
}

// Recorrer directorio
function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (stat.isFile() && file.endsWith(".js")) {
      fixFile(fullPath);
    }
  }
}

// Ejecutar
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
walkDir(ROOT_DIR);
console.log("🎯 Todos los imports corregidos. Backup guardado en /backup_interfaces");
