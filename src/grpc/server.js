// ======================================================
// 🎧 gRPC Server — QuickChatX (uploads + posts + feed)
// ------------------------------------------------------
// ✔ Reusa PostService / UploadService (misma lógica que REST)
// ✔ Almacena metadata en Uploads y devuelve thumbUrl/thumbnailUrl
// ✔ Opera sobre la misma carpeta de uploads (UPLOADS_BASE_DIR)
// ======================================================

import path from "path";
import dotenv from "dotenv";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { PostService } from "../application/PostService.js";
import { Post } from "../domain/Post.js";
import { PostModel } from "../infrastructure/models/PostModel.js";
import { UploadService } from "../application/UploadService.js";
import Upload from "../domain/Upload.js";
import { UPLOADS_BASE_DIR } from "../infrastructure/uploadMiddleware.js";
import { ensureUploadDir } from "../infrastructure/FileStorage.js";

dotenv.config();

const PROTO_PATH = path.resolve(process.cwd(), "protos/quickchatx.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition).quickchatx;

const BASE_ASSETS_URL =
  process.env.PUBLIC_ASSETS_URL ||
  process.env.API_BASE_URL ||
  "https://api.quickchatx.com";

function extractRelativeUploadsPath(rawPath = "") {
  let p = rawPath.toString().trim().replace(/\\/g, "/");
  if (!p) return "";

  const idx = p.indexOf("/uploads/");
  if (idx !== -1) return p.slice(idx + "/uploads/".length);

  const parts = p.split("/").filter(Boolean);
  const index = parts.lastIndexOf("uploads");
  if (index >= 0 && index < parts.length - 1) {
    return parts.slice(index + 1).join("/");
  }

  return p;
}

function buildMediaUrl(rawPath) {
  const rel = extractRelativeUploadsPath(rawPath);
  if (!rel) return null;
  return `${BASE_ASSETS_URL}/uploads/${rel.replace(/^\/+/, "")}`;
}

function detectMediaType(mime = "", filename = "") {
  mime = (mime || "").toLowerCase();
  filename = (filename || "").toLowerCase();

  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  if (/\.(gif)$/i.test(filename)) return "gif";
  if (/\.(jpg|jpeg|png|webp)$/i.test(filename)) return "image";
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(filename)) return "video";
  if (/\.(mp3|wav|ogg)$/i.test(filename)) return "audio";

  return "file";
}

function deriveThumbUrl(media) {
  if (!media) return null;

  const existing =
    media.thumbnailUrl ||
    media.thumbUrl ||
    media.thumb ||
    media.thumbnail ||
    null;

  if (existing) {
    const relExisting = extractRelativeUploadsPath(existing);
    const absolute = buildMediaUrl(relExisting);
    if (absolute) return absolute;
  }

  if (media.type !== "video") return null;

  const rel = extractRelativeUploadsPath(media.path);
  if (!rel) return null;

  const baseName = rel.replace(/\.[^/.]+$/, "");
  return buildMediaUrl(`thumbs/${baseName}.jpg`);
}

function mapMediaToResponse(m = {}) {
  const url = buildMediaUrl(m.path || m.url);
  const thumbUrl = deriveThumbUrl({
    ...m,
    path: m.path || m.url,
  });

  return {
    path: url,
    url,
    mime: m.mime || m.mimetype || null,
    type: m.type || detectMediaType(m.mime, m.path || ""),
    size: m.size || null,
    thumbUrl,
    thumbnailUrl: thumbUrl,
  };
}

function mapPostToResponse(postPublic = {}) {
  const media = Array.isArray(postPublic.media)
    ? postPublic.media.map(mapMediaToResponse)
    : [];

  const createdAt = postPublic.createdAt
    ? new Date(postPublic.createdAt).getTime()
    : Date.now();
  const updatedAt = postPublic.updatedAt
    ? new Date(postPublic.updatedAt).getTime()
    : createdAt;

  return {
    id: postPublic.id || postPublic._id || null,
    authorId: postPublic.authorId || null,
    authorUsername: postPublic.authorUsername || null,
    content: postPublic.content || "",
    media,
    topics: postPublic.topics || [],
    likes: postPublic.likes || [],
    likesCount: postPublic.likesCount || (postPublic.likes || []).length || 0,
    commentsCount: postPublic.commentsCount || 0,
    createdAt,
    updatedAt,
  };
}

async function fetchPublicPost(doc) {
  const post = Post.fromDocument(doc);
  const publicPost = await post.toPublicJSON();
  return mapPostToResponse(publicPost);
}

const postServiceSingleton = new PostService();

async function handleCreatePost(call, callback) {
  try {
    const { authorId, authorUsername, content = "", media = [] } =
      call.request || {};

    if (!authorId || !authorUsername) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "authorId y authorUsername son requeridos",
      });
    }

    const files = Array.isArray(media)
      ? media.map((m) => {
          const rel = extractRelativeUploadsPath(m.path || m.url || "");
          const filename =
            (rel && rel.split("/").pop()) ||
            m.filename ||
            `file_${Date.now()}`;
          return {
            path: rel ? `/uploads/${rel}` : m.path || m.url || "",
            filename,
            mimetype: m.mime || null,
            size: m.size || null,
          };
        })
      : [];

    const post = await postServiceSingleton.createPost({
      authorId,
      authorUsername: String(authorUsername).toLowerCase(),
      content,
      files,
    });

    const publicPost = await post.toPublicJSON();
    return callback(null, { post: mapPostToResponse(publicPost) });
  } catch (err) {
    console.error("❌ gRPC CreatePost:", err);
    return callback({
      code: grpc.status.INTERNAL,
      message: err.message || "Error creando post",
    });
  }
}

