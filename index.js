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

// 🔍 Checker constante en segundo plano
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
  setInterval(checkStreams, 60000); // Revisa cada 60 segundos
})();

// 🌐 API para App
app.get("/streams", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).json([]);
  const streams = await collection.find().sort({ order: 1 }).toArray(); // Ordenado
  res.json(streams);
});

// 🔥 Actualizar
app.post("/update", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id, url } = req.body;
  await collection.updateOne({ _id: new ObjectId(id) }, { $set: { url: url } });
  res.json({ ok: true });
});

// ❌ Eliminar
app.post("/deleteStream", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { id } = req.body;
  await collection.deleteOne({ _id: new ObjectId(id) });
  res.json({ ok: true });
});

// ➕ Agregar (General o en posición específica)
app.post("/add", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { name, url, category, afterOrder } = req.body;
  
  let newOrder = Date.now(); // Por defecto al final
  if (afterOrder) {
    newOrder = parseFloat(afterOrder) + 1; // Se inserta justo después
  }

  await collection.insertOne({
    name, url, category: category || "Otros", status: "unknown", order: newOrder
  });
  res.redirect(`/admin?key=${API_KEY}`);
});

// 🔥 PANEL ADMIN MEJORADO
app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  const streams = await collection.find().sort({ order: 1 }).toArray();
  const categoriasUnicas = [...new Set(streams.map(s => s.category))];

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>IPTV Manager Pro</title>
    <style>
      :root { --bg: #0f0f0f; --card: #1a1a1a; --primary: #3d5afe; --danger: #ff1744; --success: #28a745; --text: #ffffff; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 15px; }
      .nav-menu { display: flex; gap: 10px; }
      .nav-btn { background: #333; border: none; color: white; padding: 10px 18px; cursor: pointer; border-radius: 8px; font-weight: bold; }
      .nav-btn.active { background: var(--primary); }
      .view-container { display: none; background: var(--card); padding: 20px; border-radius: 12px; }
      .view-container.active { display: block; }
      .form-inline { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 10px; }
      .form-inline input { background: #000; border: 1px solid #444; color: white; padding: 8px; border-radius: 4px; flex: 1; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 12px; border-bottom: 1px solid #2a2a2a; }
      .btn-play { background: #444; border: none; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer; }
      .btn-plus { background: var(--success); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 5px; }
      .insert-box { display: none; background: #222; padding: 10px; border-left: 4px solid var(--success); margin: 5px 0; }
      .online { color: #0f0; } .offline { color: #f00; }
      .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 6px; border-radius: 4px; }
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

    <div class="form-inline">
      <form method="POST" action="/add?key=${API_KEY}" style="display:flex; gap:10px; width:100%;">
        <input name="name" placeholder="Nombre" required>
        <input name="url" placeholder="URL m3u8" required>
        <input name="category" placeholder="Categoría" required>
        <button class="btn-play" style="background:var(--success)">Agregar al final</button>
      </form>
    </div>

    <div id="view-all" class="view-container active">
      <table>
        ${streams.map(s => renderRow(s)).join('')}
      </table>
    </div>

    <div id="view-categories" class="view-container">
       <div style="margin-bottom:15px;">
         ${categoriasUnicas.map(cat => `<button class="nav-btn" style="font-size:12px; padding:5px 10px;" onclick="filterCat('${cat}')">${cat}</button>`).join(' ')}
       </div>
       <table id="cat-table-body"></table>
    </div>

    <div id="view-main" class="view-container">
       <table>
         ${streams.filter(s => s.category.toLowerCase() === "nacionales").map(s => renderRow(s)).join('')}
       </table>
    </div>

    <script>
      let autoRefresh = true;
      function toggleRefresh() {
        autoRefresh = !autoRefresh;
        document.getElementById("btnAutoRefresh").innerText = autoRefresh ? "⏸ Pausar" : "▶ Reanudar";
      }
      setInterval(() => { if(autoRefresh) location.reload(); }, 15000);

      function showView(view, btn) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('view-' + view).classList.add('active');
        btn.classList.add('active');
      }

      function showInsert(id) {
        const box = document.getElementById('insert-' + id);
        box.style.display = box.style.display === 'block' ? 'none' : 'block';
      }

      function filterCat(cat) {
        const data = ${JSON.stringify(streams)};
        const filtered = data.filter(s => s.category === cat);
        document.getElementById('cat-table-body').innerHTML = filtered.map(s => \`
          <tr>
            <td width="30">\${s.status === 'online' ? '🟢' : '🔴'}</td>
            <td width="200"><b>\${s.name}</b></td>
            <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
          </tr>
        \`).join('');
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

      async function eliminar(id) {
        if(!confirm("¿Eliminar?")) return;
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
  return `
    <tr>
      <td width="30">${s.status === 'online' ? '🟢' : '🔴'}</td>
      <td width="200">
        <b>${s.name}</b><br/><small style="color:#666">${s.category}</small><br/>
        <button class="btn-plus" onclick="showInsert('${s._id}')"> + Agregar debajo</button>
        <div id="insert-${s._id}" class="insert-box">
           <form method="POST" action="/add?key=${API_KEY}">
             <input type="hidden" name="afterOrder" value="${s.order}">
             <input type="hidden" name="category" value="${s.category}">
             <input name="name" placeholder="Nombre" style="width:80px; font-size:10px;">
             <input name="url" placeholder="URL" style="width:120px; font-size:10px;">
             <button style="font-size:10px;">Insertar</button>
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
app.listen(PORT, () => console.log("🚀 Servidor con inserción rápida listo"));