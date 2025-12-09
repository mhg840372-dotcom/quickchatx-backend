#!/usr/bin/env node
import fs from "fs";
import path from "path";

const ROUTES_DIR = path.join(process.cwd(), "src/interfaces/routes");

const CORRECTIONS = {
  controllers: "../controllers",
  application: "../../application",
  infrastructure: "../../infrastructure",
};

function fixImportsInFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  let original = content;

  content = content.replace(/import\s+({[^}]+}|\w+)\s+from\s+['"](\.{1,2}\/(controllers|application|infrastructure)[^'"]*)['"]/g, (match, imports, importPath, type) => {
    const parts = importPath.split("/");
    const last = parts.pop();
    const correctedBase = CORRECTIONS[type];
    const correctedPath = path.posix.join(correctedBase, last);
    return `import ${imports} from "${correctedPath}.js"`;
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`✅ Imports corregidos en ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) walkDir(fullPath);
    else if (file.endsWith(".js")) fixImportsInFile(fullPath);
  }
}

walkDir(ROUTES_DIR);
console.log("🎯 Todos los imports revisados y corregidos.");
// ================================