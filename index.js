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

// --- LÓGICA DE AUTO-REEMPLAZO (JERARQUÍA DE BACKUP) ---
// --- LÓGICA DE AUTO-REEMPLAZO OPTIMIZADA Y RÁPIDA ---
let checking = false;

async function checkStreams() {
  if (checking || !collection) return;
  checking = true;
  try {
    const streams = await collection.find().toArray();
    
    // Verificación rápida en paralelo controlado (bloques de 5 en 5 para que no colapse Render)
    const chunkSize = 5;
    for (let i = 0; i < streams.length; i += chunkSize) {
      const chunk = streams.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (stream) => {
        let status = "offline";
        try {
          // Intentamos HEAD rápido (máximo 1.5 segundos de espera)
          await axios.head(stream.url, { timeout: 1500, headers: { "User-Agent": "Mozilla/5.0" }, validateStatus: (s) => s < 400 });
          status = "online";
        } catch {
          try {
            // Si falla HEAD, intentamos un GET rápido de solo cabeceras
            await axios.get(stream.url, { timeout: 2000, headers: { "User-Agent": "Mozilla/5.0" }, validateStatus: (s) => s === 200 || s === 206 });
            status = "online";
          } catch { 
            status = "offline"; 
          }
        }

        // Solo actualiza la base de datos si el estado cambió de verdad
        if (stream.status !== status) {
          await collection.updateOne({ _id: stream._id }, { $set: { status } });
          stream.status = status;
        }
      }));
    }

    // Volvemos a traer la lista con los estados reales ya actualizados
    const updatedStreams = await collection.find().toArray();
    const libPrincipal = updatedStreams.filter(s => s.category === "Librería Principal" && s.status === "online");
    const libEmergencia = updatedStreams.filter(s => s.category === "Librería de Emergencia" && s.status === "online");

    // Aplicamos las Reglas de Reemplazo Automático
    for (const stream of updatedStreams) {
      if (stream.category === "Librería Principal" || stream.category === "Librería de Emergencia") continue;
      
      // REGLA DE ORO: Si está online, se respeta tu cambio manual
      if (stream.status === "online") continue; 

      // Si está offline, se busca auxilio en las librerías
      const escapedName = stream.name.trim().toLowerCase();
      const backupPrincipal = libPrincipal.find(l => l.name.trim().toLowerCase() === escapedName);
      const backupEmergencia = libEmergencia.find(l => l.name.trim().toLowerCase() === escapedName);
      
      let targetUrl = null;
      if (backupPrincipal) targetUrl = backupPrincipal.url;
      else if (backupEmergencia) targetUrl = backupEmergencia.url;

      if (targetUrl && stream.url !== targetUrl) {
        await collection.updateOne({ _id: stream._id }, { $set: { url: targetUrl, status: "online" } });
      }
    }
  } catch (e) { 
    console.error("Error en checker:", e); 
  }
  checking = false;
}

// Al final de tu index.js, cambiamos el intervalo de 15 segundos (15000) a 2 minutos (120000)
(async () => { 
  await conectarDB(); 
  setInterval(checkStreams, 20000); // <-- Cambiado a 2 minutos para estabilidad total
})();

// --- ENDPOINTS PARA LA APP ANDROID (VINCULACIÓN) ---

app.get("/streams", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  try {
    const streams = await collection.find({ category: "Pantalla Principal" }).sort({ createdAt: 1 }).toArray();
    res.json(streams || []);
  } catch (e) { res.status(500).json([]); }
});

app.get("/streams/all", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  try {
    const streams = await collection.find({ category: "Todas las Señales" }).sort({ createdAt: 1 }).toArray();
    res.json(streams || []);
  } catch (e) { res.status(500).json([]); }
});

app.get("/streams/category", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  try {
    const cat = req.query.name;
    const streams = await collection.find({ category: cat }).sort({ createdAt: 1 }).toArray();
    res.json(streams || []);
  } catch (e) { res.status(500).json([]); }
});

// --- ENDPOINTS ADMINISTRATIVOS ---

app.post("/insertFirst", async (req, res) => {
    if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
    const { name, url, category } = req.body;
    const firstStream = await collection.find({ category }).sort({ createdAt: 1 }).limit(1).toArray();
    let newTime = firstStream.length > 0 ? new Date(new Date(firstStream[0].createdAt).getTime() - 1000) : new Date();
    await collection.insertOne({ name, url, logo: generateLogoUrl(name), category, status: "pending", createdAt: newTime });
    res.json({ ok: true });
});

