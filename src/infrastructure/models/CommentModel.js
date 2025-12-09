// ======================================================
// 💬 CommentModel — QuickChatX v10.4 MEDIA + SAFE VALIDATION
// ======================================================

import mongoose from "mongoose";

const { Schema } = mongoose;

const CommentSchema = new Schema(
  {
    // 👇 Ya NO es required aquí (lo controlamos en pre('validate'))
    content: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    targetType: {
      type: String,
      enum: ["post"],
      default: "post",
      required: true,
    },

    targetId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },

    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },

    repliesCount: {
      type: Number,
      default: 0,
    },

    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ✅ NUEVO: media opcional (array)
    media: [
      new Schema(
        {
          path: { type: String, required: true }, // /uploads/...
          url: { type: String }, // puede ser igual que path
          type: {
            type: String,
            enum: ["image", "video", "gif", "file"],
            default: "image",
          },
          mime: { type: String },
          size: { type: Number },
          uploadId: { type: Schema.Types.ObjectId, ref: "Upload" },
        },
        { _id: false }
      ),
    ],

    // opcional, por si más adelante quieres embeddear mini-post
    embeddedPost: {
      type: Object,
      default: null,
    },

    editedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// 🧠 Validación: o texto o media, pero no vacío
// ======================================================
CommentSchema.pre("validate", function (next) {
  const hasText =
    typeof this.content === "string" &&
    this.content.trim().length > 0;

  const hasMedia =
    Array.isArray(this.media) && this.media.length > 0;

  if (!hasText && !hasMedia) {
    return next(new Error("El comentario no puede estar vacío"));
  }
  return next();
});

// 🔧 Índices: solo los necesarios aquí
CommentSchema.index({ targetId: 1, targetType: 1 });
CommentSchema.index({ content: "text" });

CommentSchema.virtual("likeCount").get(function () {
  return this.likes.length;
});

CommentSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

// ======================================================
// 📦 Export: named + default (compat total)
// ======================================================
const CommentModel =
  mongoose.models.Comment || mongoose.model("Comment", CommentSchema);

export const Comment = CommentModel;
export default CommentModel;
