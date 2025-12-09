// ======================================================
// 💬 src/domain/Comment.js — v11.2
// ✅ Dominio de Comentarios sin duplicar Schemas ni índices
// ------------------------------------------------------
// - Reutiliza el CommentModel de infraestructura
// - Evita índices duplicados (createdBy / parentId / targetId)
// - Mantiene compatibilidad con el resto del código
// ======================================================

import { Comment as CommentModel } from "../infrastructure/models/CommentModel.js";

// ✅ Export tipo "dominio": el resto del código puede seguir usando `Comment`
export const Comment = CommentModel;

// ✅ Export default por compatibilidad con imports antiguos:
//    import Comment from "../domain/Comment";
export default CommentModel;
