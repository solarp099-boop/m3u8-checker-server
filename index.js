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
let libreria; // Nueva colección para la "Nube"

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
    libreria = db.collection("backups"); // Colección de respaldo
    console.log("✅ Conectado a MongoDB y Librería lista");
  } catch (e) { console.error("❌ Error MongoDB:", e); }
}

let checking = false;
async function checkStreams() {
  if (checking || !collection) return;
  checking = true;
  try {
    // 1. Chequeo de canales en el PANEL
    const streams = await collection.find().toArray();
    await Promise.all(streams.map(async (stream) => {
      let status = await verificarUrl(stream.url);
      
      // AUTO-HEALING: Si se cae, busca en la nube
      if (status === "offline") {
        const reemplazo = await libreria.findOne({ 
          name: { $regex: new RegExp(`^${stream.name}$`, "i") }, 
          status: "online" 
        });

        if (reemplazo) {
          console.log(`♻️ Auto-reemplazo: ${stream.name}`);
          await collection.updateOne({ _id: stream._id }, { $set: { url: reemplazo.url, status: "online" } });
          return;
        }
      }

      if (stream.status !== status) {
        await collection.updateOne({ _id: stream._id }, { $set: { status } });
      }
    }));

    // 2. Chequeo de canales en la LIBRERÍA (Nube)
    const backups = await libreria.find().toArray();
    await Promise.all(backups.map(async (b) => {
      let status = await verificarUrl(b.url);
      if (b.status !== status) {
        await libreria.updateOne({ _id: b._id }, { $set: { status } });
      }
    }));

  } catch (e) { console.error("Error en checker:", e); }
  checking = false;
}

async function verificarUrl(url) {
  try {
    await axios.head(url, { timeout: 2500, headers: { "User-Agent": "Mozilla/5.0" }, validateStatus: (s) => s < 400 });
    return "online";
  } catch {
    try {
      await axios.get(url, { timeout: 3000, headers: { "User-Agent": "Mozilla/5.0" }, validateStatus: (s) => s === 200 || s === 206 });
      return "online";
    } catch { return "offline"; }
  }
}

(async () => {
  await conectarDB();
  setInterval(checkStreams, 15000); 
})();

// --- ENDPOINTS APP ---
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
  const { targetId, name, url } = req.body;
  const target = await collection.findOne({ _id: new ObjectId(targetId) });
  if (!target) return res.status(404).send("Referencia no encontrada");
  const newTime = new Date(new Date(target.createdAt).getTime() - 1);
  await collection.insertOne({ name, url, logo: generateLogoUrl(name), category: target.category, status: "pending", createdAt: newTime });
  res.json({ ok: true });
});

app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id, url, name } = req.body;
  const updateData = { url, status: "pending" }; 
  if (name) { updateData.name = name; updateData.logo = generateLogoUrl(name); }
  await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
  res.json({ ok: true });
});

app.post("/deleteStream", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  await collection.deleteOne({ _id: new ObjectId(req.body.id) });
  res.json({ ok: true });
});

app.post("/deleteLibreria", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  await libreria.deleteOne({ _id: new ObjectId(req.body.id) });
  res.json({ ok: true });
});

app.post("/addBulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  if (!list || list.trim() === "") return res.redirect(`/admin?key=${API_KEY}`);

  const lines = list.split("\n");
  const toInsert = [];
  const baseTime = Date.now();

  lines.forEach((line, index) => {
    const parts = line.split(",");
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const obj = { name, url: parts[1].trim(), status: "pending", createdAt: new Date(baseTime + index) };
      if (category === "LIBRERIA") {
        toInsert.push(obj);
      } else {
        let finalCat = category === "CANALES DE TODAS LAS SEÑALES" ? "Todas las Señales" : category === "PANTALLA PRINCIPAL" ? "Pantalla Principal" : category;
        toInsert.push({ ...obj, logo: generateLogoUrl(name), category: finalCat });
      }
    }
  });

  if (toInsert.length > 0) {
    if (category === "LIBRERIA") await libreria.insertMany(toInsert);
    else await collection.insertMany(toInsert);
  }
  res.redirect(`/admin?key=${API_KEY}`);
});

