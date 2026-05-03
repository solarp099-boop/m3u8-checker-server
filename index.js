const fs = require("fs");
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.API_KEY || "123456";

let streams = JSON.parse(fs.readFileSync("streams.json"));

let checking = false;

// 🔍 checker
async function checkStreams() {

  if (checking) return;
  checking = true;

  for (let stream of streams) {
    try {
      const res = await axios.get(stream.url, { timeout: 3000 });
      stream.status = res.status === 200 ? "online" : "offline";
    } catch {
      stream.status = "offline";
    }
  }

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));
  checking = false;
}

setInterval(checkStreams, 15000);
checkStreams();

// 🔐 seguridad
function verificarClave(req, res, next) {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  next();
}

// 🌐 API
app.get("/streams", verificarClave, (req, res) => {
  res.json(streams);
});

// ➕ AGREGAR UNO
app.post("/add", async (req, res) => {

  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { name, url, category } = req.body;

  streams.push({ name, url, category, status: "unknown" });

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// 🔥 BULK CON CATEGORÍAS
app.post("/bulk", (req, res) => {

  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { data } = req.body;

  let currentCategory = "Otros";

  const lines = data.split("\n");

  lines.forEach(line => {

    line = line.trim();

    // detectar categoría
    if (line.startsWith("//")) {
      currentCategory = line.replace("//", "").trim();
      return;
    }

    const parts = line.split("|");

    if (parts.length === 2) {
      streams.push({
        name: parts[0].trim(),
        url: parts[1].trim(),
        category: currentCategory,
        status: "unknown"
      });
    }
  });

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// ❌ eliminar
app.get("/delete/:id", (req, res) => {

  if (req.query.key !== API_KEY) return res.send("No autorizado");

  streams.splice(parseInt(req.params.id), 1);

  fs.writeFileSync("streams.json", JSON.stringify(streams, null, 2));

  res.redirect(`/admin?key=${API_KEY}`);
});

// 🔐 PANEL
app.get("/admin", (req, res) => {

  if (req.query.key !== API_KEY) return res.send("No autorizado");

  let html = `
  <html>
  <head>
    <title>Panel</title>
    <meta http-equiv="refresh" content="10">
    <style>
      body { font-family: Arial; }
      h2 { color: #333; }
      .cat { margin-top:20px; }
    </style>
  </head>
  <body>

  <h2>Panel de Canales</h2>

  <!-- agregar uno -->
  <form method="POST" action="/add?key=${API_KEY}">
    <input name="name" placeholder="Nombre">
    <input name="url" placeholder="URL">
    <input name="category" placeholder="Categoría">
    <button>Agregar</button>
  </form>

  <hr/>

  <!-- BULK -->
  <h3>Agregar masivo</h3>
  <form method="POST" action="/bulk?key=${API_KEY}">
    <textarea name="data" rows="12" cols="50" placeholder="//Categoria&#10;Nombre|URL"></textarea><br/>
    <button>Agregar todo</button>
  </form>

  <hr/>
  `;

  // agrupar por categoría
  const grouped = {};

  streams.forEach((s, i) => {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push({ ...s, index: i });
  });

  // mostrar por categoría
  for (let cat in grouped) {

    html += `<div class="cat"><h3>📂 ${cat}</h3><ul>`;

    grouped[cat].forEach(s => {
      html += `
        <li>
          ${s.status === "online" ? "🟢" : "🔴"}
          ${s.name}
          <a href="/delete/${s.index}?key=${API_KEY}">❌</a>
        </li>
      `;
    });

    html += "</ul></div>";
  }

  html += "</body></html>";

  res.send(html);
});

// 🚀 puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor listo"));