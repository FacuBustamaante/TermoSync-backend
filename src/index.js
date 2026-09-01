import express from  'express';
import cors from 'cors';
const app = express();
app.use(express.json());
app.use(cors());

let datosSensor = { temperatura: null, humedad: null, timestamp: null };

// Endpoint para que la ESP32 envíe los datos (POST)
app.post('/api/sensor', (req, res) => {
    const { temperatura, humedad } = req.body;
    
    if (temperatura !== undefined && humedad !== undefined) {
        datosSensor = { temperatura, humedad, timestamp: new Date() };
        console.log("Datos actualizados:", datosSensor);
        res.status(200).send("Datos recibidos correctamente");
    } else {
        res.status(400).send("Faltan datos de temperatura o humedad");
    }
});

// Endpoint para que tu App consulte los datos (GET)
app.get('/api/sensor', (req, res) => {
    res.json(datosSensor);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});