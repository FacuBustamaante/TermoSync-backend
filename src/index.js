import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import 'dotenv/config';
import webpush from 'web-push';

webpush.setVapidDetails(
   'mailto:facundombustamante@gmail.com',
   process.env.VAPID_PUBLIC_KEY,
   process.env.VAPID_PRIVATE_KEY
);

const app = express();
app.use(express.json());
app.use(cors());

// 1. Conexión a MongoDB de Railway
const mongoURI = process.env.MONGO_URL;

if (!mongoURI) {
   console.error('Falta la variable de entorno MONGO_URL.');
   process.exit(1);
}

// 2. Esquemas y Modelos de Mongoose

// Colección para mapear Sucursales con sus ESP32
const branchSchema = new mongoose.Schema({
   name: String, // ej: "Sucursal Centro"
   espDevices: [String] // Array de MAC addresses asignadas a esta sucursal
});
const Branch = mongoose.model('Branch', branchSchema);

// Colección para las suscripciones push (para notificaciones)
const subscriptionSchema = new mongoose.Schema({
   branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }, // Para avisar solo a los de esta sucursal
   subscription: Object // Acá guardamos el token que nos manda el celular
});
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);

// Colección para la Telemetría (Historial de temperaturas)
const telemetrySchema = new mongoose.Schema({
   deviceId: String,
   branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
   timestamp: { type: Date, default: Date.now, expires: '30d' },
   readings: [{
      address: String, // MAC del sensor DS18B20
      temp: Number     // Temperatura registrada
   }]
});

// Índices para optimizar las consultas por fecha y por sucursal
telemetrySchema.index({ timestamp: -1 });
telemetrySchema.index({ branchId: 1, timestamp: -1 });
const Telemetry = mongoose.model('Telemetry', telemetrySchema);

// 3. Endpoint POST: La ESP32 envía los datos de múltiples sensores
app.post('/api/sensor', async (req, res) => {
   const { deviceId, readings } = req.body;

   if (deviceId && Array.isArray(readings)) {
      try {
         // Buscamos a qué sucursal pertenece esta ESP32
         const branch = await Branch.findOne({ espDevices: deviceId });
         const branchId = branch ? branch._id : null; // Si no está registrada, queda huérfana (null)

         const nuevaLectura = new Telemetry({
            deviceId,
            branchId,
            readings
         });

         await nuevaLectura.save();
         console.log(`Guardados ${readings.length} sensores del dispositivo ${deviceId}`);
         const UMBRAL_CRITICO = 8.0; // Si pasa de 8 grados, avisa. Cambialo a tu gusto.
         const sensoresEnPeligro = readings.filter(sensor => sensor.temp > UMBRAL_CRITICO);

         if (sensoresEnPeligro.length > 0) {
            // Buscamos los celulares registrados para esta sucursal
            const suscripciones = await PushSubscription.find({ branchId });

            // Armamos el mensajito que va a salir en la pantalla del celular
            const payload = JSON.stringify({
               title: 'Alerta ThermalSync',
               body: `Atención: ${sensoresEnPeligro.length} heladera(s) en ${nombreSucursal} superaron los ${UMBRAL_CRITICO}°C.`,
               icon: '/apple-touch-icon.png' // Usamos el mismo ícono que configuraste para iOS
            });

            // Disparamos la notificación a todos los celulares
            const promesas = suscripciones.map(sub =>
               webpush.sendNotification(sub.subscription, payload).catch(err => {
                  console.log("Error enviando push (posible desuscripción):", err.statusCode);
                  // Si el error es 410 (Gone), el usuario borró la app. Podríamos borrar la sub de la BD.
                  if (err.statusCode === 410) {
                     return PushSubscription.findByIdAndDelete(sub._id);
                  }
               })
            );
            await Promise.all(promesas);
            console.log(`🔔 Alerta PUSH disparada a ${suscripciones.length} dispositivos.`);
         }
         res.status(200).send("Datos guardados en BD");
      } catch (error) {
         console.error("Error al guardar en BD:", error);
         res.status(500).send("Error interno del servidor");
      }
   } else {
      res.status(400).send("Payload inválido. Se esperaba deviceId y un array de readings.");
   }
});

// 4. Endpoint GET: Obtener lista de sucursales para el select del Frontend
app.get('/api/branches', async (req, res) => {
   try {
      const branches = await Branch.find().select('name _id');
      res.json(branches);
   } catch (error) {
      console.error("Error al obtener sucursales:", error);
      res.status(500).send("Error al obtener las sucursales");
   }
});

// 5. Endpoint GET (Tiempo real): Obtener las últimas lecturas de una sucursal específica
app.get('/api/telemetry', async (req, res) => {
   const { branchId } = req.query;

   try {
      let query = {};
      if (branchId) {
         query.branchId = branchId;
      }

      // Buscamos el último reporte recibido de esa sucursal
      const ultimoDato = await Telemetry.findOne(query).sort({ timestamp: -1 });

      if (ultimoDato) {
         // Devolvemos directamente el array de sensores para que el frontend lo mapée
         res.json(ultimoDato.readings);
      } else {
         res.json([]); // Si no hay datos, devolvemos un array vacío
      }
   } catch (error) {
      console.error("Error al obtener datos actuales:", error);
      res.status(500).send("Error al obtener los datos de la sucursal");
   }
});

// 6. Endpoint GET (Historial): Para los gráficos en React, filtrado por sucursal
app.get('/api/telemetry/historial', async (req, res) => {
   const { branchId, periodo = 'dia' } = req.query;
   let fechaInicio = new Date();

   if (periodo === 'dia') {
      fechaInicio.setDate(fechaInicio.getDate() - 1);
   } else if (periodo === 'semana') {
      fechaInicio.setDate(fechaInicio.getDate() - 7);
   } else if (periodo === 'mes') {
      fechaInicio.setMonth(fechaInicio.getMonth() - 1);
   }

   try {
      let query = { timestamp: { $gte: fechaInicio } };
      if (branchId) query.branchId = branchId;

      const historial = await Telemetry.find(query)
         .sort({ timestamp: 1 })
         .select('timestamp readings -_id');
      res.json(historial);
   } catch (error) {
      console.error("Error al obtener historial:", error);
      res.status(500).send("Error al obtener el historial");
   }
});

const PORT = process.env.PORT || 3000;

// Endpoint POST: Guardar la suscripción del celular
app.post('/api/subscribe', async (req, res) => {
   const { subscription, branchId } = req.body;

   try {
      // Evitamos guardar suscripciones duplicadas del mismo celular
      const existingSub = await PushSubscription.findOne({ 'subscription.endpoint': subscription.endpoint });

      if (!existingSub) {
         const nuevaSuscripcion = new PushSubscription({ branchId, subscription });
         await nuevaSuscripcion.save();
         console.log('📱 Nuevo dispositivo suscrito a alertas');
      }
      res.status(201).json({ message: 'Suscripción exitosa' });
   } catch (error) {
      console.error("Error al guardar suscripción:", error);
      res.status(500).send("Error interno");
   }
});

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