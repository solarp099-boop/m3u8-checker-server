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

// --- CONFIGURACIÓN DE LOGOS ---
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

// --- APIS INDEPENDIENTES ---

// 1. PANTALLA PRINCIPAL (Solo destacados)
app.get("/streams/main", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find({ category: "Pantalla Principal" }).sort({ createdAt: 1 }).toArray(); 
  res.json(streams);
});

// 2. TODAS LAS SEÑALES (Ahora es una categoría INDEPENDIENTE)
app.get("/streams/all", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  // FILTRO CORREGIDO: Ahora solo busca los que pertenecen a esta categoría específica
  const streams = await collection.find({ category: "Todas las Señales" }).sort({ createdAt: 1 }).toArray(); 
  res.json(streams);
});

// 3. POR CATEGORÍA (Radio, Deportes, etc.)
app.get("/streams/category", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const cat = req.query.name;
  const streams = await collection.find({ category: cat }).sort({ createdAt: 1 }).toArray();
  res.json(streams);
});

// --- CRUD ---

app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id, url, name } = req.body;
  const updateData = { url: url };
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
  
  let finalCat = category;
  // Mapeo de nombres del panel a categorías de la base de datos
  if (category === "SECCIÓN: TODAS LAS SEÑALES") finalCat = "Todas las Señales";
  if (category === "SECCIÓN: PANTALLA PRINCIPAL") finalCat = "Pantalla Principal";

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
        status: "unknown",
        createdAt: new Date(baseTime + index)
      });
    }
  });
  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
});

// --- PANEL DE ADMINISTRACIÓN ---

app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  
  try {
    const streams = await collection.find().sort({ createdAt: 1 }).toArray();
    const categoriasFijas = ["Cine", "Radio", "Infantiles", "Entretenimiento", "Deportes", "Nacionales"];
    
    const renderRow = (s) => `
    <tr id="row-${s._id}">
      <td width="30">${s.status === 'online' ? '🟢' : '🔴'}</td>
      <td width="50"><img src="${s.logo}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3172/3172551.png'" style="width:40px;height:40px;object-fit:contain;background:#000;border-radius:5px;"></td>
      <td><input class="input-url" id="name-${s._id}" value="${s.name}"><br><small style="color:#666">${s.category}</small></td>
      <td><input class="input-url" id="url-${s._id}" value="${s.url}"></td>
      <td>
        <button class="btn-play" onclick="guardar('${s._id}')">💾</button>
        <button class="btn-play" style="background:var(--danger)" onclick="eliminar('${s._id}')">❌</button>
      </td>
    </tr>`;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>IPTV Manager - Categorías Independientes</title>
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
        textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; border-radius: 4px; resize: vertical; margin-bottom:10px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 8px; border-bottom: 1px solid #2a2a2a; }
        .btn-play { background: #444; border: none; color: white; padding: 6px 12px; border-radius: 5px; cursor: pointer; }
        .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 6px; border-radius: 4px; }
        .btn-danger-all { background: var(--danger); color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
        .cat-display { background: #111; color: var(--primary); padding: 10px; border-radius: 5px; font-weight: bold; border: 1px solid #333; margin-bottom: 10px; display: inline-block; }
      </style>
    </head>
    <body>

      <div class="header">
        <h2 style="margin:0;">📺 IPTV Manager</h2>
        <div class="nav-menu">
          <button class="nav-btn active" onclick="showView('all', this)">Todas las Señales</button>
          <button class="nav-btn" onclick="showView('categories', this)">Por Categoría</button>
          <button class="nav-btn" onclick="showView('main', this)">Pantalla Principal</button>
        </div>
      </div>

      <div class="bulk-section">
        <div id="current-cat-label" class="cat-display">Sección: Todas las Señales</div>
        <form method="POST" action="/addBulk?key=${API_KEY}">
          <textarea name="list" rows="2" placeholder="Nombre, URL (un canal por línea)"></textarea>
          <input type="hidden" name="category" id="hidden-category" value="SECCIÓN: TODAS LAS SEÑALES">
          <button class="nav-btn" style="background:var(--success); width:100%;">Añadir a esta sección</button>
        </form>
      </div>

      <div id="view-all" class="view-container active">
        <button class="btn-danger-all" onclick="borrarMasivo('all')">🗑 Limpiar esta sección</button>
        <table>${streams.filter(s => s.category === "Todas las Señales").map(s => renderRow(s)).join('')}</table>
      </div>

      <div id="view-categories" class="view-container">
         <div style="margin-bottom:15px; display:flex; gap:8px; flex-wrap:wrap;">
           ${categoriasFijas.map(cat => `<button class="nav-btn" style="font-size:12px;" onclick="filterCat('${cat}')">${cat}</button>`).join('')}
         </div>
         <div id="cat-content" style="display:none">
            <button class="btn-danger-all" id="btnDelCat">🗑 Limpiar Categoría</button>
            <table id="cat-table"></table>
         </div>
      </div>

      <div id="view-main" class="view-container">
         <button class="btn-danger-all" onclick="borrarMasivo('main')">🗑 Limpiar Pantalla Principal</button>
         <table>${streams.filter(s => s.category === "Pantalla Principal").map(s => renderRow(s)).join('')}</table>
      </div>

      <script>
        const API_KEY = "${API_KEY}";
        const allStreams = ${JSON.stringify(streams)};

        function showView(view, btn) {
          document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('view-' + view).classList.add('active');
          btn.classList.add('active');
          
          const label = document.getElementById('current-cat-label');
          const hidden = document.getElementById('hidden-category');
          
          if(view === 'all') { label.innerText = "SECCIÓN: TODAS LAS SEÑALES"; hidden.value = "SECCIÓN: TODAS LAS SEÑALES"; }
          if(view === 'main') { label.innerText = "SECCIÓN: PANTALLA PRINCIPAL"; hidden.value = "SECCIÓN: PANTALLA PRINCIPAL"; }
          if(view === 'categories') { label.innerText = "SECCIÓN: SELECCIONA UNA CATEGORÍA ABAJO"; hidden.value = ""; }
        }

        function filterCat(cat) {
          document.getElementById('current-cat-label').innerText = "AÑADIENDO A: " + cat;
          document.getElementById('hidden-category').value = cat;
          document.getElementById('cat-content').style.display = 'block';
          document.getElementById('btnDelCat').onclick = () => borrarMasivo('category', cat);
          
          const filtered = allStreams.filter(s => s.category === cat);
          document.getElementById('cat-table').innerHTML = filtered.map(s => \`
            <tr>
              <td>\${s.status === 'online' ? '🟢' : '🔴'}</td>
              <td><img src="\${s.logo}" style="width:40px;height:40px;object-fit:contain;background:#000;border-radius:5px;"></td>
              <td><input class="input-url" id="name-\${s._id}" value="\${s.name}"></td>
              <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
              <td><button class="btn-play" onclick="guardar('\${s._id}')">💾</button></td>
            </tr>\`).join('');
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
          if(!confirm("¿Eliminar canal?")) return;
          await fetch("/deleteStream?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
          });
          location.reload();
        }

        async function borrarMasivo(type, value = '') {
          if (!confirm("¿Borrar todos los canales de esta sección?")) return;
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
app.listen(PORT, () => console.log("🚀 Servidor IPTV 100% Independiente"));