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

// --- APIS ---

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
  if (filterType === "main") query = { category: "Pantalla Principal" };
  if (filterType === "all") query = {};
  await collection.deleteMany(query);
  res.json({ ok: true });
});

app.post("/addBulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  
  // Normalizar categoría para Pantalla Principal o Nacionales
  let finalCat = category;
  if (category === "CANALES DE TODAS LAS SEÑALES") finalCat = "Nacionales";
  if (category === "PANTALLA PRINCIPAL") finalCat = "Pantalla Principal";

  const lines = list.split("\n");
  const toInsert = [];
  const baseTime = Date.now();
  lines.forEach((line, index) => {
    const parts = line.split(",");
    if (parts.length >= 2) {
      toInsert.push({
        name: parts[0].trim(),
        url: parts[1].trim(),
        category: finalCat || "Nacionales",
        status: "unknown",
        createdAt: new Date(baseTime + index)
      });
    }
  });
  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
});

// --- PANEL ---

app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  
  try {
    const streams = await collection.find().sort({ createdAt: 1 }).toArray();
    const categoriasFijas = ["Cine", "Radio", "Infantiles", "Entretenimiento", "Deportes", "Nacionales"];
    
    const extraCats = [...new Set(streams.map(s => s.category))]
                      .filter(c => !categoriasFijas.includes(c) && c !== "Pantalla Principal");
    
    const todasLasCategorias = [...categoriasFijas, ...extraCats];

    const renderRowSimple = (s) => `
    <tr id="row-${s._id}">
      <td width="30">${s.status === 'online' ? '🟢' : '🔴'}</td>
      <td width="220"><b>${s.name}</b><br/><span class="cat-badge">${s.category}</span></td>
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
        textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; border-radius: 4px; resize: vertical; }
        .btn-danger-all { background: var(--danger); color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 10px; border-bottom: 1px solid #2a2a2a; }
        .btn-play { background: #444; border: none; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer; }
        .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 4px; }
        .cat-badge { font-size: 10px; background: #333; padding: 2px 6px; border-radius: 10px; color: #aaa; }
        .cat-selector { background: #000; color: white; border: 1px solid #444; padding: 8px; flex: 1; border-radius: 4px; cursor: pointer; }
        .cat-readonly { background: #111; color: #888; border: 1px solid #333; padding: 8px; flex: 1; border-radius: 4px; font-weight: bold; pointer-events: none; }
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
        <h4 style="margin:0 0 10px 0;">➕ Carga Masiva</h4>
        <form method="POST" action="/addBulk?key=${API_KEY}">
          <textarea name="list" rows="2" placeholder="Nombre, URL"></textarea>
          <div style="margin-top:10px; display:flex; gap:10px;" id="cat-input-container">
            <!-- El selector se inyecta por JS según la pestaña activa -->
          </div>
        </form>
      </div>

      <div id="view-all" class="view-container active">
        <button class="btn-danger-all" onclick="borrarMasivo('all')">🗑 Borrar TODO</button>
        <table>${streams.map(s => renderRowSimple(s)).join('')}</table>
      </div>

      <div id="view-categories" class="view-container">
         <div style="margin-bottom:15px; display:flex; gap:5px; flex-wrap:wrap;">
           ${todasLasCategorias.map(cat => `<button class="nav-btn" style="font-size:11px; padding:6px 12px;" onclick="filterCat('${cat}')">${cat}</button>`).join('')}
         </div>
         <div id="cat-actions" style="display:none">
            <button class="btn-danger-all" id="btnDelCat">🗑 Limpiar Canales de la Categoría</button>
            <table id="cat-table-body"></table>
         </div>
      </div>

      <div id="view-main" class="view-container">
         <button class="btn-danger-all" onclick="borrarMasivo('main')">🗑 Limpiar Pantalla Principal</button>
         <table>${streams.filter(s => s.category === "Pantalla Principal").map(s => renderRowSimple(s)).join('')}</table>
      </div>

      <script>
        const API_KEY = "${API_KEY}";
        let autoRefresh = true;
        const allStreams = ${JSON.stringify(streams)};
        const categoriasArray = ${JSON.stringify(todasLasCategorias)};

        function toggleRefresh() { autoRefresh = !autoRefresh; document.getElementById("btnAutoRefresh").innerText = autoRefresh ? "⏸ Pausar" : "▶ Reanudar"; }
        setInterval(() => { if(autoRefresh) location.reload(); }, 45000);

        function updateCatInput(view, selectedCat = "") {
          const container = document.getElementById('cat-input-container');
          if (view === 'main') {
            container.innerHTML = \`<input name="category" class="cat-readonly" value="PANTALLA PRINCIPAL" readonly> <button class="nav-btn" style="background:var(--success)">Agregar al final</button>\`;
          } else if (view === 'all') {
            container.innerHTML = \`<input name="category" class="cat-readonly" value="CANALES DE TODAS LAS SEÑALES" readonly> <button class="nav-btn" style="background:var(--success)">Agregar al final</button>\`;
          } else {
            let options = categoriasArray.map(c => \`<option value="\${c}" \${c === selectedCat ? 'selected' : ''}>\${c}</option>\`).join('');
            container.innerHTML = \`
              <select name="category" class="cat-selector" id="dynamicSelector">
                \${options}
              </select>
              <button class="nav-btn" style="background:var(--success)">Agregar al final</button>\`;
          }
        }

        // Inicializar input
        updateCatInput('all');

        function showView(view, btn) {
          document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('view-' + view).classList.add('active');
          btn.classList.add('active');
          updateCatInput(view);
        }

        function filterCat(cat) {
          document.getElementById('cat-actions').style.display = 'block';
          document.getElementById('btnDelCat').onclick = () => borrarMasivo('category', cat);
          updateCatInput('categories', cat);
          const filtered = allStreams.filter(s => s.category === cat);
          let html = "";
          filtered.forEach(s => {
            html += \`
            <tr id="row-\${s._id}">
              <td width="30">\${s.status === 'online' ? '🟢' : '🔴'}</td>
              <td width="220"><b>\${s.name}</b><br/><span class="cat-badge">\${s.category}</span></td>
              <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
              <td width="100">
                <button class="btn-play" onclick="guardar('\${s._id}')">💾</button>
                <button class="btn-play" style="background:var(--danger)" onclick="eliminar('\${s._id}')">❌</button>
              </td>
            </tr>\`;
          });
          document.getElementById('cat-table-body').innerHTML = html;
        }

        async function guardar(id) {
          const url = document.getElementById("url-" + id).value;
          await fetch("/update?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, url })
          });
          alert("Cambios guardados");
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
          const msg = type === 'category' ? \`¿Borrar canales de "\${value}"?\` : "¿Borrar todo?";
          if (!confirm(msg)) return;
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
  } catch (err) {
    res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sistema IPTV Actualizado"));