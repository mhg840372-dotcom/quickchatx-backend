// scripts/debug-upload-env.mjs
console.log("📦 Entorno de límites de upload (backend):");
console.log("UPLOAD_MAX_BYTES   =", process.env.UPLOAD_MAX_BYTES);
console.log("UPLOAD_MAX_MB      =", process.env.UPLOAD_MAX_MB);
console.log("UPLOAD_LIMIT_MB    =", process.env.UPLOAD_LIMIT_MB);
console.log("BODY_LIMIT_MB      =", process.env.BODY_LIMIT_MB);
console.log("UPLOAD_MAX_FILES   =", process.env.UPLOAD_MAX_FILES);
