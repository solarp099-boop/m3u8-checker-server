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

// 🔍 checker
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
          await axios.head(stream.url, {
            timeout: 5000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          status = "online";

        } catch {

          try {
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

// 🔥 NUEVA RUTA PARA ACTUALIZAR URL
app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { id, url } = req.body;

  await collection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { url: url } }
  );

  res.json({ ok: true });
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

// 🔥 PANEL ADMIN MEJORADO
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
    <title>Panel IPTV</title>

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

      function buscar() {
        let input = document.getElementById("buscador").value.toLowerCase();
        let filas = document.querySelectorAll(".fila");

        filas.forEach(f => {
          let nombre = f.getAttribute("data-name").toLowerCase();
          f.style.display = nombre.includes(input) ? "" : "none";
        });
      }

      function filtrarOffline() {
        let filas = document.querySelectorAll(".fila");

        filas.forEach(f => {
          let estado = f.getAttribute("data-status");
          f.style.display = estado === "offline" ? "" : "none";
        });
      }

      function mostrarTodos() {
        document.querySelectorAll(".fila").forEach(f => f.style.display = "");
      }

      async function guardar(id) {
        const url = document.getElementById("url-" + id).value;

        await fetch("/update?key=${API_KEY}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id, url: url })
        });

        alert("Guardado");
      }
    </script>

    <style>
      body { font-family: Arial; background:#111; color:white; }
      table { width:100%; border-collapse: collapse; }
      td, th { padding:10px; border-bottom:1px solid #333; }
      input { width:100%; padding:5px; }
      button { padding:6px 10px; cursor:pointer; margin:2px; }
    </style>
  </head>

  <body>

  <h2>Panel IPTV</h2>

  <button id="btnRefresh" onclick="toggleRefresh()">⏸ Pausar</button>
  <button onclick="filtrarOffline()">🔴 Solo caídos</button>
  <button onclick="mostrarTodos()">🟢 Mostrar todos</button>

  <br/><br/>

  🔍 Buscar:
  <input id="buscador" onkeyup="buscar()" placeholder="Nombre canal">

  <hr/>

  <h3>➕ Agregar canal rápido</h3>
  <form method="POST" action="/add?key=${API_KEY}">
    <input name="name" placeholder="Nombre">
    <input name="url" placeholder="URL">
    <input name="category" placeholder="Categoría">
    <button>Agregar</button>
  </form>

  <hr/>
  `;

  for (let cat in grouped) {

    html += `<h3>📂 ${cat}</h3><table>`;

    grouped[cat].forEach(s => {

      html += `
      <tr class="fila" data-name="${s.name}" data-status="${s.status}">
        <td>${s.status === "online" ? "🟢" : "🔴"}</td>
        <td>${s.name}</td>
        <td>
          <input id="url-${s._id}" value="${s.url}" />
        </td>
        <td>
          <button onclick="guardar('${s._id}')">Guardar</button>
        </td>
      </tr>
      `;
    });

    html += "</table>";
  }

  html += "</body></html>";

  res.send(html);
});
// 🚀 puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor listo"));