const express = require("express");
const fs = require("fs")
const FILE = "./channels.json"
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

// ❌ ELIMINAR CANAL (MONGODB)
app.post("/deleteStream", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  const { id } = req.body;

  await collection.deleteOne({
    _id: new ObjectId(id)
  });

  res.json({ ok: true });
});

// ➕ agregar
app.post("/add", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");

  let { name, url, category, sections } = req.body;

  // 🔥 IMPORTANTE: asegurar que sea array
  if (!sections) {
    sections = ["main", "all"];
  } else if (!Array.isArray(sections)) {
    sections = [sections];
  }

  await collection.insertOne({
    name,
    url,
    category: category || "Otros",
    sections,
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

  // 🔥 OBTENER CANALES
app.get('/channels', (req, res) => {
    const data = JSON.parse(fs.readFileSync(FILE))
    res.json(data)
})

// 🔥 AGREGAR CANAL
app.post('/add', (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"))

  data.push(req.body)

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))

  res.json({ ok: true })
})

// 🔥 ELIMINAR CANAL
app.post('/delete', (req, res) => {
  let data = JSON.parse(fs.readFileSync(FILE, "utf8"))

  data = data.filter(c => c.name !== req.body.name)

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2))

  res.json({ ok: true })
})

// 🔥 AGREGAR CANAL
app.post('/add', (req, res) => {
    const data = JSON.parse(fs.readFileSync(FILE))
    data.push(req.body)
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
    res.json({ ok: true })
})

// 🔥 ELIMINAR CANAL
app.post('/delete', (req, res) => {
    let data = JSON.parse(fs.readFileSync(FILE))
    data = data.filter(c => c.name !== req.body.name)
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
    res.json({ ok: true })
})

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
          
      function obtenerSecciones() {
        const checks = document.querySelectorAll("input[type=checkbox]:checked");
        return Array.from(checks).map(c => c.value);
      }

      // 🔥 SOLO AGREGO ESTA FUNCIÓN dentro de <script>
function filtrarSeccion(seccion) {
  const filas = document.querySelectorAll(".fila");

  filas.forEach(f => {
    let sections = f.getAttribute("data-sections");

    try {
      sections = JSON.parse(sections);
    } catch {
      sections = [];
    }

    if (seccion === "todos") {
      f.style.display = "";
    } else if (sections.includes(seccion)) {
      f.style.display = "";
    } else {
      f.style.display = "none";
    }
  });
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

      async function eliminar(id) {
        if (!confirm("Eliminar canal?")) return;

        await fetch("/deleteStream?key=${API_KEY}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id })
        });
        location.reload();
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

  <div style="margin-bottom:20px;">
  <button onclick="filtrarSeccion('main')">📺 MainActivity</button>
  <button onclick="filtrarSeccion('all')">📋 Todas</button>
  <button onclick="filtrarSeccion('categoria')">🗂 Categorías</button>
  <button onclick="filtrarSeccion('todos')">🌐 Ver todo</button>
</div>

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

  <br><br>

  <!-- 🔥 IMPORTANTE: name="sections" -->
  <label><input type="checkbox" name="sections" value="main" checked> Main</label>
  <label><input type="checkbox" name="sections" value="all" checked> Todos</label>
  <label><input type="checkbox" name="sections" value="categoria"> Categoría</label>

  <br><br>

  <button>Agregar</button>
</form>

<hr/>

  `;

  for (let cat in grouped) {

    html += `<h3>📂 ${cat}</h3><table>`;

    grouped[cat].forEach(s => {

      html += `
      <tr class="fila" data-name="${s.name}" data-status="${s.status}" data-sections='${JSON.stringify(s.sections || [])}'>
        <td>${s.status === "online" ? "🟢" : "🔴"}</td>
        <td>${s.name}</td>
        <td>
          <input id="url-${s._id}" value="${s.url}" />
        </td>
        <td>
          <button onclick="guardar('${s._id}')">Guardar</button>
          <button onclick="eliminar('${s._id}')">❌</button>
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