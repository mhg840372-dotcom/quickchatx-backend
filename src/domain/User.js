import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/* ===============================
   📞 Subdocumento de contactos
   =============================== */
const contactSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["added", "blocked"], default: "added" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* ===============================
   💻 Subdocumento de dispositivos
   =============================== */
const deviceSchema = new mongoose.Schema(
  {
    brand: String,
    manufacturer: String,
    modelName: String,
    deviceName: String,
    osName: String,
    osVersion: String,
    platform: String,
    ipLocal: String,
    locale: String,
    timezone: String,
    userAgent: String,
    userProvided: { userName: String, avatarUrl: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* ===============================
   👤 Esquema principal del usuario
   =============================== */
const userSchema = new mongoose.Schema(
  {
    // 🪪 Identidad
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-zA-Z0-9._-]{3,20}$/,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
      validate: {
        validator: (v) =>
          /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/.test(v),
        message:
          "La contraseña debe incluir mayúsculas, minúsculas y números.",
      },
    },

    // 📜 Términos y condiciones
    acceptedTerms: { type: Boolean, required: true, default: false },
    termsAcceptedAt: { type: Date, default: null },

    // 🖼️ Medios (legacy + nuevos campos modernos)
    profilePhoto: { type: String, default: "/uploads/default-avatar.png" },
    backgroundPhoto: { type: String, default: null },

    avatarUrl: { type: String, default: null },
    backgroundUrl: { type: String, default: null },

    // 👤 Info extra
    bio: { type: String, default: "" },

    // ☎️ Contacto y verificación
    phone: { type: String, default: null },
    isVerified: { type: Boolean, default: true },

    // 🧩 Relaciones sociales
    contacts: { type: [contactSchema], default: [] },
    devices: { type: [deviceSchema], default: [] },

    followers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    following: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    // ⚙️ Configuración
    settings: {
      notifications: { type: Boolean, default: true },
      privacy: {
        type: String,
        enum: ["everyone", "contacts", "private"],
        default: "everyone",
      },
      theme: {
        type: String,
        enum: ["light", "dark", "system"],
        default: "system",
      },
    },

    // 🧠 Estado
    status: {
      type: String,
      enum: ["online", "offline", "away", "busy"],
      default: "offline",
    },

    lastOnline: { type: Date, default: Date.now },
    isConnected: { type: Boolean, default: false },
    lastSocketId: { type: String, default: null },
    lastLogin: { type: Date, default: null },
    lastIP: { type: String, default: null },

    // 🔒 Rol
    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true, versionKey: false }
);

/* ===============================
   🖼 Virtuals seguros (NUEVO)
   =============================== */
userSchema.virtual("safeAvatar").get(function () {
  return (
    this.avatarUrl ||
    this.profilePhoto ||
    "/uploads/default-avatar.png"
  );
});

userSchema.virtual("safeBackground").get(function () {
  return (
    this.backgroundUrl ||
    this.backgroundPhoto ||
    null
  );
});

/* ===============================
   🔑 Hash de contraseña
   =============================== */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/* ===============================
   🔍 Métodos utilitarios
   =============================== */
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

/* ===============================
   🧩 Sugeridor de username
   =============================== */
userSchema.statics.suggestUsername = async function (base) {
  const clean = base.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  let suggestion = clean;
  let exists = await this.findOne({ username: suggestion });
  let counter = 1;

  while (exists && counter < 10) {
    suggestion = `${clean}${Math.floor(Math.random() * 9999)}`;
    exists = await this.findOne({ username: suggestion });
    counter++;
  }

  return suggestion;
};

/* ===============================
   📧 Validadores email/username
   =============================== */
userSchema.statics.isEmailTaken = async function (email) {
  return !!(await this.findOne({ email: email.toLowerCase() }));
};

userSchema.statics.isUsernameTaken = async function (username) {
  return !!(await this.findOne({ username: username.toLowerCase() }));
};

/* ===============================
   🔐 Registro
   =============================== */
userSchema.statics.register = async function (userData) {
  const { email, username, password, firstName, lastName, acceptedTerms } =
    userData;

  if (!acceptedTerms)
    throw new Error("Debes aceptar los Términos antes de registrarte.");

  if (await this.isEmailTaken(email))
    throw new Error("El correo electrónico ya está registrado.");

  if (await this.isUsernameTaken(username)) {
    const suggestion = await this.suggestUsername(username);
    throw new Error(
      `El nombre de usuario ya está tomado. Prueba con: ${suggestion}`
    );
  }

  const newUser = new this({
    firstName,
    lastName,
    email: email.toLowerCase(),
    username: username.toLowerCase(),
    password,
    acceptedTerms,
    termsAcceptedAt: new Date(),
  });

  await newUser.save();
  return newUser;
};

/* ===============================
   🔑 Login
   =============================== */
userSchema.statics.login = async function (identifier, password) {
  const user = await this.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { username: identifier.toLowerCase() },
    ],
  });

  if (!user) throw new Error("Usuario no encontrado.");
  const valid = await user.comparePassword(password);
  if (!valid) throw new Error("Contraseña incorrecta.");

  user.lastLogin = new Date();
  await user.save();

  return user;
};

/* ===============================
   🔍 toJSON seguro (MEJORADO)
   =============================== */
userSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });

  delete obj.password;
  delete obj.lastIP;

  // Reemplazar legacy → modernos
  obj.avatarUrl = obj.avatarUrl || obj.profilePhoto;
  obj.backgroundUrl = obj.backgroundUrl || obj.backgroundPhoto;

  return obj;
};

/* ===============================
   📦 Índices
   =============================== */
userSchema.index({ status: 1 });
userSchema.index({ lastLogin: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });

/* ===============================
   📦 Export
   =============================== */
export const User =
  mongoose.models.User || mongoose.model("User", userSchema);
