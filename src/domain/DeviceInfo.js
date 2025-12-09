// ================================
// 📱 src/domain/DeviceInfo.js (Optimizado)
// ================================

import mongoose from "mongoose";

const { Schema } = mongoose;

// ======================================
// 🧩 Esquema de información del dispositivo
// ======================================
const DeviceInfoSchema = new Schema(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: false, 
      index: true 
    },

    // 📱 Información del dispositivo
    brand: { type: String, trim: true },
    manufacturer: { type: String, trim: true },
    modelName: { type: String, trim: true },
    deviceName: { type: String, trim: true },

    // 💻 Sistema operativo y plataforma
    osName: { type: String, trim: true },
    osVersion: { type: String, trim: true },
    isDevice: { type: Boolean, default: true },
    platform: { type: String, trim: true },

    // 🌐 Información de red
    ipLocal: { type: String, trim: true },
    ipPublic: { type: String, trim: true },

    // ⚙️ Información adicional de la app
    appInfo: { type: Schema.Types.Mixed, default: {} },

    // 🌍 Configuración regional
    locale: { type: String, trim: true },
    timezone: { type: String, trim: true },

    // 🧭 Información del navegador / cliente
    userAgent: { type: String, trim: true },

    // 👤 Datos opcionales del usuario
    userProvided: {
      userName: { type: String, trim: true },
      avatarUrl: { type: String, trim: true },
    },

    // 🕒 Fecha de registro
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  }
);

// ======================================
// 📊 Índices adicionales recomendados
// ======================================
DeviceInfoSchema.index({ userId: 1, createdAt: -1 });
DeviceInfoSchema.index({ ipPublic: 1 });

// ======================================
// ✅ Exportación estándar
// ======================================
const DeviceInfo = mongoose.model("DeviceInfo", DeviceInfoSchema);
export default DeviceInfo;

/* ==========================================================
   ✅ Modelo DeviceInfo actualizado
   - Índices no duplicados
   - Campos sanitizados con trim
   - Compatibilidad para appInfo y userProvided
   - Estructura consistente con otros modelos
   ========================================================== */