app.post("/insertAt", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { targetId, name, url } = req.body;
  const targetStream = await collection.findOne({ _id: new ObjectId(targetId) });
  if (!targetStream) return res.status(404).send("Referencia no encontrada");
  const nextStream = await collection.find({ category: targetStream.category, createdAt: { $gt: targetStream.createdAt } }).sort({ createdAt: 1 }).limit(1).toArray();
  const timeA = new Date(targetStream.createdAt).getTime();
  let newTimeValue = nextStream.length > 0 ? timeA + (new Date(nextStream[0].createdAt).getTime() - timeA) / 2 : timeA + 1000;
  await collection.insertOne({ name, url, logo: generateLogoUrl(name), category: targetStream.category, status: "pending", createdAt: new Date(newTimeValue) });
  res.json({ ok: true });
});

app.post("/addBulk", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  
  let finalCat = category;
  const upperCat = category.toUpperCase();

  if (upperCat.includes("TODAS LAS SEÑALES")) finalCat = "Todas las Señales";
  else if (upperCat.includes("PANTALLA PRINCIPAL")) finalCat = "Pantalla Principal";
  else if (upperCat.includes("LIBRERIA PRINCIPAL") || upperCat.includes("LIBRERÍA PRINCIPAL")) finalCat = "Librería Principal";
  else if (upperCat.includes("LIBRERIA EMERGENCIA") || upperCat.includes("LIBRERÍA DE EMERGENCIA")) finalCat = "Librería de Emergencia";

  const lines = list.split("\n");
  const toInsert = [];
  const baseTime = Date.now();
  lines.forEach((line, index) => {
    const parts = line.split(",");
    if (parts.length >= 2) {
      const channelName = parts[0].trim();
      toInsert.push({ name: channelName, url: parts[1].trim(), logo: generateLogoUrl(channelName), category: finalCat, status: "pending", createdAt: new Date(baseTime + index) });
    }
  });
  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
});

app.post("/addBulkTop", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { list, category } = req.body;
  
  let finalCat = category;
  const upperCat = category.toUpperCase();
  if (upperCat.includes("LIBRERIA PRINCIPAL") || upperCat.includes("LIBRERÍA PRINCIPAL")) finalCat = "Librería Principal";
  else if (upperCat.includes("LIBRERIA EMERGENCIA") || upperCat.includes("LIBRERÍA DE EMERGENCIA")) finalCat = "Librería de Emergencia";

  // Buscamos el primer canal actual de esta sección para obtener su fecha de creación
  const firstStream = await collection.find({ category: finalCat }).sort({ createdAt: 1 }).limit(1).toArray();
  
  // Establecemos el tiempo base restando un margen para que queden arriba del todo
  let baseTime = firstStream.length > 0 ? new Date(firstStream[0].createdAt).getTime() - (1000 * 60) : Date.now();

  const lines = list.split("\n");
  const toInsert = [];
  
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
        // Sumamos milisegundos de forma inversa para preservar el orden en el que se escribieron
        createdAt: new Date(baseTime + index) 
      });
    }
  });

  if (toInsert.length > 0) await collection.insertMany(toInsert);
  res.redirect(`/admin?key=${API_KEY}`);
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

