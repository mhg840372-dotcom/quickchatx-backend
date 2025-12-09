import mongoose from "mongoose";

const interactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: {
      type: String,
      enum: ["post", "news", "youtube"],
      required: true,
    },
    value: {
      type: String,
      enum: ["like", "dislike", "comment"],
      required: true,
    },
    text: { type: String, trim: true }, // solo si es comentario
  },
  { timestamps: true }
);

export default mongoose.model("Interaction", interactionSchema);
