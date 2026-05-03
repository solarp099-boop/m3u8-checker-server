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
      button { padding:5px 10px; cursor:pointer; }
    </style>
  </head>

  <body>

  <h2>Panel IPTV</h2>
  <hr/>
  `;

  for (let cat in grouped) {

    html += `<h3>📂 ${cat}</h3><table>`;

    grouped[cat].forEach(s => {
      html += `
      <tr>
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