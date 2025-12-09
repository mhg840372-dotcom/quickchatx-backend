import fs from "fs";
import path from "path";

const UPLOAD_DRIVER = process.env.UPLOAD_DRIVER || "local";

/**
 * Asegura que el destino de uploads exista o sea válido.
 *
 * - Modo "local": crea el directorio en disco (comportamiento original).
 * - Modo "r2": no crea directorio local; devuelve el bucket o prefijo a usar en R2.
 *
 * @param {string} dir - Ruta del directorio (local) o nombre/prefijo (R2)
 * @returns {string} - Ruta absoluta (local) o bucket/prefijo (R2)
 */
export function ensureUploadDir(dir) {
  // MODO R2: no usamos el sistema de archivos local
  if (UPLOAD_DRIVER === "r2") {
    const bucketOrPrefix = process.env.R2_BUCKET || dir;

    console.log(
      `🪣 UPLOAD_DRIVER=r2 → usando Cloudflare R2 (no se crea directorio local). Bucket/prefijo: ${bucketOrPrefix}`
    );

    // Aquí simplemente devolvemos el bucket o prefijo que luego usarás con el SDK de R2
    return bucketOrPrefix;
  }

  // MODO LOCAL: comportamiento original
  const absoluteDir = path.resolve(dir);
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
    console.log(`📁 Directorio creado: ${absoluteDir}`);
  }
  return absoluteDir;
}
