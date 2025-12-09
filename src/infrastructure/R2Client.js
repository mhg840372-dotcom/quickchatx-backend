// src/infrastructure/R2Client.js
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const UPLOAD_DRIVER = process.env.UPLOAD_DRIVER || "local";

const R2_BUCKET = process.env.R2_BUCKET;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

let r2Client = null;

if (
  UPLOAD_DRIVER === "r2" &&
  R2_BUCKET &&
  R2_ENDPOINT &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY
) {
  r2Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    // Evita que el SDK añada headers de checksum que necesitan Content-Length.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  console.log("🪣 R2Client listo para bucket:", R2_BUCKET);
} else if (UPLOAD_DRIVER === "r2") {
  console.warn(
    "⚠️ UPLOAD_DRIVER=r2 pero faltan variables de entorno para R2 (R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)"
  );
}

export function isR2Enabled() {
  return !!r2Client;
}

export async function getR2ObjectStream(key) {
  if (!r2Client) {
    throw new Error("R2 no está configurado (r2Client nulo)");
  }

  const response = await r2Client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    })
  );

  return {
    stream: response.Body, // Readable stream
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}
