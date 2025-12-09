// ======================================================
// 📌 UserModel.js — Ultra Stable (v10.1)
// ------------------------------------------------------
// ✅ Reutiliza SIEMPRE el modelo de dominio User
// ✅ Evita OverwriteModelError de Mongoose
// ✅ No duplica esquema (followers / following, bio, etc.)
// ✅ Compatible con import default y named import
// ======================================================

import { User } from "../../domain/User.js";

// Usamos el mismo modelo que define el dominio.
// Esto garantiza que cualquier cambio en src/domain/User.js
// se refleje automáticamente en toda la app.
const UserModel = User;

export { UserModel };
export default UserModel;
