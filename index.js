const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const API_KEY = process.env.API_KEY || "123456";
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

// Checker de estado (online/offline)
let checking = false;
async function checkStreams() {
  if (checking || !collection) return;
  checking = true;
  try {
    const streams = await collection.find().toArray();
    await Promise.all(streams.map(async (stream) => {
      let status = "offline";
      try {
        await axios.head(stream.url, { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0" } });
        status = "online";
      } catch {
        try {
          const res = await axios.get(stream.url, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" }, validateStatus: () => true });
          if (res.status === 200) status = "online";
        } catch { status = "offline"; }
      }
      await collection.updateOne({ _id: stream._id }, { $set: { status } });
    }));
  } catch (e) { console.error("Error en checker:", e); }
  checking = false;
}

(async () => {
  await conectarDB();
  setInterval(checkStreams, 60000);
})();

// API para la App Android
app.get("/streams", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find().toArray();
  res.json(streams);
});

app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id, url } = req.body;
  await collection.updateOne({ _id: new ObjectId(id) }, { $set: { url: url } });
  res.json({ ok: true });
});

app.post("/deleteStream", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id } = req.body;
  await collection.deleteOne({ _id: new ObjectId(id) });
  res.json({ ok: true });
});

app.post("/add", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { name, url, category } = req.body;
  await collection.insertOne({
    name,
    url,
    category: category || "Otros",
    status: "unknown"
  });
  res.redirect(`/admin?key=${API_KEY}`);
});

// PANEL ADMINISTRATIVO MEJORADO
app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  const streams = await collection.find().toArray();
  
  // Agrupar categorías para los botones dinámicos
  const categoriasUnicas = [...new Set(streams.map(s => s.category))];

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Gestión IPTV</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root { --bg: #0f0f0f; --card: #1a1a1a; --primary: #3d5afe; --danger: #ff1744; --text: #ffffff; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
      .header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; border-bottom: 1px solid #333; padding-bottom: 20px; }
      .nav-menu { display: flex; gap: 10px; margin-bottom: 20px; }
      .nav-btn { background: #333; border: none; color: white; padding: 12px 20px; cursor: pointer; border-radius: 8px; font-weight: bold; transition: 0.3s; }
      .nav-btn:hover { background: #444; }
      .nav-btn.active { background: var(--primary); }
      
      .view-container { display: none; background: var(--card); padding: 20px; border-radius: 12px; }
      .view-container.active { display: block; }
      
      .cat-selector { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
      .btn-cat { background: transparent; border: 1px solid var(--primary); color: var(--primary); padding: 5px 12px; border-radius: 20px; cursor: pointer; }
      .btn-cat:hover { background: var(--primary); color: white; }

      .form-add { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; }
      .form-add input { background: #000; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; flex: 1; min-width: 150px; }
      .btn-add { background: #28a745; color: white; border: none; padding: 8px 20px; border-radius: 4px; cursor: pointer; }

      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th { text-align: left; color: #888; font-size: 12px; text-transform: uppercase; padding: 10px; }
      td { padding: 12px 10px; border-bottom: 1px solid #2a2a2a; }
      .status { font-size: 10px; }
      .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #aaa; padding: 6px; border-radius: 4px; }
      .btn-action { background: #333; border: none; color: white; padding: 6px; border-radius: 4px; cursor: pointer; }
      .btn-del { background: var(--danger); }
    </style>
  </head>
  <body>

    <div class="header">
      <h2 style="margin:0;">📺 IPTV Manager</h2>
      <div class="nav-menu">
        <button class="nav-btn" onclick="showView('all', this)">Todas las Señales</button>
        <button class="nav-btn" onclick="showView('categories', this)">Por Categoría</button>
        <button class="nav-btn" onclick="showView('main', this)">Pantalla Principal</button>
      </div>
    </div>

    <div class="form-add">
      <form method="POST" action="/add?key=${API_KEY}" style="display:flex; gap:10px; width:100%;">
        <input name="name" placeholder="Nombre del Canal" required>
        <input name="url" placeholder="URL .m3u8" required>
        <input name="category" placeholder="Categoría (Nacionales, Cine...)" required>
        <button class="btn-add">➕ Agregar</button>
      </form>
    </div>

    <!-- VISTA: TODAS LAS SEÑALES -->
    <div id="view-all" class="view-container">
      <h3>Lista Completa</h3>
      <table>
        <thead><tr><th>Estado</th><th>Nombre</th><th>URL</th><th>Acciones</th></tr></thead>
        <tbody>
          ${streams.map(s => renderRow(s)).join('')}
        </tbody>
      </table>
    </div>

    <!-- VISTA: POR CATEGORÍA -->
    <div id="view-categories" class="view-container">
      <h3>Filtrar por Categoría</h3>
      <div class="cat-selector">
        ${categoriasUnicas.map(cat => `<button class="btn-cat" onclick="filterByCat('${cat}')">${cat}</button>`).join('')}
      </div>
      <table id="table-categories">
        <thead><tr><th>Estado</th><th>Nombre</th><th>URL</th><th>Acciones</th></tr></thead>
        <tbody id="body-categories"></tbody>
      </table>
    </div>

    <!-- VISTA: PANTALLA PRINCIPAL (MainActivity) -->
    <div id="view-main" class="view-container">
      <h3>Canales en Pantalla Principal</h3>
      <p style="color:#888; font-size:13px;">Se muestran los canales cargados en la sección principal de la App.</p>
      <table>
        <thead><tr><th>Estado</th><th>Nombre</th><th>URL</th><th>Acciones</th></tr></thead>
        <tbody>
          ${streams.filter(s => s.category.toLowerCase() === "nacionales").map(s => renderRow(s)).join('')}
        </tbody>
      </table>
    </div>

    <script>
      function showView(viewName, btn) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('view-' + viewName).classList.add('active');
        btn.classList.add('active');
      }

      function filterByCat(cat) {
        const rows = ${JSON.stringify(streams)};
        const filtered = rows.filter(s => s.category === cat);
        const tbody = document.getElementById('body-categories');
        tbody.innerHTML = filtered.map(s => \`
          <tr class="fila">
            <td>\${s.status === 'online' ? '🟢' : '🔴'}</td>
            <td><b>\${s.name}</b><br><small style="color:#666">\${s.category}</small></td>
            <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
            <td>
              <button class="btn-action" onclick="guardar('\${s._id}')">💾</button>
              <button class="btn-action btn-del" onclick="eliminar('\${s._id}')">❌</button>
            </td>
          </tr>
        \`).join('');
      }

      async function eliminar(id) {
        if (!confirm("¿Eliminar canal?")) return;
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
        alert("Guardado correctamente");
      }
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

function renderRow(s) {
  return `
    <tr class="fila">
      <td>${s.status === 'online' ? '🟢' : '🔴'}</td>
      <td><b>${s.name}</b><br><small style="color:#666">${s.category}</small></td>
      <td><input class="input-url" id="url-${s._id}" value="${s.url}"></td>
      <td>
        <button class="btn-action" onclick="guardar('${s._id}')">💾</button>
        <button class="btn-action btn-del" onclick="eliminar('${s._id}')">❌</button>
      </td>
    </tr>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Panel Pro listo"));