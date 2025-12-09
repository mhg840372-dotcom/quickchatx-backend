// Importamos mongoose y dotenv
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Configuración de la URI y nombre de la base de datos
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'quickchatx';

// Función para conectar a MongoDB
async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: MONGO_DB,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Conectado a MongoDB');
  } catch (error) {
    console.error('Error de conexión a MongoDB:', error);
  }
}

// Función para eliminar índices duplicados
async function removeDuplicateIndexes() {
  const db = mongoose.connection.db;

  // Obtenemos todas las colecciones de la base de datos
  const collections = await db.collections();
  
  for (const collection of collections) {
    const indexes = await collection.indexes();

    const indexNames = indexes.map(index => index.name);
    const uniqueIndexNames = [...new Set(indexNames)];

    // Si encontramos índices duplicados, los eliminamos
    if (indexNames.length !== uniqueIndexNames.length) {
      console.log(`Eliminando índices duplicados de la colección: ${collection.collectionName}`);
      for (const index of indexes) {
        // Si el índice está duplicado, lo eliminamos
        if (indexNames.indexOf(index.name) !== indexNames.lastIndexOf(index.name)) {
          await collection.dropIndex(index.name);
          console.log(`Índice duplicado eliminado: ${index.name}`);
        }
      }
    }
  }
}

// Función para eliminar todas las colecciones
async function dropAllCollections() {
  const db = mongoose.connection.db;

  // Obtenemos todas las colecciones y las eliminamos
  const collections = await db.collections();
  for (const collection of collections) {
    try {
      await collection.drop();
      console.log(`Colección eliminada: ${collection.collectionName}`);
    } catch (error) {
      console.error(`Error al eliminar colección ${collection.collectionName}:`, error);
    }
  }
}

// Función para recrear los índices necesarios
async function recreateIndexes() {
  // Aquí, deberás especificar los índices necesarios para cada colección
  // Por ejemplo, para una colección 'User':
  const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true }
  }));

  // Crear los índices en 'User'
  await User.createIndexes();
  console.log('Índices recreados para la colección "User".');

  // Añadir aquí la recreación de índices para otras colecciones, por ejemplo:
  // const YouTubeVideo = mongoose.model('YouTubeVideo', new mongoose.Schema({ /* schema */ }));
  // await YouTubeVideo.createIndexes();
}

// Función para reiniciar la base de datos
async function resetDatabase() {
  try {
    await connectMongo();

    // Eliminar índices duplicados
    await removeDuplicateIndexes();

    // Eliminar todas las colecciones
    await dropAllCollections();

    // Reconstruir los índices necesarios
    await recreateIndexes();

    console.log('Base de datos reiniciada y limpia de índices duplicados.');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error al reiniciar la base de datos:', error);
    mongoose.connection.close();
  }
}

// Ejecutar el script para reiniciar la base de datos
resetDatabase();
