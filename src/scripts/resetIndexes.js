// src/scripts/resetIndexes.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../domain/User.js';  // O el modelo que quieras
import { YouTubeVideo } from '../domain/YouTubeVideo.js';
import { News } from '../domain/News.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/quickchatx'; // Tu URI de MongoDB

// Conectar a MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Conectado a MongoDB');
    
    try {
      // Eliminar índices existentes
      await Promise.all([
        User.collection.dropIndexes().catch(err => console.log('Error al eliminar índices de User:', err)),
        YouTubeVideo.collection.dropIndexes().catch(err => console.log('Error al eliminar índices de YouTubeVideo:', err)),
        News.collection.dropIndexes().catch(err => console.log('Error al eliminar índices de News:', err)),
      ]);

      console.log('Índices eliminados correctamente.');

      // Volver a crear los índices según los esquemas de los modelos
      await Promise.all([
        User.syncIndexes().catch(err => console.log('Error al crear índices de User:', err)),
        YouTubeVideo.syncIndexes().catch(err => console.log('Error al crear índices de YouTubeVideo:', err)),
        News.syncIndexes().catch(err => console.log('Error al crear índices de News:', err)),
      ]);

      console.log('Índices recreados correctamente.');

    } catch (err) {
      console.error('Error al reiniciar los índices:', err);
    } finally {
      mongoose.disconnect();
      console.log('Conexión cerrada');
    }
  })
  .catch(err => {
    console.error('Error de conexión a MongoDB:', err);
  });
