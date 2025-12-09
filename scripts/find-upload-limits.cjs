#!/usr/bin/env node

// ======================================================
// 🔎 find-upload-limits.cjs — escáner de límites de subida
// ------------------------------------------------------
// Busca en todo el proyecto:
//
//  - "10MB", "10M", "10485760", "10 * 1024 * 1024"
//  - palabras tipo: maxFileSize, fileSize, uploadLimit,
//    maxBodyLength, maxContentLength, client_max_body_size, etc.
//  - uso típico de multer (upload.single / upload.array)
// ======================================================

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "uploads",
  "tmp_uploads",
  "dist",
  "build",
  ".turbo",
]);

const FILE_EXTS = [
  ".js",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".conf",
  ".config",
  ".nginx",
];

const PATTERNS = [
  {
    name: "literal 50MB",
    regex: /50\s*MB/i,
  },
  {
    name: "literal 50M",
    regex: /50M\b/i,
  },
  {
    name: "10485760 (50MB en bytes)",
    regex: /\b10485760\b/,
  },
  {
    name: "50 * 1024 * 1024",
    regex: /50\s*\*\s*1024\s*\*\s*1024/,
  },
  {
    name: "palabras clave de límite de tamaño",
    regex:
      /\b(maxFileSize|max_file_size|max_size|maxSize|fileSize|file_limit|uploadLimit|upload_limit|maxBodyLength|maxContentLength|client_max_body_size|bodyParser)\b/i,
  },
  {
    name: "subida de archivos (multer / upload.*)",
    regex: /multer\s*\(|upload\.single|upload\.array|upload\.fields/i,
  },
];

let totalMatches = 0;

function walk(dir, handler) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(fullPath, handler);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (FILE_EXTS.includes(ext)) {
        handler(fullPath);
      }
    }
  }
}

function scanFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  const relPath = path.relative(ROOT, filePath);
  let fileMatches = [];

  for (const pattern of PATTERNS) {
    const regex = pattern.regex;
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (regex.test(line)) {
        fileMatches.push({
          lineNumber: index + 1,
          patternName: pattern.name,
          lineText: line.trim(),
        });
      }
    });
  }

  if (fileMatches.length > 0) {
    console.log(`\n📄 Archivo: ${relPath}`);
    for (const m of fileMatches) {
      totalMatches++;
      console.log(
        `  • [${m.lineNumber}] (${m.patternName})\n    ${m.lineText}`
      );
    }
  }
}

console.log(
  `🔎 Buscando posibles límites de subida de archivos (10MB, maxFileSize, etc.) en: ${ROOT}\n`
);

walk(ROOT, scanFile);

console.log(`\nTotal coincidencias: ${totalMatches}`);
console.log(
  "👉 Revisa especialmente donde veas 50MB, 10485760, maxBodyLength, maxContentLength, maxFileSize, client_max_body_size, etc."
);
