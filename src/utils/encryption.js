import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "12345678901234567890123456789012"; // 32 chars
const IV = process.env.IV || "1234567890123456"; // 16 chars
const ALGORITHM = "aes-256-cbc";

// Función para encriptar texto
export function encryptMessage(text) {
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), Buffer.from(IV));
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

// Función para desencriptar texto
export function decryptMessage(encryptedText) {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), Buffer.from(IV));
    let decrypted = decipher.update(encryptedText, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("❌ Error desencriptando mensaje", error);
    return null;
  }
}
// -------------------------------