const fs = require("fs");
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 TU CLAVE PRIVADA (cámbiala por la que quieras)
const API_KEY = process.env.API_KEY || "123456";

// 📺 Cargar streams desde archivo
let streams = JSON.parse(fs.readFileSync("streams.json"));

// 🔍 Función que revisa enlaces
async function checkStreams() {
  console.log("Revisando streams...");

  for (let stream of streams) {
    try {
      const response = await axios.get(stream.url, {
        timeout: 5000
      });

      if (response.status === 200) {
        stream.status = "online";
      } else {
        stream.status = "offline";
      }

    } catch (error) {
      stream.status = "offline";
    }
  }

  // 💾 Guardar cambios
  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  console.log("Revisión terminada");
}

// ⏱ Revisar cada 5 minutos
setInterval(checkStreams, 300000);
checkStreams();

// 🔐 Middleware de seguridad
function verificarClave(req, res, next) {
  const key = req.query.key;

  if (key !== API_KEY) {
    return res.status(403).json({ error: "No autorizado" });
  }

  next();
}

// 🌐 API protegida
app.get("/streams", verificarClave, (req, res) => {
  res.json(streams);
});

// ➕ Agregar nuevo stream (también protegido)
app.post("/add", verificarClave, (req, res) => {
  const { name, url } = req.body;

  const newStream = { name, url, status: "unknown" };
  streams.push(newStream);

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.json({ message: "Agregado" });
});

// 🚀 Iniciar servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});