app.post("/deleteOfflineStreams", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { category } = req.body;
  if (!category) return res.status(400).send("Categoría requerida");
  
  try {
    // Borra únicamente los que coinciden con la categoría y tienen status offline
    await collection.deleteMany({ category: category, status: "offline" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/deleteAll", async (req, res) => {
  if (req.query.key !== API_KEY) return res.status(401).send("No autorizado");
  const { filterType, filterValue } = req.body;
  let query = {};
  if (filterType === "category") query = { category: filterValue };
  else if (filterType === "main") query = { category: "Pantalla Principal" };
  else if (filterType === "all") query = { category: "Todas las Señales" };
  else if (filterType === "lib_p") query = { category: "Librería Principal" };
  else if (filterType === "lib_e") query = { category: "Librería de Emergencia" };
  await collection.deleteMany(query);
  res.json({ ok: true });
});

// --- INTERFAZ ---

app.get("/admin", async (req, res) => {
  if (req.query.key !== API_KEY) return res.send("No autorizado");
  try {
    const streams = await collection.find().sort({ createdAt: 1 }).toArray();
    const categoriasFijas = ["Cine", "Radio", "Infantiles", "Entretenimiento", "Deportes", "Nacionales"];

    const renderTable = (catName) => {
        const filtered = streams.filter(s => s.category === catName);
        
        // Validamos si es una de las librerías para habilitar los controles especiales
        const esLibreria = catName === "Librería Principal" || catName === "Librería de Emergencia";
        const sanitizedCat = catName.replace(/\s+/g, '-'); // Para crear clases CSS válidas

        return `
        <div class="bulk-section">
          <h4>➕ Carga Masiva (${catName})</h4>
          <form method="POST" action="/addBulk?key=${API_KEY}">
            <textarea name="list" rows="2" placeholder="Nombre Canal, URL"></textarea>
            <input type="hidden" name="category" value="${catName}">
            <button class="nav-btn" style="background:var(--success); margin-top:10px;">Agregar a ${catName}</button>
          </form>
        </div>
        
        <div style="margin-bottom: 15px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button class="btn-danger-all" style="margin-bottom:0;" onclick="borrarMasivo('${catName === 'Pantalla Principal' ? 'main' : catName === 'Todas las Señales' ? 'all' : catName === 'Librería Principal' ? 'lib_p' : 'lib_e'}')">🗑 Limpiar Sección</button>
          
          ${esLibreria ? `
            <button class="nav-btn" style="background: var(--warn); color: #000;" onclick="document.getElementById('bulk-top-${sanitizedCat}').style.display = document.getElementById('bulk-top-${sanitizedCat}').style.display === 'none' ? 'block' : 'none'">⚡ Carga Masiva al Inicio (#1)</button>
          ` : `
            <button class="nav-btn" style="background: var(--primary);" onclick="insertarPrimero('${catName}')">➕ INSERTAR AL INICIO (#1)</button>
          `}
          
          ${esLibreria ? `
            <div style="display: inline-flex; gap: 5px; background: #222; padding: 5px; border-radius: 8px; border: 1px solid #444;">
              <button class="nav-btn" style="padding: 5px 10px; font-size: 12px;" onclick="filtrarPorEstado('${sanitizedCat}', 'todos')">🌐 Todos</button>
              <button class="nav-btn" style="padding: 5px 10px; font-size: 12px; color: #28a745;" onclick="filtrarPorEstado('${sanitizedCat}', 'online')">🟢 Online</button>
              <button class="nav-btn" style="padding: 5px 10px; font-size: 12px; color: #ff1744;" onclick="filtrarPorEstado('${sanitizedCat}', 'offline')">🔴 Offline</button>
            </div>
            <button class="btn-danger-all" style="margin-bottom:0; display: none;" id="btn-eliminar-caidos-${sanitizedCat}" onclick="eliminarCanalesCaidos('${catName}')">🗑 Eliminar Canales Offline</button>
          ` : ''}
        </div>

        ${esLibreria ? `
          <div class="bulk-section" id="bulk-top-${sanitizedCat}" style="display:none; border-left: 4px solid var(--warn);">
            <h4 style="color: var(--warn);">⚡ Carga Masiva al INICIO (${catName})</h4>
            <form method="POST" action="/addBulkTop?key=${API_KEY}">
              <textarea name="list" rows="3" placeholder="Nombre Canal, URL&#10;Nombre Canal 2, URL 2"></textarea>
              <input type="hidden" name="category" value="${catName}">
              <button class="nav-btn" style="background:var(--warn); color:#000; margin-top:10px;">Insertar Primero en ${catName}</button>
            </form>
          </div>
        ` : ''}

        <table id="tabla-${sanitizedCat}">
            ${filtered.map(s => `
                <tr class="add-row row-status-${s.status}" style="padding:0;"><td colspan="5" style="padding:0;"><button class="btn-add-here" onclick="insertarAqui('${s._id}')">+</button></td></tr>
                <tr id="row-${s._id}" class="row-status-${s.status}">
                    <td width="30">${s.status === 'online' ? '🟢' : s.status === 'offline' ? '🔴' : '⚫'}</td>
                    <td width="50"><img src="${s.logo || ''}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3172/3172551.png'" style="width:45px;height:45px;border-radius:8px;object-fit:contain;background:#000;border:1px solid #333;"></td>
                    <td width="180"><input class="input-url" id="name-${s._id}" value="${s.name}" style="font-weight:bold;"><br/><span class="cat-badge">${s.category}</span></td>
                    <td><input class="input-url" id="url-${s._id}" value="${s.url}"></td>
                    <td width="100"><button class="btn-play" onclick="guardar('${s._id}')">💾</button><button class="btn-play" style="background:var(--danger)" onclick="eliminar('${s._id}')">❌</button></td>
                </tr>
            `).join('')}
        </table>`;
    };

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>IPTV Manager PRO</title>
      <style>
        :root { --bg: #0f0f0f; --card: #1a1a1a; --primary: #3d5afe; --danger: #ff1744; --success: #28a745; --text: #ffffff; --warn: #ffeb3b; }
        body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 15px; }
        .nav-menu { display: flex; gap: 8px; flex-wrap: wrap; }
        .nav-btn { background: #333; border: none; color: white; padding: 10px 15px; cursor: pointer; border-radius: 8px; font-weight: bold; font-size: 13px; }
        .nav-btn.active { background: var(--primary); }
        .view-container { display: none; background: var(--card); padding: 20px; border-radius: 12px; }
        .view-container.active { display: block; }
        .bulk-section { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid var(--primary); }
        textarea { width: 100%; background: #000; color: #0f0; border: 1px solid #444; padding: 10px; font-family: monospace; border-radius: 4px; resize: vertical; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 10px; border-bottom: 1px solid #2a2a2a; }
        .btn-play { background: #444; border: none; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer; }
        .input-url { width: 100%; background: #0a0a0a; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 4px; }
        .cat-badge { font-size: 10px; background: #333; padding: 2px 6px; border-radius: 10px; color: #aaa; }
        .btn-danger-all { background: var(--danger); color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
        .btn-toggle { background: #444; border: 1px solid #666; color: white; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-toggle.active { background: var(--success); }
        .btn-add-here { width: 100%; background: rgba(255,255,255,0.05); border: 1px dashed #444; color: var(--warn); font-size: 14px; padding: 5px; cursor: pointer; margin: 5px 0; }
        
      </style>
    </head>
    <body>
      <div class="header">
        <div style="display:flex; align-items:center; gap:20px;">
          <h2 style="margin:0;">📺 IPTV Manager</h2>
          <button id="toggleBtn" class="btn-toggle" onclick="toggleAutoRefresh()">▶️ Auto-Refresh: OFF</button>
        </div>
        <div class="nav-menu">
          <button class="nav-btn active" onclick="showView('all', this)">Todas las Señales</button>
          <button class="nav-btn" onclick="showView('categories', this)">Categorías</button>
          <button class="nav-btn" onclick="showView('main', this)">P. Principal</button>
          <button class="nav-btn" style="color:var(--warn)" onclick="showView('lib-p', this)">⭐ Lib. Principal</button>
          <button class="nav-btn" style="color:#00e5ff;" onclick="showView('lib-e', this)">🆘 Lib. Emergencia</button>
        </div>
      </div>

      <div id="view-all" class="view-container active">
        ${renderTable("Todas las Señales")}
      </div>

      <div id="view-categories" class="view-container">
        <div class="bulk-section" id="bulk-cat-section" style="display:none;">
          <h4 id="current-cat-header"></h4>
          <form method="POST" action="/addBulk?key=${API_KEY}">
            <textarea name="list" rows="2" placeholder="Nombre Canal, URL"></textarea>
            <input type="hidden" name="category" id="hidden-cat-value">
            <button class="nav-btn" style="background:var(--success); margin-top:10px;">Cargar en esta Categoría</button>
          </form>
        </div>
        <div style="margin-bottom:15px; display:flex; gap:8px; flex-wrap:wrap;">
          ${categoriasFijas.map(cat => `<button class="nav-btn cat-filter-btn" onclick="filterCat('${cat}', this)">${cat}</button>`).join('')}
        </div>
        <div id="cat-actions" style="display:none">
            <button class="btn-danger-all" id="btnDelCat">🗑 Limpiar Categoría</button>
            <button class="btn-add-here" id="btnFirstCat">➕ INSERTAR AL INICIO (#1)</button>
            <div id="cat-table-body"></div>
        </div>
      </div>

      <div id="view-main" class="view-container">
        ${renderTable("Pantalla Principal")}
      </div>

      <div id="view-lib-p" class="view-container">
        ${renderTable("Librería Principal")}
      </div>

      <div id="view-lib-e" class="view-container">
        ${renderTable("Librería de Emergencia")}
      </div>

      <script>
        const API_KEY = "${API_KEY}";
        const allStreams = ${JSON.stringify(streams)};
        let autoRefresh = localStorage.getItem("iptv_refresh") === "true";

        function showView(view, btn) {
          document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('view-' + view).classList.add('active');
          btn.classList.add('active');
        }

        function filterCat(cat, btn) {
          document.querySelectorAll('.cat-filter-btn').forEach(b => b.style.background = "#333");
          btn.style.background = "var(--primary)";
          document.getElementById('bulk-cat-section').style.display = 'block';
          document.getElementById('current-cat-header').innerText = "➕ Carga Masiva (" + cat + ")";
          document.getElementById('hidden-cat-value').value = cat;
          document.getElementById('cat-actions').style.display = 'block';
          document.getElementById('btnDelCat').onclick = () => borrarMasivo('category', cat);
          document.getElementById('btnFirstCat').onclick = () => insertarPrimero(cat);
          
          const filtered = allStreams.filter(s => s.category === cat);
          document.getElementById('cat-table-body').innerHTML = \`
            <table>
                \${filtered.map(s => \`
                    <tr class="add-row"><td colspan="5" style="padding:0;"><button class="btn-add-here" onclick="insertarAqui('\${s._id}')">+</button></td></tr>
                    <tr>
                        <td>\${s.status === 'online' ? '🟢' : '🔴'}</td>
                        <td><img src="\${s.logo}" style="width:40px;height:40px;object-fit:contain;background:#000;border-radius:5px;"></td>
                        <td><input class="input-url" id="name-\${s._id}" value="\${s.name}"></td>
                        <td><input class="input-url" id="url-\${s._id}" value="\${s.url}"></td>
                        <td width="100">
                            <button class="btn-play" onclick="guardar('\${s._id}')">💾</button>
                            <button class="btn-play" style="background:var(--danger)" onclick="eliminar('\${s._id}')">❌</button>
                        </td>
                    </tr>\`).join('')}
            </table>\`;
        }

        async function guardar(id) {
          const url = document.getElementById("url-" + id).value;
          const name = document.getElementById("name-" + id).value;
          await fetch("/update?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, url, name }) });
          location.reload();
        }

        async function eliminar(id) {
          if(!confirm("¿Eliminar?")) return;
          await fetch("/deleteStream?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
          location.reload();
        }

        async function borrarMasivo(type, value = '') {
          if (!confirm("¿Borrar sección?")) return;
          await fetch("/deleteAll?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filterType: type, filterValue: value }) });
          location.reload();
        }

        async function insertarAqui(targetId) {
          const name = prompt("Nombre:"); const url = prompt("URL:");
          if (!name || !url) return;
          await fetch("/insertAt?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId, name, url }) });
          location.reload();
        }

        async function insertarPrimero(category) {
            const name = prompt("Nombre (Nuevo #1):"); const url = prompt("URL:");
            if (!name || !url) return;
            await fetch("/insertFirst?key=" + API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url, category }) });
            location.reload();
        }

        function filtrarPorEstado(sanitizedCat, estado) {
          const tabla = document.getElementById('tabla-' + sanitizedCat);
          if (!tabla) return;

          const filas = tabla.querySelectorAll('tr');
          filas.forEach(fila => {
            if (estado === 'todos') {
              fila.style.display = '';
            } else if (estado === 'online') {
              if (fila.classList.contains('row-status-online')) fila.style.display = '';
              else fila.style.display = 'none';
            } else if (estado === 'offline') {
              if (fila.classList.contains('row-status-offline')) fila.style.display = '';
              else fila.style.display = 'none';
            }
          });

          // Mostrar el botón de "Eliminar Canales Offline" SOLO si el filtro actual es 'offline'
          const btnEliminarCaidos = document.getElementById('btn-eliminar-caidos-' + sanitizedCat);
          if (btnEliminarCaidos) {
            if (estado === 'offline') {
              btnEliminarCaidos.style.display = 'inline-block';
            } else {
              btnEliminarCaidos.style.display = 'none';
            }
          }
        }

        async function eliminarCanalesCaidos(category) {
          if (!confirm("¿Estás seguro de que deseas eliminar TODOS los canales offline de la sección '" + category + "'?")) return;
          
          const response = await fetch("/deleteOfflineStreams?key=" + API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category })
          });
          
          if (response.ok) {
            location.reload();
          } else {
            alert("Hubo un error al intentar eliminar los canales caídos.");
          }
        }

        function toggleAutoRefresh() {
          autoRefresh = !autoRefresh; localStorage.setItem("iptv_refresh", autoRefresh); location.reload();
        }

        if (autoRefresh) {
          document.getElementById("toggleBtn").classList.add("active");
          document.getElementById("toggleBtn").innerText = "⏸️ Auto-Refresh: ON";
          setTimeout(() => location.reload(), 20000);
        }
      </script>
    </body>
    </html>`;
    res.send(html);
  } catch (err) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sistema Blindado con Vinculación para App Avanzada"));