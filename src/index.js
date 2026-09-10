import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const app = express();
app.use(express.json());
app.use(cors());

// 1. Conexión a MongoDB de Railway
const mongoURI = process.env.MONGO_URL;

if (!mongoURI) {
        console.error('Falta la variable de entorno MONGO_URL.');
        process.exit(1);
}

// 2. Esquema y Modelo de Mongoose
const sensorSchema = new mongoose.Schema({
  temperatura: Number,
  humedad: Number,
  timestamp: { type: Date, default: Date.now }
});

sensorSchema.index({ timestamp: -1 });
const SensorData = mongoose.model('SensorData', sensorSchema);

// 3. Endpoint POST: La ESP32 envía datos aquí y se guardan en la base de datos
app.post('/api/sensor', async (req, res) => {
    const { temperatura, humedad } = req.body;
    
    if (temperatura !== undefined && humedad !== undefined) {
        try {
            const nuevaLectura = new SensorData({ temperatura, humedad });
            await nuevaLectura.save();
            console.log(`Dato guardado: ${temperatura}°C, ${humedad}%`);
            res.status(200).send("Datos guardados en BD");
        } catch (error) {
            console.error("Error al guardar en BD:", error);
            res.status(500).send("Error interno del servidor");
        }
    } else {
        res.status(400).send("Faltan datos de temperatura o humedad");
    }
});

// 4. Endpoint GET (Tiempo real): Para mostrar el número grande en el frontend
app.get('/api/sensor/actual', async (req, res) => {
    try {
        const ultimoDato = await SensorData.findOne().sort({ timestamp: -1 });
        res.json(ultimoDato || { temperatura: null, humedad: null, timestamp: null });
    } catch (error) {
        res.status(500).send("Error al obtener el dato actual");
    }
});

// 5. Endpoint GET (Historial): Para alimentar el gráfico de Recharts
app.get('/api/sensor/historial', async (req, res) => {
    const periodo = req.query.periodo || 'dia';
    let fechaInicio = new Date();

    if (periodo === 'dia') {
        fechaInicio.setDate(fechaInicio.getDate() - 1);
    } else if (periodo === 'semana') {
        fechaInicio.setDate(fechaInicio.getDate() - 7);
    } else if (periodo === 'mes') {
        fechaInicio.setMonth(fechaInicio.getMonth() - 1);
    }

    try {
        const historial = await SensorData.find({ timestamp: { $gte: fechaInicio } })
                                          .sort({ timestamp: 1 })
                                          .select('temperatura humedad timestamp -_id');
        res.json(historial);
    } catch (error) {
        res.status(500).send("Error al obtener el historial");
    }
});

const PORT = process.env.PORT || 3000;

mongoose.connect(mongoURI)
    .then(() => {
        console.log('Conectado a MongoDB de Railway exitosamente');
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor escuchando en el puerto ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error conectando a MongoDB de Railway:', error.message);
        process.exit(1);
    });