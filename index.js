const express = require("express");
const fs = require("fs");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.API_KEY || "123456";
const FILE = "./channels.json";

// 🔥 MongoDB
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let collection;

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

  try {
    const streams = await collection.find().toArray();

    await Promise.all(
      streams.map(async (stream) => {
        let status = "offline";

        try {
          await axios.head(stream.url, { timeout: 5000 });
          status = "online";
        } catch {
          status = "offline";
        }

        await collection.updateOne(
          { _id: stream._id },
          { $set: { status } }
        );
      })
    );

  } catch (e) {
    console.error(e);
  }

  checking = false;
}

(async () => {
  await conectarDB();
  setInterval(checkStreams, 15000);
})();

// 🔐 seguridad
function verificarClave(req, res, next) {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  next();
}

// 🔥 STREAMS ORIGINAL (NO TOCADO)
app.get("/streams", verificarClave, async (req, res) => {
  const streams = await collection.find().toArray();
  res.json(streams);
});

// 🔥 ACTUALIZAR URL (NO TOCADO)
app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { id, url } = req.body;

  await collection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { url: url } }
  );

  res.json({ ok: true });
});


// ======================================================
// 🔥 NUEVO SISTEMA JSON (DINÁMICO PARA APP)
// ======================================================

// ✅ OBTENER CANALES
app.get("/channels", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    res.json(data);
  } catch {
    res.json([]);
  }
});

// ➕ AGREGAR CANAL
app.post("/channels/add", (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

  data.push(req.body);

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));

  res.json({ ok: true });
});

// ❌ ELIMINAR CANAL
app.post("/channels/delete", (req, res) => {
  let data = JSON.parse(fs.readFileSync(FILE, "utf8"));

  data = data.filter(c => c.name !== req.body.name);

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));

  res.json({ ok: true });
});


// ======================================================
// 🔥 PANEL ADMIN
// ======================================================

app.get("/admin", async (req, res) => {

  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const streams = await collection.find().toArray();

  let html = `
  <html>
  <head>
    <title>Panel IPTV</title>

    <script>
      async function eliminar(nombre) {
        await fetch('/channels/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nombre })
        });

        location.reload();
      }

      async function agregar() {
        const name = document.getElementById("name").value;
        const url = document.getElementById("url").value;
        const logo = document.getElementById("logo").value;
        const category = document.getElementById("category").value;

        await fetch('/channels/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, url, logo, category })
        });

        location.reload();
      }
    </script>

    <style>
      body { background:#111; color:white; font-family:Arial }
      input { margin:5px; padding:5px }
      button { padding:5px }
    </style>
  </head>

  <body>

  <h2>Panel IPTV</h2>

  <h3>Agregar canal</h3>
  <input id="name" placeholder="Nombre">
  <input id="url" placeholder="URL">
  <input id="logo" placeholder="Logo">
  <input id="category" placeholder="Categoría">
  <button onclick="agregar()">Agregar</button>

  <hr/>

  <h3>Canales JSON</h3>
  `;

  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

  data.forEach(c => {
    html += `
      <div>
        ${c.name} 
        <button onclick="eliminar('${c.name}')">❌</button>
      </div>
    `;
  });

  html += "</body></html>";

  res.send(html);
});


// 🚀 puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor listo"));