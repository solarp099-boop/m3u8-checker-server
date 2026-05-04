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

// 🔍 Checker de estado constante
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

// --- APIS DE CONTROL ---

// Modificado: Ahora devuelve los canales por orden de inserción (createdAt)
app.get("/streams", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find().sort({ createdAt: 1 }).toArray(); 
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

app.post("/deleteAll", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { filterType, filterValue } = req.body;
  let query = {};
  if (filterType === "category") query = { category: filterValue };
  if (filterType === "main") query = { category: "Nacionales" };
  
  await collection.deleteMany(query);
  res.json({ ok: true });
});

app.post("/add", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { name, url, category } = req.body;
  await collection.insertOne({ 
    name, 
    url, 
    category: category || "Otros", 
    status: "unknown",
    createdAt: new Date() 
  });
  res.redirect(`/admin?key=${API_KEY}`);
});

app.post("/addBulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  const lines = list.split("\n");
  const toInsert = [];
  const baseTime = Date.now();
  
  lines.forEach((line, index) => {
    const parts = line.split(",");
    if (parts.length >= 2) {
      toInsert.push({
        name: parts[0].trim(),
        url: parts[1].trim(),
        category: category || "Otros",
        status: "unknown",
        createdAt: new Date(baseTime + index) // Asegura orden exacto milisegundo a milisegundo
      });
    }
  });
  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
});

// --- PANEL ADMINISTRATIVO ---

