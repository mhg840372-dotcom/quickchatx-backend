// scripts/debugImage.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

async function debugImage(url) {
  console.log("🔍 Debug imagen:", url);

  const res = await fetch(url);
  console.log("➡ Status:", res.status, res.statusText);
  console.log("➡ Content-Type:", res.headers.get("content-type"));
  console.log("➡ Content-Length:", res.headers.get("content-length"));

  const buffer = await res.buffer();
  console.log("➡ Buffer length:", buffer.length);

  // Guardamos una copia local para inspeccionarla manualmente
  const outPath = path.join(process.cwd(), "debug-image.bin");
  fs.writeFileSync(outPath, buffer);
  console.log("💾 Copia guardada en:", outPath);

  // Imprimimos los primeros bytes (magic number)
  console.log("➡ Primeros bytes:", buffer.slice(0, 16));
}

const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/debugImage.js <URL_DE_IMAGEN>");
  process.exit(1);
}

debugImage(url).catch((err) => {
  console.error("❌ Error debugImage:", err.message);
});
