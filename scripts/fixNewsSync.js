// scripts/fixNewsSync.js
import fs from "fs";
import path from "path";

const filePath = path.resolve("./src/interfaces/newsSync.js");

if (!fs.existsSync(filePath)) {
  console.error("❌ El archivo no existe:", filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, "utf-8");

// 1️⃣ Corregir console.warn y console.error sin cerrar comillas
content = content.replace(/console\.(warn|error|log)\((["'])(.*?)\);/g, (match, fn, quote, text) => {
  // Si el texto termina en paréntesis, agregar comilla final
  if (!text.endsWith(quote)) {
    return `console.${fn}(${quote}${text}${quote});`;
  }
  return match;
});

// 2️⃣ Corregir strings que usan backtick mal cerrados
content = content.replace(/`([^`]*)$/gm, (match) => {
  if (!match.endsWith("`")) return match + "`";
  return match;
});

// 3️⃣ Revisar paréntesis y corchetes comunes (solo agrega cierre faltante simple)
const openParens = (content.match(/\(/g) || []).length;
const closeParens = (content.match(/\)/g) || []).length;
if (openParens > closeParens) {
  content += ")".repeat(openParens - closeParens);
}

const openBrackets = (content.match(/\[/g) || []).length;
const closeBrackets = (content.match(/\]/g) || []).length;
if (openBrackets > closeBrackets) {
  content += "]".repeat(openBrackets - closeBrackets);
}

const openBraces = (content.match(/\{/g) || []).length;
const closeBraces = (content.match(/\}/g) || []).length;
if (openBraces > closeBraces) {
  content += "}".repeat(openBraces - closeBraces);
}

// 4️⃣ Guardar backup
fs.writeFileSync(filePath + ".bak", content, "utf-8");
console.log("✅ Backup guardado como newsSync.js.bak");

// 5️⃣ Sobrescribir archivo original
fs.writeFileSync(filePath, content, "utf-8");
console.log("✅ Archivo corregido:", filePath);
