// src/domain/News.js
import mongoose from "mongoose";

// ======================================================
// 🧱 Esquema principal de noticias
// ======================================================
const newsSchema = new mongoose.Schema(
  {
    // 📰 Contenido principal
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    url: { type: String, required: true, unique: true },
    image: { type: String, default: "" },
    source: { type: String, default: "NewsAPI" },
    category: { type: String, default: "general" },

    // 📅 Fechas
    publishedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },

    // ❤️ Reacciones
    likes: { type: [String], default: [] }, // array de userIDs
    dislikes: { type: [String], default: [] },

    // 💬 Comentarios embebidos (NO se usan en la app actual, pero se mantienen)
    comments: {
      type: [
        {
          user: {
            _id: String,
            username: String,
            avatar: String,
          },
          text: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true, // agrega createdAt / updatedAt automáticos
    versionKey: false, // elimina el campo __v
  }
);

// ======================================================
// ⚙️ Índices inteligentes para rendimiento
// ======================================================
newsSchema.index({ publishedAt: -1 });
newsSchema.index({ createdAt: -1 });
newsSchema.index({ category: 1, publishedAt: -1 });
// Índice de texto compuesto
newsSchema.index({ title: "text", description: "text", source: "text" });

// ======================================================
// 🧠 Métodos de instancia
// ======================================================
newsSchema.methods.toggleLike = function (userId, value = 1) {
  const uid = String(userId);

  this.likes = Array.isArray(this.likes) ? this.likes : [];
  this.dislikes = Array.isArray(this.dislikes) ? this.dislikes : [];

  // quitar cualquier reacción previa
  this.likes = this.likes.filter((id) => String(id) !== uid);
  this.dislikes = this.dislikes.filter((id) => String(id) !== uid);

  // aplicar nueva reacción
  if (value === 1) {
    this.likes.push(uid);
  } else if (value === -1) {
    this.dislikes.push(uid);
  }
};

newsSchema.methods.toJSON = function () {
  const likesArr = Array.isArray(this.likes) ? this.likes : [];
  const dislikesArr = Array.isArray(this.dislikes) ? this.dislikes : [];
  const commentsArr = Array.isArray(this.comments) ? this.comments : [];

  return {
    id: this._id?.toString(),
    _id: this._id,
    title: this.title,
    description: this.description,
    url: this.url,
    image: this.image,
    source: this.source,
    category: this.category,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,

    likes: likesArr,
    dislikes: dislikesArr,
    likesCount: likesArr.length,
    dislikesCount: dislikesArr.length,

    comments: commentsArr,
    commentsCount: commentsArr.length,

    type: "news",
  };
};

// ======================================================
// 🚀 Modelo exportado (ESM)
// ======================================================
export const News = mongoose.model("News", newsSchema);
export default News;
