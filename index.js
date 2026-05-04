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
  } catch (e) { console.error("❌ Error MongoDB:", e); }
}

// Checker de estado
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
      } catch { status = "offline"; }
      await collection.updateOne({ _id: stream._id }, { $set: { status } });
    }));
  } catch (e) { console.error("Error en checker:", e); }
  checking = false;
}

(async () => {
  await conectarDB();
  setInterval(checkStreams, 60000);
})();

// APIs de Control
app.get("/streams", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find().sort({ name: 1 }).toArray(); 
  res.json(streams);
});

// Borrado masivo por filtro
app.post("/deleteAll", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { filterType, filterValue } = req.body;
  
  let query = {};
  if (filterType === "category") query = { category: filterValue };
  if (filterType === "main") query = { category: "Nacionales" };
  // Si filterType es 'all', query se queda vacío {} y borra todo.

  await collection.deleteMany(query);
  res.json({ ok: true });
});

// Carga masiva de canales
app.post("/addBulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  const lines = list.split("\n");
  const toInsert = [];

  lines.forEach((line, index) => {
    const parts = line.split(",");
    if (parts.length >= 2) {
      toInsert.push({
        name: parts[0].trim(),
        url: parts[1].trim(),
        category: category || "Otros",
        status: "unknown",
        createdAt: new Date(Date.now() + index) // Garantiza orden de inserción
      });
    }
  });

  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
});

// PANEL ADMINISTRATIVO
app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  const streams = await collection.find().sort({ name: 1 }).toArray();
  const categoriasUnicas = [...new Set(streams.map(s => s.category))];

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>IPTV Manager Ultimate</title>
    <style>
      :root { --bg: #0f0f0f; --card: #1a1a1a; --primary: #3d5afe; --danger: #ff1744; --success: #28a745; --text: #ffffff; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
      .nav-menu { display: flex; gap: 10px; }
      .nav-btn { background: #333; border: none; color: white; padding: 10px 18px; cursor: pointer; border-radius: 8px; }
      .nav-btn.active { background: var(--primary); }
      .view-container { display: none; background: var(--card); padding: 20px; border-radius: 12px; }
      .view-container.active { display: block; }
      .bulk-section { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
      textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; border-radius: 4px; }
      .btn-danger-all { background: var(--danger); color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 12px; border-bottom: 1px solid #2a2a2a; }
      .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 8px; }
    </style>
  </head>
  <body>

    <div class="header">
      <h2>📺 IPTV Manager</h2>
      <div class="nav-menu">
        <button class="nav-btn active" onclick="showView('all', this)">Todas las Señales</button>
        <button class="nav-btn" onclick="showView('categories', this)">Por Categoría</button>
        <button class="nav-btn" onclick="showView('main', this)">Pantalla Principal</button>
      </div>
    </div>

    <!-- CARGA MASIVA -->
    <div class="bulk-section">
      <h4 style="margin-top:0">➕ Carga Masiva (Formato: Nombre, URL)</h4>
      <form method="POST" action="/addBulk?key=${API_KEY}">
        <textarea name="list" rows="3" placeholder="Willax, http://...&#10;Latina, http://..."></textarea>
        <div style="margin-top:10px; display:flex; gap:10px;">
          <input name="category" id="bulkCat" placeholder="Categoría para este grupo" style="background:#000; color:white; border:1px solid #444; padding:5px; flex:1">
          <button class="nav-btn" style="background:var(--success)">Agregar Lista</button>
        </div>
      </form>
    </div>

    <!-- TODAS LAS SEÑALES -->
    <div id="view-all" class="view-container active">
      <button class="btn-danger-all" onclick="borrarMasivo('all')">🗑 Borrar TODO el Servidor</button>
      <table id="table-all">${streams.map(s => renderRow(s)).join('')}</table>
    </div>

    <!-- POR CATEGORÍA -->
    <div id="view-categories" class="view-container">
       <div id="cat-btns" style="margin-bottom:15px; display:flex; gap:5px; flex-wrap:wrap;">
         ${categoriasUnicas.map(cat => `<button class="nav-btn" style="font-size:11px" onclick="filterCat('${cat}')">${cat}</button>`).join('')}
       </div>
       <div id="cat-actions" style="display:none">
          <button class="btn-danger-all" id="btnDelCat" onclick="">🗑 Borrar esta Categoría</button>
          <table id="cat-table-body"></table>
       </div>
    </div>

    <!-- PANTALLA PRINCIPAL -->
    <div id="view-main" class="view-container">
       <button class="btn-danger-all" onclick="borrarMasivo('main')">🗑 Limpiar Pantalla Principal</button>
       <table>${streams.filter(s => s.category.toLowerCase() === "nacionales").map(s => renderRow(s)).join('')}</table>
    </div>

    <script>
      function showView(view, btn) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('view-' + view).classList.add('active');
        btn.classList.add('active');
      }

      function filterCat(cat) {
        document.getElementById('cat-actions').style.display = 'block';
        document.getElementById('btnDelCat').onclick = () => borrarMasivo('category', cat);
        document.getElementById('btnDelCat').innerText = '🗑 Borrar Categoría: ' + cat;
        document.getElementById('bulkCat').value = cat;

        const data = ${JSON.stringify(streams)};
        const filtered = data.filter(s => s.category === cat);
        document.getElementById('cat-table-body').innerHTML = filtered.map(s => \`
          <tr>
            <td>\${s.status === 'online' ? '🟢' : '🔴'}</td>
            <td width="200"><b>\${s.name}</b></td>
            <td><input class="input-url" value="\${s.url}"></td>
          </tr>\`).join('');
      }

      async function borrarMasivo(type, value = '') {
        const msg = value ? \`¿Estás seguro de borrar TODO en "\${value}"?\` : "¿Estás seguro de borrar TODO?";
        if (!confirm(msg)) return;
        
        await fetch("/deleteAll?key=${API_KEY}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filterType: type, filterValue: value })
        });
        location.reload();
      }

      // Funciones de guardar y eliminar (se mantienen igual que antes)
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

function renderRow(s) {
  return `<tr><td>${s.status === 'online' ? '🟢' : '🔴'}</td><td><b>${s.name}</b></td><td><input class="input-url" value="${s.url}"></td></tr>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Panel con Carga Masiva y Borrado Listo"));