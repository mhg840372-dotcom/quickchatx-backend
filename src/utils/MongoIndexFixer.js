// ======================================================
// 🧩 src/utils/MongoIndexFixer.js
// ✅ QuickChatX v7.3 — Reparador y mantenedor automático de índices MongoDB
// ======================================================

import chalk from "chalk";
import cron from "node-cron";

/**
 * 🧠 Revisa y corrige índices duplicados o conflictivos en todas las colecciones MongoDB.
 *  - Detecta índices duplicados o con nombres conflictivos
 *  - Elimina índices huérfanos (auto generados)
 *  - Recrea índices esenciales definidos en los modelos
 *  - Totalmente compatible con Mongoose o conexión nativa
 */
export async function fixMongoIndexes(connection, modelList = []) {
  const db = connection?.db;
  if (!db) {
    console.log(chalk.red("[MongoIndexFixer] ❌ No hay conexión activa a MongoDB."));
    return;
  }

  console.log(chalk.cyan("[MongoIndexFixer] 🧩 Iniciando revisión global de índices..."));

  try {
    const collections = await db.listCollections().toArray();
    const total = collections.length;
    let fixedCount = 0;

    for (const { name } of collections) {
      const col = db.collection(name);
      console.log(chalk.gray(`\n🔍 Revisando colección: ${name}`));

      try {
        const indexes = await col.indexes();
        const seen = new Set();

        // 🔹 Detectar duplicados y eliminarlos
        for (const idx of indexes) {
          const keyStr = JSON.stringify(idx.key);
          if (seen.has(keyStr)) {
            console.log(chalk.yellow(`⚠️ Duplicado detectado en ${name}: ${idx.name}`));
            await col.dropIndex(idx.name).catch(() => {});
            fixedCount++;
          } else {
            seen.add(keyStr);
          }
        }

        // 🔹 Revisar índices esperados según el modelo
        const modelCfg = modelList.find((m) => m.model?.collection?.name === name);
        if (modelCfg?.expectedIndexes?.length) {
          for (const expected of modelCfg.expectedIndexes) {
            const field = expected.replace("_1", "");
            const exists = indexes.some((i) => i.name === expected);

            if (!exists) {
              console.log(chalk.blue(`🔧 Creando índice faltante "${expected}" en ${name}`));
              try {
                await col.createIndex({ [field]: 1 }, { unique: true, sparse: true });
                fixedCount++;
              } catch (e) {
                console.log(chalk.red(`❌ Error creando índice ${expected} en ${name}: ${e.message}`));
              }
            }
          }
        }

      } catch (err) {
        console.log(chalk.red(`💥 Error revisando ${name}: ${err.message}`));
      }
    }

    console.log(
      chalk.green(
        `\n[MongoIndexFixer] ✅ Revisión completada — ${total} colecciones revisadas, ${fixedCount} índices ajustados.`
      )
    );
  } catch (err) {
    console.error(chalk.red(`[MongoIndexFixer] ❌ Error global: ${err.message}`));
  }
}

/**
 * 🔍 Limpia índices duplicados de una colección específica.
 */
export async function fixCollectionIndexes(collection) {
  try {
    const indexes = await collection.indexes();
    const seen = new Set();
    let dropped = 0;

    for (const idx of indexes) {
      const keyStr = JSON.stringify(idx.key);
      if (seen.has(keyStr)) {
        console.log(chalk.yellow(`⚠️ Duplicado en colección ${collection.collectionName}: ${idx.name}`));
        await collection.dropIndex(idx.name).catch(() => {});
        dropped++;
      } else {
        seen.add(keyStr);
      }
    }

    if (dropped > 0) {
      console.log(
        chalk.green(`[MongoIndexFixer] 🔧 Limpieza completada en ${collection.collectionName} (${dropped} índices removidos)`)
      );
    }
  } catch (err) {
    console.log(chalk.red(`[MongoIndexFixer] ❌ Error en ${collection.collectionName}: ${err.message}`));
  }
}

/**
 * 🕒 Programa mantenimiento automático (por defecto, diario a las 03:00 AM).
 * @param {Object} connection - Conexión activa de Mongoose o MongoClient
 * @param {Array} modelList - Lista opcional de modelos con expectedIndexes
 * @param {String} cronExpr - Expresión cron (por defecto "0 3 * * *")
 */
export function scheduleAutoFix(connection, modelList = [], cronExpr = "0 3 * * *") {
  console.log(chalk.magenta(`[MongoIndexFixer] 🕒 Programando mantenimiento automático (${cronExpr})`));

  cron.schedule(cronExpr, async () => {
    console.log(chalk.magenta("\n[MongoIndexFixer] 🧹 Ejecutando mantenimiento automático de índices..."));
    await fixMongoIndexes(connection, modelList);
  });
}