function handleUploadMedia(call, callback) {
  const meta = {
    authorId: null,
    authorUsername: null,
    filename: null,
    mime: null,
  };

  const chunks = [];

  call.on("data", (msg) => {
    if (msg.authorId) meta.authorId = msg.authorId;
    if (msg.authorUsername) meta.authorUsername = msg.authorUsername;
    if (msg.filename) meta.filename = msg.filename;
    if (msg.mime) meta.mime = msg.mime;
    if (msg.chunk) chunks.push(msg.chunk);
  });

  call.on("error", (err) => {
    console.error("❌ gRPC UploadMedia stream error:", err);
  });

  call.on("end", async () => {
    try {
      if (!meta.authorId || !meta.authorUsername) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "authorId y authorUsername son requeridos",
        });
      }

      const buffer = Buffer.concat(chunks);
      if (!buffer.length) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "Archivo vacío o sin chunks",
        });
      }

      const file = {
        buffer,
        originalname:
          meta.filename || `upload_${Date.now()}.${(meta.mime || "").split("/").pop() || "bin"}`,
        mimetype: meta.mime || "application/octet-stream",
        size: buffer.length,
      };

      const user = {
        _id: meta.authorId,
        username: meta.authorUsername,
      };

      ensureUploadDir(UPLOADS_BASE_DIR);
      const saved = await UploadService.saveFile(file, user, UPLOADS_BASE_DIR);

      const type =
        saved.filetype ||
        detectMediaType(saved.mimetype, saved.filename || saved.path);

      const thumbUrl = deriveThumbUrl({
        path: saved.path,
        type,
        mime: saved.mimetype,
      });

      return callback(null, {
        path: saved.path,
        url: buildMediaUrl(saved.path),
        mime: saved.mimetype,
        type,
        size: saved.size,
        thumbUrl,
        thumbnailUrl: thumbUrl,
      });
    } catch (err) {
      console.error("❌ gRPC UploadMedia:", err);
      return callback({
        code: grpc.status.INTERNAL,
        message: err.message || "Error al subir archivo",
      });
    }
  });
}

async function handleListUserUploads(call, callback) {
  try {
    const { userId, limit = 50 } = call.request || {};
    if (!userId) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "userId requerido",
      });
    }

    const uploads = await Upload.find({ user: userId })
      .sort({ uploadedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 500))
      .lean();

    const uploadsMapped = uploads.map((u) => {
      const type = u.filetype || detectMediaType(u.mimetype, u.filename);
      const thumbUrl = deriveThumbUrl({
        path: u.path,
        type,
        mime: u.mimetype,
      });
      return {
        path: u.path,
        url: buildMediaUrl(u.path),
        mime: u.mimetype,
        type,
        size: u.size,
        thumbUrl,
        thumbnailUrl: thumbUrl,
      };
    });

    return callback(null, { uploads: uploadsMapped });
  } catch (err) {
    console.error("❌ gRPC ListUserUploads:", err);
    return callback({
      code: grpc.status.INTERNAL,
      message: err.message || "Error al listar uploads",
    });
  }
}

async function handleFeed(call, callback) {
  try {
    const {
      limit = 20,
      sinceMs = null,
      beforeMs = null,
    } = call.request || {};

    const query = { deletedAt: { $exists: false } };
    if (sinceMs) query.createdAt = { ...(query.createdAt || {}), $gt: new Date(Number(sinceMs)) };
    if (beforeMs) query.createdAt = { ...(query.createdAt || {}), $lt: new Date(Number(beforeMs)) };

    const docs = await PostModel.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();

    const posts = [];
    for (const doc of docs) {
      posts.push(await fetchPublicPost(doc));
    }

    return callback(null, { posts });
  } catch (err) {
    console.error("❌ gRPC Feed:", err);
    return callback({
      code: grpc.status.INTERNAL,
      message: err.message || "Error al obtener feed",
    });
  }
}

async function handleFeedStream(call) {
  try {
    const { limit = 20, sinceMs = null } = call.request || {};
    const query = { deletedAt: { $exists: false } };
    if (sinceMs) query.createdAt = { $gt: new Date(Number(sinceMs)) };

    const docs = await PostModel.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .lean();

    for (const doc of docs) {
      const post = await fetchPublicPost(doc);
      call.write(post);
    }

    call.end();
  } catch (err) {
    console.error("❌ gRPC FeedStream:", err);
    call.destroy(err);
  }
}

export async function startGrpcServer({
  port = process.env.GRPC_PORT || 50051,
} = {}) {
  const server = new grpc.Server({
    "grpc.max_receive_message_length": 200 * 1024 * 1024, // 200MB
    "grpc.max_send_message_length": 200 * 1024 * 1024,
  });

  server.addService(proto.QuickChatX.service, {
    CreatePost: handleCreatePost,
    UploadMedia: handleUploadMedia,
    ListUserUploads: handleListUserUploads,
    Feed: handleFeed,
    FeedStream: handleFeedStream,
  });

  ensureUploadDir(UPLOADS_BASE_DIR);

  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          console.error("❌ No se pudo iniciar gRPC:", err);
          return reject(err);
        }

        server.start();
        console.log(`🛰️ gRPC escuchando en 0.0.0.0:${boundPort}`);
        return resolve(server);
      }
    );
  });
}

// Permitir ejecutar standalone: `npm run grpc`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const { MongoProvider } = await import("../infrastructure/MongoProvider.js");
      await MongoProvider.connect();
      await MongoProvider.waitForConnection();
      await startGrpcServer();
    } catch (err) {
      console.error("❌ Error iniciando gRPC standalone:", err);
      process.exit(1);
    }
  })();
}
