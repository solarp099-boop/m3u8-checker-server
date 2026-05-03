const fs = require("fs");
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔐 CLAVE
const API_KEY = process.env.API_KEY || "123456";

// 📺 Cargar streams
let streams = JSON.parse(fs.readFileSync("streams.json"));

// 🔍 Checker
async function checkStreams() {
  console.log("Revisando streams...");

  for (let stream of streams) {
    try {
      const response = await axios.get(stream.url, { timeout: 5000 });

      stream.status = response.status === 200 ? "online" : "offline";

    } catch (error) {
      stream.status = "offline";
    }
  }

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));
  console.log("Revisión terminada");
}

setInterval(checkStreams, 300000);
checkStreams();

// 🔐 Middleware
function verificarClave(req, res, next) {
  const key = req.query.key;
  if (key !== API_KEY) return res.status(403).send("No autorizado");
  next();
}

// 🌐 API
app.get("/streams", verificarClave, (req, res) => {
  res.json(streams);
});

// ➕ Agregar
app.post("/add", async (req, res) => {

  const key = req.query.key;
  if (key !== API_KEY) return res.send("No autorizado");

  const { name, url } = req.body;

  let status = "offline";

  try {
    const response = await axios.get(url, { timeout: 5000 });
    if (response.status === 200) status = "online";
  } catch (e) {
    status = "offline";
  }

  streams.push({ name, url, status });

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// ❌ Eliminar
app.get("/delete/:id", (req, res) => {
  const key = req.query.key;
  if (key !== API_KEY) return res.send("No autorizado");

  const id = parseInt(req.params.id);
  streams.splice(id, 1);

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// 🔐 PANEL WEB
app.get("/admin", (req, res) => {
  const key = req.query.key;
  if (key !== API_KEY) return res.send("No autorizado");

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

// 🚀 IMPORTANTE (ARREGLADO)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});