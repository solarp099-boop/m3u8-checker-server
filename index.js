const fs = require("fs");
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get("/delete/:id", (req, res) => {

  const key = req.query.key;
  if (key !== API_KEY) return res.send("No autorizado");

  const id = parseInt(req.params.id);

  streams.splice(id, 1);

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// ➕ Agregar nuevo stream (también protegido)
app.post("/add", (req, res) => {

  const key = req.query.key;
  if (key !== API_KEY) return res.send("No autorizado");

  const { name, url } = req.body;

  streams.push({ name, url, status: "unknown" });

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// 🚀 Iniciar servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});

// 🔐 PANEL WEB
app.get("/admin", (req, res) => {

  const key = req.query.key;

  if (key !== API_KEY) {
    return res.send("No autorizado");
  }

  let html = `
    <h2>Panel de Canales</h2>

    <form method="POST" action="/add?key=${API_KEY}">
      <input name="name" placeholder="Nombre canal" required />
      <input name="url" placeholder="URL m3u8" required />
      <button type="submit">Agregar</button>
    </form>

    <hr/>

    <ul>
  `;

  streams.forEach((s, i) => {
    html += `
      <li>
        ${s.name} - ${s.status}
        <a href="/delete/${i}?key=${API_KEY}">❌ eliminar</a>
      </li>
    `;
  });

  html += "</ul>";

  res.send(html);
});