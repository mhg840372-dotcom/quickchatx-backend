// ======================================================
// 🧹 scripts/cleanIndexes.js
// ✅ QuickChatX v4.5.5 — Limpieza de índices Mongo segura
// ======================================================

import mongoose from "mongoose";
import dotenv from "dotenv";
import chalk from "chalk";

// ======================================================
// ⚙️ Cargar entorno
// ======================================================
dotenv.config();
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/quickchatx";

if (!MONGO_URI) {
  console.error(chalk.red("❌ ERROR: No se encontró la variable MONGO_URI en .env"));
  process.exit(1);
}

// ======================================================
// 📦 Importar modelos disponibles de forma segura
// ======================================================
const MODELS = [];

async function safeImport(name, path) {
  try {
    const module = await import(path);
    const model =
      module?.UserModel ||
      module?.UserActivity ||
      module?.default ||
      Object.values(module)[0];
    if (model) {
      MODELS.push({ name, model });
      console.log(chalk.green(`✅ Modelo cargado: ${name}`));
    }
  } catch (err) {
    console.log(chalk.yellow(`⚠️  Modelo no encontrado o no válido: ${name}`));
  }
}

// Solo importará los que existan realmente
await safeImport("User", "../src/infrastructure/models/UserModel.js");
await safeImport("UserActivity", "../src/domain/UserActivity.js");
await safeImport("Chat", "../src/infrastructure/models/ChatModel.js");
await safeImport("Message", "../src/infrastructure/models/MessageModel.js");
await safeImport("Post", "../src/infrastructure/models/PostModel.js");
await safeImport("News", "../src/infrastructure/models/NewsModel.js");

// ======================================================
// 🚀 Función principal
// ======================================================
async function cleanIndexes() {
  try {
    console.log(chalk.cyanBright("\n🔌 Conectando a MongoDB..."));
    await mongoose.connect(MONGO_URI);

    for (const { name, model } of MODELS) {
      try {
        console.log(chalk.yellow(`\n🧱 Limpiando índices del modelo: ${name}`));
        const existing = await model.collection.indexes();

        for (const idx of existing) {
          if (idx.name !== "_id_") {
            await model.collection.dropIndex(idx.name);
            console.log(chalk.gray(`   ✖️ Eliminado índice: ${idx.name}`));
          }
        }

        await model.syncIndexes();
        console.log(chalk.greenBright(`   ✅ Índices sincronizados: ${name}`));
      } catch (err) {
        console.warn(chalk.red(`   ⚠️  Error limpiando índices de ${name}:`), err.message);
      }
    }

    console.log(chalk.greenBright("\n✅ Limpieza completada con éxito.\n"));
    await mongoose.disconnect();
  } catch (error) {
    console.error(chalk.red("❌ Error general al limpiar índices:"), error);
    process.exit(1);
  }
}

cleanIndexes();