app.post("/deleteAll", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { filterType, filterValue } = req.body;
  let q = {};
  if (filterType === "category") q = { category: filterValue };
  if (filterType === "main") q = { category: "Pantalla Principal" };
  if (filterType === "all") q = { category: "Todas las Señales" };
  if (filterType === "libreria") { await libreria.deleteMany({}); return res.json({ ok: true }); }
  await collection.deleteMany(q);
  res.json({ ok: true });
});

// --- PANEL ADMIN ---

app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  try {
    const streams = await collection.find().sort({ createdAt: 1 }).toArray();
    const backupStreams = await libreria.find().sort({ createdAt: 1 }).toArray();
    const categoriasFijas = ["Cine", "Radio", "Infantiles", "Entretenimiento", "Deportes", "Nacionales"];

    const getIcon = (s) => s === 'online' ? '🟢' : s === 'offline' ? '🔴' : '⚫';

    const renderRow = (s, isLib = false) => `
    ${!isLib ? `<tr class="add-row"><td colspan="5"><button class="btn-add-here" onclick="insertarAqui('${s._id}')">+</button></td></tr>` : ''}
    <tr>
      <td>${getIcon(s.status)}</td>
      <td>${!isLib ? `<img src="${s.logo}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3172/3172551.png'" style="width:40px;height:40px;object-fit:contain;background:#000;border-radius:5px;">` : '☁️'}</td>
      <td><input class="input-url" id="name-${s._id}" value="${s.name}">${!isLib ? `<br/><span class="cat-badge">${s.category}</span>` : ''}</td>
      <td><input class="input-url" id="url-${s._id}" value="${s.url}"></td>
      <td>
        <button class="btn-play" onclick="guardar('${s._id}', ${isLib})">💾</button>
        <button class="btn-play" style="background:var(--danger)" onclick="eliminar('${s._id}', ${isLib})">❌</button>
      </td>
    </tr>`;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>IPTV Manager PRO</title>
      <style>
        :root { --bg: #0f0f0f; --card: #1a1a1a; --primary: #3d5afe; --danger: #ff1744; --success: #28a745; --text: #fff; }
        body { font-family: sans-serif; background: var(--bg); color: var(--text); padding: 20px; }
        .header { display: flex; justify-content: space-between; border-bottom: 1px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
        .nav-btn { background: #333; border: none; color: #fff; padding: 10px 15px; cursor: pointer; border-radius: 8px; font-weight: bold; }
        .nav-btn.active { background: var(--primary); }
        .view-container { display: none; background: var(--card); padding: 20px; border-radius: 12px; }
        .view-container.active { display: block; }
        .bulk-section { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid var(--primary); }
        textarea { width: 100%; background: #000; color: #0f0; padding: 10px; border-radius: 4px; border: 1px solid #444; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 8px; border-bottom: 1px solid #2a2a2a; }
        .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 4px; }
        .btn-play { border: none; color: white; padding: 8px; border-radius: 5px; cursor: pointer; background: #444; }
        .btn-add-here { width: 100%; background: transparent; border: none; color: #ffeb3b; font-size: 18px; cursor: pointer; }
        .cat-badge { font-size: 9px; background: #333; padding: 2px 5px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>📺 IPTV Manager + Auto-Healing</h2>
        <div style="display:flex; gap:8px;">
          <button class="nav-btn active" onclick="showView('all', this)">Todas las Señales</button>
          <button class="nav-btn" onclick="showView('categories', this)">Categorías</button>
          <button class="nav-btn" onclick="showView('main', this)">Pantalla Principal</button>
          <button class="nav-btn" style="background:#6a1b9a" onclick="showView('libreria', this)">☁️ Nube de Respaldo</button>
        </div>
      </div>

      <div class="bulk-section" id="bulk-card">
        <h4 id="bulk-title">➕ Carga Masiva</h4>
        <form method="POST" action="/addBulk?key=${API_KEY}">
          <textarea name="list" rows="2" placeholder="Nombre, URL"></textarea>
          <div id="cat-input-container" style="margin-top:10px; display:flex; gap:10px;"></div>
        </form>
      </div>

      <div id="view-all" class="view-container active">
        <button class="nav-btn" style="background:var(--danger);margin-bottom:10px" onclick="borrarMasivo('all')">🗑 Limpiar Sección</button>
        <table>${streams.filter(s => s.category === "Todas las Señales").map(s => renderRow(s)).join('')}</table>
      </div>

      <div id="view-main" class="view-container">
        <button class="nav-btn" style="background:var(--danger);margin-bottom:10px" onclick="borrarMasivo('main')">🗑 Limpiar Principal</button>
        <table>${streams.filter(s => s.category === "Pantalla Principal").map(s => renderRow(s)).join('')}</table>
      </div>

      <div id="view-libreria" class="view-container">
        <h3 style="color:#ba68c8">Librería de Canales (Reserva)</h3>
        <button class="nav-btn" style="background:var(--danger);margin-bottom:10px" onclick="borrarMasivo('libreria')">🗑 Vaciar Nube</button>
        <table>${backupStreams.map(s => renderRow(s, true)).join('')}</table>
      </div>

      <div id="view-categories" class="view-container">
          <div style="margin-bottom:15px; display:flex; gap:8px; flex-wrap:wrap;">
            ${categoriasFijas.map(cat => `<button class="nav-btn" onclick="filterCat('${cat}', this)">${cat}</button>`).join('')}
          </div>
          <table id="cat-table-body"></table>
      </div>

      <script>
        const API_KEY = "${API_KEY}";
        function showView(view, btn) {
          document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('view-' + view).classList.add('active');
          btn.classList.add('active');
          
          const container = document.getElementById('cat-input-container');
          if(view === 'libreria') {
            container.innerHTML = '<input name="category" type="hidden" value="LIBRERIA"><button class="nav-btn" style="background:var(--success)">Subir a la Nube</button>';
          } else if(view === 'main') {
            container.innerHTML = '<input name="category" readonly value="PANTALLA PRINCIPAL" style="background:#111;color:#fff;border:none;padding:10px;"><button class="nav-btn" style="background:var(--success)">Agregar</button>';
          } else {
            container.innerHTML = '<input name="category" readonly value="CANALES DE TODAS LAS SEÑALES" style="background:#111;color:#fff;border:none;padding:10px;"><button class="nav-btn" style="background:var(--success)">Agregar</button>';
          }
        }
        showView('all', document.querySelector('.nav-btn'));

        async function insertarAqui(targetId) {
          const name = prompt("Nombre del canal:");
          const url = prompt("URL:");
          if (name && url) {
            await fetch("/insertAt?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId, name, url }) });
            location.reload();
          }
        }

        async function guardar(id, isLib) {
          const name = document.getElementById("name-" + id).value;
          const url = document.getElementById("url-" + id).value;
          await fetch("/update?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name, url }) });
          location.reload();
        }

        async function eliminar(id, isLib) {
          if(!confirm("¿Eliminar?")) return;
          const route = isLib ? "/deleteLibreria" : "/deleteStream";
          await fetch(route + "?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
          location.reload();
        }

        async function borrarMasivo(type) {
          if(!confirm("¿Borrar todo?")) return;
          await fetch("/deleteAll?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filterType: type }) });
          location.reload();
        }

        function filterCat(cat, btn) {
          const streams = ${JSON.stringify(streams)};
          const filtered = streams.filter(s => s.category === cat);
          document.getElementById('cat-table-body').innerHTML = filtered.map(s => {
            const icon = s.status === 'online' ? '🟢' : s.status === 'offline' ? '🔴' : '⚫';
            return \`<tr><td>\${icon}</td><td><img src="\${s.logo}" style="width:40px;height:40px;background:#000;"></td><td>\${s.name}</td><td>\${s.url}</td><td><button onclick="eliminar('\${s._id}', false)">❌</button></td></tr>\`;
          }).join('');
        }
      </script>
    </body>
    </html>`;
    res.send(html);
  } catch (err) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sistema con Auto-Healing Online"));