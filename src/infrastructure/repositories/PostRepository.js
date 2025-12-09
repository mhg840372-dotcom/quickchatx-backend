// src/infrastructure/repositories/PostRepository.js

import { PostModel } from "../models/PostModel.js";
import { Post } from "../../../domain/Post.js";

export class PostRepository {
  /**
   * Convierte un documento plano o null en una entidad Post
   */
  toEntity(doc) {
    if (!doc) return null;
    const plain = doc.toObject ? doc.toObject() : doc;
    return new Post(plain); // Post constructor ya soporta videoTopics, viewsCount, etc.
  }

  /**
   * Crea un nuevo Post
   */
  async create(postEntity) {
    try {
      const commentsArray = Array.isArray(postEntity.comments)
        ? postEntity.comments
        : [];

      const commentsCountExplicit =
        typeof postEntity.commentsCount === "number"
          ? postEntity.commentsCount
          : null;

      const viewsCountExplicit =
        typeof postEntity.viewsCount === "number"
          ? postEntity.viewsCount
          : null;

      const doc = await PostModel.create({
        authorId: String(postEntity.authorId),
        authorUsername: postEntity.authorUsername || undefined,

        content: postEntity.content,

        media: Array.isArray(postEntity.media)
          ? postEntity.media
          : [],

        likes: Array.isArray(postEntity.likes)
          ? postEntity.likes
          : [],

        topics: Array.isArray(postEntity.topics)
          ? postEntity.topics
          : [],

        // 🧠 IA de video
        videoTopics: Array.isArray(postEntity.videoTopics)
          ? postEntity.videoTopics
          : [],

        videoAnalyzedAt:
          postEntity.videoAnalyzedAt instanceof Date
            ? postEntity.videoAnalyzedAt
            : postEntity.videoAnalyzedAt
            ? new Date(postEntity.videoAnalyzedAt)
            : undefined,

        // El modelo ya NO guarda comentarios embebidos.
        // Si la entidad trae comments, usamos su longitud.
        commentsCount:
          commentsCountExplicit !== null
            ? commentsCountExplicit
            : commentsArray.length,

        // 👁️‍🗨️ Views iniciales (por defecto 0)
        viewsCount:
          viewsCountExplicit !== null ? viewsCountExplicit : 0,
      });

      return this.toEntity(doc);
    } catch (err) {
      console.error("❌ Error creating post:", err);
      throw err;
    }
  }

  /**
   * Busca un Post por ID
   */
  async findById(id) {
    try {
      const doc = await PostModel.findById(id).lean();
      return this.toEntity(doc);
    } catch (err) {
      console.error("❌ Error findById:", err);
      throw err;
    }
  }

  /**
   * Obtiene el feed general (paginado)
   * (Ignora posts soft-deleted)
   */
  async getFeed({ page = 1, limit = 20 }) {
    try {
      const skip = (page - 1) * limit;

      const docs = await PostModel.find({
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      return docs.map((d) => this.toEntity(d));
    } catch (err) {
      console.error("❌ Error getFeed:", err);
      throw err;
    }
  }

  /**
   * Obtiene posts más nuevos que X fecha
   * (Ignora posts soft-deleted)
   */
  async getNewer(sinceDate) {
    try {
      const docs = await PostModel.find({
        createdAt: { $gt: sinceDate },
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
        .sort({ createdAt: -1 })
        .lean();

      return docs.map((d) => this.toEntity(d));
    } catch (err) {
      console.error("❌ Error getNewer:", err);
      throw err;
    }
  }

  /**
   * Obtiene posts más antiguos que X fecha
   * (Ignora posts soft-deleted)
   */
  async getOlder(untilDate, limit = 20) {
    try {
      const docs = await PostModel.find({
        createdAt: { $lt: untilDate },
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return docs.map((d) => this.toEntity(d));
    } catch (err) {
      console.error("❌ Error getOlder:", err);
      throw err;
    }
  }

  /**
   * Guarda cambios en un Post existente
   */
  async save(postEntity) {
    try {
      const commentsArray = Array.isArray(postEntity.comments)
        ? postEntity.comments
        : [];

      const commentsCountExplicit =
        typeof postEntity.commentsCount === "number"
          ? postEntity.commentsCount
          : null;

      const viewsCountExplicit =
        typeof postEntity.viewsCount === "number"
          ? postEntity.viewsCount
          : null;

      const update = {
        content: postEntity.content,
        media: Array.isArray(postEntity.media)
          ? postEntity.media
          : [],
        likes: Array.isArray(postEntity.likes)
          ? postEntity.likes
          : [],
        topics: Array.isArray(postEntity.topics)
          ? postEntity.topics
          : [],

        commentsCount:
          commentsCountExplicit !== null
            ? commentsCountExplicit
            : commentsArray.length,

        updatedAt: new Date(),
      };

      // 🧠 IA de video (solo si vienen seteados en la entidad)
      if (Array.isArray(postEntity.videoTopics)) {
        update.videoTopics = postEntity.videoTopics;
      }

      if (postEntity.videoAnalyzedAt) {
        update.videoAnalyzedAt =
          postEntity.videoAnalyzedAt instanceof Date
            ? postEntity.videoAnalyzedAt
            : new Date(postEntity.videoAnalyzedAt);
      }

      // 👁️‍🗨️ Views si viene seteado desde el dominio
      if (viewsCountExplicit !== null) {
        update.viewsCount = viewsCountExplicit;
      }

      const updated = await PostModel.findByIdAndUpdate(
        postEntity._id || postEntity.id,
        { $set: update },
        { new: true, lean: true }
      );

      return this.toEntity(updated);
    } catch (err) {
      console.error("❌ Error saving post:", err);
      throw err;
    }
  }

  /**
   * 👁️ Incrementa viewsCount de forma atómica
   * (NO hace deduplicación por usuario, eso se maneja en frontend o en otra capa)
   */
  async incrementViews(postId, { amount = 1 } = {}) {
    try {
      const updated = await PostModel.findByIdAndUpdate(
        postId,
        {
          $inc: { viewsCount: amount },
          $set: { updatedAt: new Date() },
        },
        { new: true, lean: true }
      );

      return this.toEntity(updated);
    } catch (err) {
      console.error("❌ Error incrementing views:", err);
      throw err;
    }
  }
}
