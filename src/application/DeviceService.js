// src/application/DeviceService.js
import DeviceInfo from "../domain/DeviceInfo.js";
import { User } from "../domain/User.js";

/**
 * Guarda la información del dispositivo y opcionalmente actualiza datos del usuario.
 * @param {Object} payload - Datos del dispositivo.
 * @param {string|null} userId - ID del usuario si existe.
 * @returns {Promise<DeviceInfo>} - Documento de dispositivo guardado.
 */
export async function saveDeviceInfo(payload, userId = null) {
  try {
    // Validaciones mínimas del payload
    if (!payload || typeof payload !== "object") {
      throw new Error("Payload inválido");
    }

    const deviceData = {
      userId,
      brand: payload.brand || "",
      manufacturer: payload.manufacturer || "",
      modelName: payload.modelName || "",
      deviceName: payload.deviceName || "",
      osName: payload.osName || "",
      osVersion: payload.osVersion || "",
      isDevice: payload.isDevice !== undefined ? payload.isDevice : true,
      platform: payload.platform || "",
      ipLocal: payload.ipLocal || "",
      ipPublic: payload.ipPublic || "",
      appInfo: payload.appInfo || {},
      locale: payload.locale || "",
      timezone: payload.timezone || "",
      userAgent: payload.userAgent || "",
      userProvided: payload.userProvided || null,
    };

    // Guardar documento del dispositivo
    const deviceDoc = new DeviceInfo(deviceData);
    await deviceDoc.save();

    // Actualizar información del usuario si existe
    if (userId && payload.userProvided) {
      const updates = {};
      if (payload.userProvided.userName) updates.name = payload.userProvided.userName;
      if (payload.userProvided.avatarUrl) updates.avatar = payload.userProvided.avatarUrl;

      if (Object.keys(updates).length > 0) {
        const user = await User.findById(userId);
        if (user) {
          const toSet = {};
          if (updates.name && (!user.name || user.name.trim() === "")) toSet.name = updates.name;
          if (updates.avatar && (!user.avatar || user.avatar.trim() === "")) toSet.avatar = updates.avatar;

          if (Object.keys(toSet).length > 0) {
            await User.findByIdAndUpdate(userId, { $set: toSet });
          }
        }
      }
    }

    return deviceDoc;
  } catch (err) {
    console.error("❌ Error en saveDeviceInfo", err);
    throw err; // Para que el controlador lo capture y devuelva un error HTTP
  }
}
// -------------------------------