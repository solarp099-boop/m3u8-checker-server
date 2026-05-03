const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.API_KEY || "123456";

// 🔥 MongoDB
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let collection;

// 🔌 conectar
async function conectarDB() {
  try {
    await client.connect();
    const db = client.db("streamsDB");
    collection = db.collection("streams");
    console.log("✅ Conectado a MongoDB");
  } catch (e) {
    console.error("❌ Error MongoDB:", e);
  }
}

// 🔍 checker mejorado
let checking = false;

async function checkStreams() {

  if (checking || !collection) return;

  checking = true;

  console.log("Revisando streams...");

  try {
    const streams = await collection.find().toArray();

    await Promise.all(
      streams.map(async (stream) => {

        let status = "offline";

        try {
          // intento HEAD
          await axios.head(stream.url, {
            timeout: 5000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          status = "online";

        } catch {

          try {
            // fallback GET
            const res = await axios.get(stream.url, {
              timeout: 8000,
              headers: { "User-Agent": "Mozilla/5.0" },
              validateStatus: () => true
            });

            if (res.status === 200) {
              status = "online";
            }

          } catch {
            status = "offline";
          }
        }

        await collection.updateOne(
          { _id: stream._id },
          { $set: { status } }
        );

      })
    );

  } catch (e) {
    console.error("Error en checker:", e);
  }

  console.log("Revisión terminada");

  checking = false;
}

// 🚀 iniciar
(async () => {
  await conectarDB();
  setInterval(checkStreams, 15000);
})();

// 🔐 seguridad
function verificarClave(req, res, next) {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  next();
}

// 🌐 API
app.get("/streams", verificarClave, async (req, res) => {
  const streams = await collection.find().toArray();
  res.json(streams);
});

// ➕ agregar
app.post("/add", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { name, url, category } = req.body;

  await collection.insertOne({
    name,
    url,
    category: category || "Otros",
    status: "unknown"
  });

  res.redirect(`/admin?key=${API_KEY}`);
});

// 🔥 bulk
app.post("/bulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { data } = req.body;

  let currentCategory = "Otros";
  const lines = data.split("\n");

  for (let line of lines) {
    line = line.trim();

    if (line.startsWith("//")) {
      currentCategory = line.replace("//", "").trim();
      continue;
    }

    const parts = line.split("|");

    if (parts.length === 2) {
      await collection.insertOne({
        name: parts[0].trim(),
        url: parts[1].trim(),
        category: currentCategory,
        status: "unknown"
      });
    }
  }

  res.redirect(`/admin?key=${API_KEY}`);
});

// ❌ eliminar
app.get("/delete/:id", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  await collection.deleteOne({ _id: new ObjectId(req.params.id) });

  res.redirect(`/admin?key=${API_KEY}`);
});

// ❌ borrar todo
app.get("/deleteAll", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  await collection.deleteMany({});

  res.redirect(`/admin?key=${API_KEY}`);
});

// 🔐 PANEL CON PAUSA
app.get("/admin", async (req, res) => {

  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const streams = await collection.find().toArray();

  const grouped = {};
  streams.forEach(s => {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  });

  let html = `
  <html>
  <head>
    <title>Panel</title>

    <script>
      let autoRefresh = true;

      function toggleRefresh() {
        autoRefresh = !autoRefresh;
        document.getElementById("btnRefresh").innerText =
          autoRefresh ? "⏸ Pausar" : "▶ Reanudar";
      }

      setInterval(() => {
        if (autoRefresh) location.reload();
      }, 10000);
    </script>

    <style>
      body { font-family: Arial; }
      .cat { margin-top:20px; }
      button { padding:8px; }
    </style>
  </head>
  <body>

  <h2>Panel de Canales</h2>

  <button id="btnRefresh" onclick="toggleRefresh()">⏸ Pausar</button>

  <a href="/deleteAll?key=${API_KEY}">
    <button style="background:red;color:white;">🗑 Borrar todo</button>
  </a>

  <hr/>

  <form method="POST" action="/add?key=${API_KEY}">
    <input name="name" placeholder="Nombre">
    <input name="url" placeholder="URL">
    <input name="category" placeholder="Categoría">
    <button>Agregar</button>
  </form>

  <hr/>

  <h3>Agregar masivo</h3>
  <form method="POST" action="/bulk?key=${API_KEY}">
    <textarea name="data" rows="10" cols="50"></textarea><br/>
    <button>Agregar todo</button>
  </form>

  <hr/>
  `;

  for (let cat in grouped) {

    html += `<div class="cat"><h3>📂 ${cat}</h3><ul>`;

    grouped[cat].forEach(s => {
      html += `
        <li>
          ${s.status === "online" ? "🟢" : "🔴"}
          ${s.name}
          <a href="/delete/${s._id}?key=${API_KEY}">❌</a>
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