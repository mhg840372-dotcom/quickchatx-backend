// ======================================================
// 📦 src/application/UserService.js — v4.0 FOLLOW FIX
// ------------------------------------------------------
// ✔ Mantiene contactos (add/remove/block)
// ✔ FOLLOW / UNFOLLOW usan $addToSet / $pull sin revalidar username
// ✔ Evita errores por usuarios legacy con username inválido (@user)
// ======================================================

import { User } from "../domain/User.js";

export class UserService {
  // ======================================================
  // 🔍 BÁSICO
  // ======================================================
  async getUserById(userId) {
    return User.findById(userId).select("-password");
  }

  async updateProfile(userId, data) {
    // Mantener validaciones aquí: no queremos usernames nuevos con '@'
    return User.findByIdAndUpdate(userId, data, { new: true }).select(
      "-password"
    );
  }

  // ======================================================
  // 📇 CONTACTOS
  // ======================================================
  async addContact(userId, contactId) {
    const user = await User.findById(userId);
    if (!user) throw new Error("Usuario no encontrado");

    const exists = user.contacts.find(
      (c) => String(c.user) === String(contactId)
    );
    if (!exists) {
      user.contacts.push({ user: contactId, status: "added" });
      await user.save(); // aquí no suele haber usernames legacy, OK
    }
    return user;
  }

  async removeContact(userId, contactId) {
    const user = await User.findById(userId);
    if (!user) throw new Error("Usuario no encontrado");

    user.contacts = user.contacts.filter(
      (c) => String(c.user) !== String(contactId)
    );
    await user.save();
    return user;
  }

  async blockContact(userId, contactId) {
    const user = await User.findById(userId);
    if (!user) throw new Error("Usuario no encontrado");

    const contact = user.contacts.find(
      (c) => String(c.user) === String(contactId)
    );
    if (contact) {
      contact.status = "blocked";
      await user.save();
    }
    return user;
  }

  // ======================================================
  // 👥 FOLLOW / UNFOLLOW (SIN REVALIDAR USERNAME)
  // ------------------------------------------------------
  // Usamos updateOne + $addToSet / $pull y luego recargamos los docs.
  // Esto evita que Mongoose vuelva a validar username de usuarios legacy
  // que tengan '@' u otros caracteres no permitidos por el schema actual.
  // ======================================================
  async followUser(currentUserId, targetUserId) {
    if (!currentUserId || !targetUserId) {
      throw new Error("Ids inválidos");
    }

    if (String(currentUserId) === String(targetUserId)) {
      throw new Error("No puedes seguirte a ti mismo.");
    }

    // Verificar que ambos usuarios existen
    const [meExists, targetExists] = await Promise.all([
      User.findById(currentUserId).select("_id"),
      User.findById(targetUserId).select("_id"),
    ]);

    if (!meExists || !targetExists) {
      throw new Error("Usuario no encontrado.");
    }

    // Operaciones atómicas sin revalidar todo el documento
    await Promise.all([
      User.updateOne(
        { _id: currentUserId },
        { $addToSet: { following: targetUserId } },
        { runValidators: false }
      ),
      User.updateOne(
        { _id: targetUserId },
        { $addToSet: { followers: currentUserId } },
        { runValidators: false }
      ),
    ]);

    // Recargar versiones actualizadas para devolverlas a la API
    const [me, target] = await Promise.all([
      User.findById(currentUserId).select("-password -lastIP"),
      User.findById(targetUserId).select("-password -lastIP"),
    ]);

    return {
      me,
      target,
      following: true,
    };
  }

  async unfollowUser(currentUserId, targetUserId) {
    if (!currentUserId || !targetUserId) {
      throw new Error("Ids inválidos");
    }

    if (String(currentUserId) === String(targetUserId)) {
      throw new Error("No puedes dejar de seguirte a ti mismo (no aplica).");
    }

    const [meExists, targetExists] = await Promise.all([
      User.findById(currentUserId).select("_id"),
      User.findById(targetUserId).select("_id"),
    ]);

    if (!meExists || !targetExists) {
      throw new Error("Usuario no encontrado.");
    }

    // Igual que followUser: usamos $pull sin revalidar todo el schema
    await Promise.all([
      User.updateOne(
        { _id: currentUserId },
        { $pull: { following: targetUserId } },
        { runValidators: false }
      ),
      User.updateOne(
        { _id: targetUserId },
        { $pull: { followers: currentUserId } },
        { runValidators: false }
      ),
    ]);

    const [me, target] = await Promise.all([
      User.findById(currentUserId).select("-password -lastIP"),
      User.findById(targetUserId).select("-password -lastIP"),
    ]);

    return {
      me,
      target,
      following: false,
    };
  }

  async isFollowing(currentUserId, targetUserId) {
    if (!currentUserId || !targetUserId) return false;

    const me = await User.findById(currentUserId).select("following");
    if (!me || !Array.isArray(me.following)) return false;

    return me.following.some(
      (id) => String(id) === String(targetUserId)
    );
  }
}

// ✅ Default export para que funcione: `import UserService from ...`
export default UserService;
// ======================================================