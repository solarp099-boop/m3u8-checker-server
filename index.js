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

const GITHUB_LOGOS_BASE = "https://raw.githubusercontent.com/solarp099-boop/logos-tv/main/";

function generateLogoUrl(name) {
  if (!name) return "";
  const cleanName = encodeURIComponent(name.trim());
  return `${GITHUB_LOGOS_BASE}${cleanName}.png`;
}

async function conectarDB() {
  try {
    await client.connect();
    const db = client.db("streamsDB");
    collection = db.collection("streams");
    console.log("✅ Conectado a MongoDB");
  } catch (e) { console.error("❌ Error MongoDB:", e); }
}

let checking = false;
async function checkStreams() {
  if (checking || !collection) return;
  checking = true;
  try {
    const streams = await collection.find().toArray();
    await Promise.all(streams.map(async (stream) => {
      let status = "offline";
      try {
        await axios.head(stream.url, { 
          timeout: 2500, 
          headers: { "User-Agent": "Mozilla/5.0" },
          validateStatus: (s) => s < 400 
        });
        status = "online";
      } catch {
        try {
          await axios.get(stream.url, { 
            timeout: 3000, 
            headers: { "User-Agent": "Mozilla/5.0" }, 
            validateStatus: (s) => s === 200 || s === 206 
          });
          status = "online";
        } catch { status = "offline"; }
      }
      if (stream.status !== status) {
        await collection.updateOne({ _id: stream._id }, { $set: { status } });
      }
    }));
  } catch (e) { console.error("Error en checker veloz:", e); }
  checking = false;
}

(async () => {
  await conectarDB();
  setInterval(checkStreams, 15000); 
})();

// --- ENDPOINTS ---

app.get("/streams/main", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find({ category: "Pantalla Principal" }).sort({ createdAt: 1 }).toArray(); 
  res.json(streams);
});

app.get("/streams/all", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find({ category: "Todas las Señales" }).sort({ createdAt: 1 }).toArray(); 
  res.json(streams);
});

app.get("/streams/category", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const cat = req.query.name;
  const streams = await collection.find({ category: cat }).sort({ createdAt: 1 }).toArray();
  res.json(streams);
});

// --- OPERACIONES CRUD ---

app.post("/insertAt", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { targetId, name, url, category } = req.body;
  
  const targetStream = await collection.findOne({ _id: new ObjectId(targetId) });
  if (!targetStream) return res.status(404).send("Referencia no encontrada");

  // Insertamos con un tiempo ligeramente menor para que aparezca arriba al ordenar
  const newTime = new Date(new Date(targetStream.createdAt).getTime() - 1);

  await collection.insertOne({
    name,
    url,
    logo: generateLogoUrl(name),
    category: targetStream.category,
    status: "pending",
    createdAt: newTime
  });
  res.json({ ok: true });
});

app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id, url, name } = req.body;
  const updateData = { url: url, status: "pending" }; 
  if (name) {
    updateData.name = name;
    updateData.logo = generateLogoUrl(name);
  }
  await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
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
  if (filterType === "main") query = { category: "Pantalla Principal" };
  if (filterType === "all") query = { category: "Todas las Señales" };
  await collection.deleteMany(query);
  res.json({ ok: true });
});

app.post("/addBulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  if (!list || list.trim() === "") return res.redirect(`/admin?key=${API_KEY}`);

  let finalCat = category;
  if (category === "CANALES DE TODAS LAS SEÑALES") finalCat = "Todas las Señales";
  if (category === "PANTALLA PRINCIPAL") finalCat = "Pantalla Principal";

  const lines = list.split("\n");
  const toInsert = [];
  const baseTime = Date.now();
  lines.forEach((line, index) => {
    const parts = line.split(",");
    if (parts.length >= 2) {
      const channelName = parts[0].trim();
      toInsert.push({
        name: channelName,
        url: parts[1].trim(),
        logo: generateLogoUrl(channelName),
        category: finalCat, 
        status: "pending", 
        createdAt: new Date(baseTime + index)
      });
    }
  });
  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
});

// --- PANEL ADMIN ---

