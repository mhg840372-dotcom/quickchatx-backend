// ======================================================
// 🧱 src/infrastructure/repositories/CommentRepository.js
// ======================================================

import { CommentModel } from "../models/CommentModel.js";

export const CommentRepository = {
  async getByPostId(postId) {
    return CommentModel.find({ postId })
      .populate("userId", "username avatar")
      .sort({ createdAt: -1 })
      .lean();
  },

  async create(data) {
    const comment = new CommentModel(data);
    await comment.save();
    return comment.populate("userId", "username avatar");
  },

  async update(id, newData) {
    return CommentModel.findByIdAndUpdate(id, newData, { new: true }).populate(
      "userId",
      "username avatar"
    );
  },

  async delete(id) {
    return CommentModel.findByIdAndDelete(id);
  },
};