app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  
  // Modificado: Quitamos el sort alfabético por nombre
  const streams = await collection.find().sort({ createdAt: 1 }).toArray();
  const categoriasFijas = ["Cine", "Radio", "Infantiles", "Entretenimiento", "Deportes", "Nacionales"];
  const categoriasDinamicas = [...new Set(streams.map(s => s.category))];
  const todasLasCategorias = [...new Set([...categoriasFijas, ...categoriasDinamicas])];

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>IPTV Manager - Orden Real</title>
    <style>
      :root { --bg: #0f0f0f; --card: #1a1a1a; --primary: #3d5afe; --danger: #ff1744; --success: #28a745; --text: #ffffff; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 15px; }
      .nav-menu { display: flex; gap: 10px; }
      .nav-btn { background: #333; border: none; color: white; padding: 10px 18px; cursor: pointer; border-radius: 8px; font-weight: bold; }
      .nav-btn.active { background: var(--primary); }
      .view-container { display: none; background: var(--card); padding: 20px; border-radius: 12px; }
      .view-container.active { display: block; }
      .bulk-section { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid var(--primary); }
      textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; border-radius: 4px; resize: vertical; }
      .btn-danger-all { background: var(--danger); color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 12px; border-bottom: 1px solid #2a2a2a; vertical-align: top; }
      .btn-play { background: #444; border: none; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer; }
      .btn-plus { background: var(--success); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 5px; }
      .insert-box { display: none; background: #222; padding: 10px; border-left: 4px solid var(--success); margin: 10px 0; border-radius: 4px; }
      .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 4px; }
      .cat-badge { font-size: 10px; background: #333; padding: 2px 6px; border-radius: 10px; color: #aaa; }
    </style>
  </head>
  <body>

    <div class="header">
      <div style="display:flex; align-items:center; gap:15px;">
        <h2 style="margin:0;">📺 IPTV Manager</h2>
        <button id="btnAutoRefresh" class="btn-play" onclick="toggleRefresh()">⏸ Pausar</button>
      </div>
      <div class="nav-menu">
        <button class="nav-btn active" onclick="showView('all', this)">Todas las Señales</button>
        <button class="nav-btn" onclick="showView('categories', this)">Por Categoría</button>
        <button class="nav-btn" onclick="showView('main', this)">Pantalla Principal</button>
      </div>
    </div>

    <div class="bulk-section">
      <h4 style="margin:0 0 10px 0;">➕ Carga Masiva (Respeta tu Orden)</h4>
      <form method="POST" action="/addBulk?key=${API_KEY}">
        <textarea name="list" rows="3" placeholder="Latina, http://...&#10;América, http://..."></textarea>
        <div style="margin-top:10px; display:flex; gap:10px;">
          <input name="category" id="bulkCatInput" placeholder="Categoría para este grupo" style="background:#000; color:white; border:1px solid #444; padding:8px; flex:1; border-radius:4px;">
          <button class="nav-btn" style="background:var(--success)">Agregar Lista</button>
        </div>
      </form>
    </div>

    <div id="view-all" class="view-container active">
      <button class="btn-danger-all" onclick="borrarMasivo('all')">🗑 Borrar TODO el Servidor</button>
      <table>${streams.map(s => renderRow(s)).join('')}</table>
    </div>

    <div id="view-categories" class="view-container">
       <div style="margin-bottom:15px; display:flex; gap:5px; flex-wrap:wrap;">
         ${todasLasCategorias.map(cat => `<button class="nav-btn" style="font-size:11px; padding:6px 12px;" onclick="filterCat('${cat}')">${cat}</button>`).join('')}
       </div>
       <div id="cat-actions" style="display:none">
          <button class="btn-danger-all" id="btnDelCat" onclick="">🗑 Limpiar Canales de esta Categoría</button>
          <table id="cat-table-body"></table>
       </div>
    </div>

    <div id="view-main" class="view-container">
       <button class="btn-danger-all" onclick="borrarMasivo('main')">🗑 Limpiar Canales Nacionales</button>
       <table>${streams.filter(s => s.category === "Nacionales").map(s => renderRow(s)).join('')}</table>
    </div>

    <script>
      let autoRefresh = true;
      function toggleRefresh() {
        autoRefresh = !autoRefresh;
        document.getElementById("btnAutoRefresh").innerText = autoRefresh ? "⏸ Pausar" : "▶ Reanudar";
      }
      setInterval(() => { if(autoRefresh) location.reload(); }, 30000);

      function showView(view, btn) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('view-' + view).classList.add('active');
        btn.classList.add('active');
        if(view === 'main') document.getElementById('bulkCatInput').value = 'Nacionales';
      }

      function showInsert(id) {
        const box = document.getElementById('insert-' + id);
        const isVisible = box.style.display === 'block';
        document.querySelectorAll('.insert-box').forEach(b => b.style.display = 'none');
        box.style.display = isVisible ? 'none' : 'block';
      }

      async function borrarMasivo(type, value = '') {
        if (!confirm("¿Borrar todos los canales de esta sección?")) return;
        await fetch("/deleteAll?key=${API_KEY}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filterType: type, filterValue: value })
        });
        location.reload();
      }

      function filterCat(cat) {
        document.getElementById('cat-actions').style.display = 'block';
        document.getElementById('btnDelCat').onclick = () => borrarMasivo('category', cat);
        document.getElementById('btnDelCat').innerText = '🗑 Limpiar Canales: ' + cat;
        document.getElementById('bulkCatInput').value = cat;

        const data = ${JSON.stringify(streams)};
        const filtered = data.filter(s => s.category === cat);
        document.getElementById('cat-table-body').innerHTML = filtered.length > 0 
          ? filtered.map(s => renderRowJS(s)).join('')
          : '<tr><td colspan="4" style="text-align:center; padding:20px; color:#666;">No hay canales en esta categoría</td></tr>';
      }

      function renderRowJS(s) {
        return \`
          <tr>
            <td width="30">\${s.status === 'online' ? '🟢' : '🔴'}</td>
            <td width="220">
              <b>\${s.name}</b><br/>
              <span class="cat-badge">\${s.category}</span><br/>
              <button class="btn-plus" onclick="showInsert('\${s._id}')">+</button>
              <div id="insert-\${s._id}" class="insert-box">
                 <form method="POST" action="/add?key=${API_KEY}">
                   <input name="name" placeholder="Nombre" style="width:70px; font-size:10px;" required>
                   <input name="url" placeholder="URL" style="width:100px; font-size:10px;" required>
                   <input type="hidden" name="category" value="\${s.category}">
                   <button style="font-size:10px;">Añadir</button>
                 </form>
              </div>
            </td>
            <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
            <td width="100">
              <button class="btn-play" onclick="guardar('\${s._id}')">💾</button>
              <button class="btn-play" style="background:var(--danger)" onclick="eliminar('\${s._id}')">❌</button>
            </td>
          </tr>\`;
      }

      async function guardar(id) {
        const url = document.getElementById("url-" + id).value;
        await fetch("/update?key=${API_KEY}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id, url: url })
        });
        alert("Actualizado");
      }

      async function eliminar(id) {
        if(!confirm("¿Eliminar este canal?")) return;
        await fetch("/deleteStream?key=${API_KEY}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id })
        });
        location.reload();
      }
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

function renderRow(s) {
  const API_KEY = process.env.API_KEY || "123456";
  return `
    <tr>
      <td width="30">${s.status === 'online' ? '🟢' : '🔴'}</td>
      <td width="220">
        <b>${s.name}</b><br/>
        <span class="cat-badge">${s.category}</span><br/>
        <button class="btn-plus" onclick="showInsert('${s._id}')">+</button>
        <div id="insert-${s._id}" class="insert-box">
           <form method="POST" action="/add?key=${API_KEY}">
             <input name="name" placeholder="Nombre" style="width:70px; font-size:10px;" required>
             <input name="url" placeholder="URL" style="width:100px; font-size:10px;" required>
             <input type="hidden" name="category" value="${s.category}">
             <button style="font-size:10px;">Añadir</button>
           </form>
        </div>
      </td>
      <td><input class="input-url" id="url-${s._id}" value="${s.url}"></td>
      <td width="100">
        <button class="btn-play" onclick="guardar('${s._id}')">💾</button>
        <button class="btn-play" style="background:var(--danger)" onclick="eliminar('${s._id}')">❌</button>
      </td>
    </tr>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Panel con Orden Fijo Activado"));