app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  try {
    const streams = await collection.find().sort({ createdAt: 1 }).toArray();
    const categoriasFijas = ["Cine", "Radio", "Infantiles", "Entretenimiento", "Deportes", "Nacionales"];

    const getStatusIcon = (status) => {
        if (status === 'online') return '🟢';
        if (status === 'offline') return '🔴';
        return '⚫'; 
    };

    const renderRowSimple = (s) => `
    <tr class="add-row"><td colspan="5" style="padding:0;"><button class="btn-add-here" onclick="insertarAqui('${s._id}')">+</button></td></tr>
    <tr id="row-${s._id}">
      <td width="30">${getStatusIcon(s.status)}</td>
      <td width="50">
        <img src="${s.logo || ''}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3172/3172551.png'" style="width:45px;height:45px;border-radius:8px;object-fit:contain;background:#000;border:1px solid #333;">
      </td>
      <td width="180">
        <input class="input-url" id="name-${s._id}" value="${s.name}" style="font-weight:bold;margin-bottom:4px;">
        <br/><span class="cat-badge">${s.category}</span>
      </td>
      <td><input class="input-url" id="url-${s._id}" value="${s.url}"></td>
      <td width="100">
        <button class="btn-play" onclick="guardar('${s._id}')">💾</button>
        <button class="btn-play" style="background:var(--danger)" onclick="eliminar('${s._id}')">❌</button>
      </td>
    </tr>`;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>IPTV Manager</title>
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
        textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 10px; border-bottom: 1px solid #2a2a2a; }
        .btn-play { background: #444; border: none; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer; }
        .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 4px; }
        .cat-badge { font-size: 10px; background: #333; padding: 2px 6px; border-radius: 10px; color: #aaa; }
        .btn-danger-all { background: var(--danger); color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
        .cat-readonly { background: #111; color: var(--primary); border: 1px solid #333; padding: 10px; flex: 1; border-radius: 4px; font-weight: bold; pointer-events: none; }
        .cat-selector { background: #000; color: white; border: 1px solid #444; padding: 10px; flex: 1; border-radius: 4px; }
        .btn-toggle { background: #444; border: 1px solid #666; color: white; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-toggle.active { background: var(--success); border-color: #5ff55; }
        .btn-add-here { width: 100%; background: transparent; border: none; color: #ffeb3b; font-size: 20px; cursor: pointer; padding: 5px; transition: 0.3s; }
        .btn-add-here:hover { background: rgba(255, 235, 59, 0.1); }
        .add-row td { border: none !important; padding: 0 !important; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        <div style="display:flex; align-items:center; gap:20px;">
          <h2 style="margin:0;">📺 IPTV Manager</h2>
          <button id="toggleBtn" class="btn-toggle" onclick="toggleAutoRefresh()">▶️ Auto-Refresh: OFF</button>
        </div>
        <div class="nav-menu">
          <button class="nav-btn active" id="tab-all" onclick="showView('all', this)">Todas las Señales</button>
          <button class="nav-btn" onclick="showView('categories', this)">Por Categoría</button>
          <button class="nav-btn" onclick="showView('main', this)">Pantalla Principal</button>
        </div>
      </div>

      <div class="bulk-section" id="bulk-card">
        <h4 style="margin:0 0 10px 0;">➕ Carga Masiva</h4>
        <form method="POST" action="/addBulk?key=${API_KEY}" id="bulkForm">
          <textarea name="list" id="bulkTextarea" rows="2" placeholder="Nombre, URL"></textarea>
          <div style="margin-top:10px; display:flex; gap:10px;" id="cat-input-container"></div>
        </form>
      </div>

      <div id="view-all" class="view-container active">
        <button class="btn-danger-all" onclick="borrarMasivo('all')">🗑 Limpiar Sección</button>
        <table>${streams.filter(s => s.category === "Todas las Señales").map(s => renderRowSimple(s)).join('')}</table>
      </div>

      <div id="view-categories" class="view-container">
          <div style="margin-bottom:15px; display:flex; gap:8px; flex-wrap:wrap;">
            ${categoriasFijas.map(cat => `<button class="nav-btn cat-filter-btn" style="font-size:12px;" onclick="filterCat('${cat}', this)">${cat}</button>`).join('')}
          </div>
          <div id="cat-actions" style="display:none">
             <button class="btn-danger-all" id="btnDelCat">🗑 Limpiar Categoría</button>
             <table id="cat-table-body"></table>
          </div>
      </div>

      <div id="view-main" class="view-container">
          <button class="btn-danger-all" onclick="borrarMasivo('main')">🗑 Limpiar Pantalla Principal</button>
          <table>${streams.filter(s => s.category === "Pantalla Principal").map(s => renderRowSimple(s)).join('')}</table>
      </div>

      <script>
        const API_KEY = "${API_KEY}";
        const allStreams = ${JSON.stringify(streams)};
        const categoriasArray = ${JSON.stringify(categoriasFijas)};

        let autoRefresh = localStorage.getItem("iptv_refresh") === "true";
        const toggleBtn = document.getElementById("toggleBtn");

        function updateToggleUI() {
          if (autoRefresh) {
            toggleBtn.innerHTML = "⏸️ Auto-Refresh: ON";
            toggleBtn.classList.add("active");
          } else {
            toggleBtn.innerHTML = "▶️ Auto-Refresh: OFF";
            toggleBtn.classList.remove("active");
          }
        }

        function toggleAutoRefresh() {
          autoRefresh = !autoRefresh;
          localStorage.setItem("iptv_refresh", autoRefresh);
          updateToggleUI();
          if (autoRefresh) location.reload();
        }

        if (autoRefresh) { setTimeout(() => { location.reload(); }, 15000); }
        updateToggleUI();

        async function insertarAqui(targetId) {
          const name = prompt("Nombre del nuevo canal:");
          if (!name) return;
          const url = prompt("URL del canal (m3u8):");
          if (!url) return;

          await fetch("/insertAt?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetId, name, url })
          });
          location.reload();
        }

        function updateCatInput(view, selectedCat = "") {
          const container = document.getElementById('cat-input-container');
          const bulkCard = document.getElementById('bulk-card');
          if (view === 'main') {
            bulkCard.classList.remove('hidden-bulk');
            container.innerHTML = \`<input name="category" class="cat-readonly" value="PANTALLA PRINCIPAL" readonly> <button class="nav-btn" style="background:var(--success)">Agregar</button>\`;
          } else if (view === 'all') {
            bulkCard.classList.remove('hidden-bulk');
            container.innerHTML = \`<input name="category" class="cat-readonly" value="CANALES DE TODAS LAS SEÑALES" readonly> <button class="nav-btn" style="background:var(--success)">Agregar</button>\`;
          } else {
            if (!selectedCat) {
              bulkCard.classList.add('hidden-bulk');
              container.innerHTML = '<p style="color:#888;">Elige una categoría.</p>';
            } else {
              bulkCard.classList.remove('hidden-bulk');
              let options = categoriasArray.map(c => \`<option value="\${c}" \${c === selectedCat ? 'selected' : ''}>\${c}</option>\`).join('');
              container.innerHTML = \`<select name="category" class="cat-selector">\${options}</select><button class="nav-btn" style="background:var(--success)">Agregar</button>\`;
            }
          }
        }
        updateCatInput('all');

        function showView(view, btn) {
          document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('view-' + view).classList.add('active');
          btn.classList.add('active');
          updateCatInput(view);
        }

        function filterCat(cat, btn) {
          document.querySelectorAll('.cat-filter-btn').forEach(b => b.style.background = "#333");
          btn.style.background = "var(--primary)";
          document.getElementById('cat-actions').style.display = 'block';
          document.getElementById('btnDelCat').onclick = () => borrarMasivo('category', cat);
          updateCatInput('categories', cat);
          const filtered = allStreams.filter(s => s.category === cat);
          
          document.getElementById('cat-table-body').innerHTML = filtered.map(s => {
            let icon = '⚫';
            if(s.status === 'online') icon = '🟢';
            if(s.status === 'offline') icon = '🔴';
            
            return \`
            <tr class="add-row"><td colspan="5" style="padding:0;"><button class="btn-add-here" onclick="insertarAqui('\${s._id}')">+</button></td></tr>
            <tr>
              <td>\${icon}</td>
              <td><img src="\${s.logo}" style="width:40px;height:40px;object-fit:contain;background:#000;border-radius:5px;"></td>
              <td><input class="input-url" id="name-\${s._id}" value="\${s.name}"></td>
              <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
              <td width="100">
                <button class="btn-play" onclick="guardar('\${s._id}')">💾</button>
                <button class="btn-play" style="background:var(--danger)" onclick="eliminar('\${s._id}')">❌</button>
              </td>
            </tr>\`;
          }).join('');
        }

        async function guardar(id) {
          const url = document.getElementById("url-" + id).value;
          const name = document.getElementById("name-" + id).value;
          await fetch("/update?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, url, name })
          });
          location.reload();
        }

        async function eliminar(id) {
          if(!confirm("¿Eliminar este canal?")) return;
          await fetch("/deleteStream?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
          });
          location.reload();
        }

        async function borrarMasivo(type, value = '') {
          if (!confirm("¿Borrar sección completa?")) return;
          await fetch("/deleteAll?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filterType: type, filterValue: value })
          });
          location.reload();
        }
      </script>
    </body>
    </html>
    `;
    res.send(html);
  } catch (err) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sistema Blindado Online"));