// Claude Mind Console - SPA logic.
const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = n => (n == null ? "-" : Number(n).toLocaleString());
const J = async (u, opt) => (await fetch(u, opt)).json();
const POST = (u, b) => J(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const pill = l => `<span class="pill ${esc(l)}">${esc(l)}</span>`;
const ago = d => { if (!d) return "-"; const ms = Date.now() - Date.parse(d); const h = ms / 3.6e6; return h < 24 ? Math.round(h) + "h ago" : Math.round(h / 24) + "d ago"; };
// open any stored file's content in a modal (click-through from sources/candidates)
async function openFile(file) {
  try { const d = await J("/api/chunks?file=" + encodeURIComponent(file)); modal(file, (d.chunks || []).map((c, i) => `[${i}] ${c.text}`).join("\n\n") || "(no stored content)"); }
  catch { modal(file, "(could not load)"); }
}
window.openFile = openFile;

// ---------- router ----------
const views = {};
function route() {
  const v = (location.hash.replace("#", "") || "overview");
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.view === v));
  view.innerHTML = `<div class="loading">Loading...</div>`;
  (views[v] || views.overview)();
}
window.addEventListener("hashchange", route);

// ---------- status ----------
(async () => {
  try { const o = await J("/api/overview"); $("#status-dot").classList.add("up"); $("#status-text").textContent = `${fmt(o.store.chunks)} chunks live`; }
  catch { $("#status-dot").classList.add("down"); $("#status-text").textContent = "engine offline"; }
  route();
})();

const head = (t, p) => `<div class="head"><h1>${esc(t)}</h1><p>${esc(p)}</p></div>`;

// ---------- overview ----------
views.overview = async () => {
  const o = await J("/api/overview");
  const maxC = Math.max(...o.layers.map(l => l.chunks), 1);
  const bars = o.layers.map(l => `<div class="bar-row"><span class="lab">${esc(l.layer)}</span><div class="bar-track"><div class="bar-fill" style="width:${(l.chunks / maxC * 100).toFixed(1)}%"></div></div><span class="val">${fmt(l.chunks)}</span></div>`).join("");
  const stat = (n, l, s) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  view.innerHTML = head("Overview", "The state of the Mind at a glance.") + `
    <div class="grid cols-4" style="margin-bottom:14px">
      ${stat(fmt(o.store.chunks), "chunks indexed", fmt(o.store.files) + " files")}
      ${stat(fmt(o.counts.library), "projects ingested")}
      ${stat(fmt(o.counts.sessions), "sessions captured")}
      ${stat(fmt(o.counts.themes), "themes", fmt(o.counts.cards) + " project cards")}
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Store by layer</h3>${bars}</div>
      <div class="card"><h3>System</h3>
        <table><tbody>
        <tr><td>embedding model</td><td class="mono">${esc(o.model)}</td></tr>
        <tr><td>reranker</td><td class="mono">${esc(o.reranker)}</td></tr>
        <tr><td>chat model</td><td class="mono">${esc(o.chatModel)}</td></tr>
        <tr><td>graph</td><td class="mono">${fmt(o.graph.nodes)} nodes / ${fmt(o.graph.edges)} edges / ${fmt(o.graph.communities)} communities</td></tr>
        <tr><td>gate entities</td><td class="mono">${fmt(o.entities)}</td></tr>
        <tr><td>last capture</td><td class="mono">${ago(o.lastSession)}</td></tr>
        </tbody></table>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Recent memory injections</h3>
      ${(o.recent || []).length ? o.recent.map(r => `<div class="mono" style="padding:4px 0;color:var(--ink-2)">${esc(r)}</div>`).join("") : '<div style="color:var(--ink-3)">No injections logged yet.</div>'}
    </div>`;
};

// ---------- graph ----------
views.graph = async () => {
  view.innerHTML = head("Knowledge graph", "Concept and project co-occurrence, clustered by community. Search, filter by cluster, click a node. For the file-link graph, open this vault in Obsidian (Graph View).") +
    `<div class="toolbar"><input id="gsearch" placeholder="search nodes..." style="width:240px"><select id="gcomm"><option value="all">all clusters</option></select><button class="ghost" id="gfit">fit</button>
     <span class="hint" style="margin-left:auto">&#9632; project &nbsp; &#9650; wiki page &nbsp; &#9679; concept &nbsp;&middot;&nbsp; size = cross-cutting reach</span></div><div id="net"></div>`;
  const g = await J("/api/graph");
  const PER = 26, byC = {};
  g.nodes.forEach(n => (byC[n.community] = byC[n.community] || []).push(n));
  const kept = [];
  Object.values(byC).forEach(m => { m.sort((a, b) => (b.projectSpread - a.projectSpread) || (b.degree - a.degree)); kept.push(...m.slice(0, PER)); });
  const keep = new Set(kept.map(n => n.id));
  const shape = t => t === "project" ? "box" : t === "page" ? "triangle" : "dot";
  // Curated muted palette (paper-compatible) instead of vis's bright defaults.
  const PAL = ["#C2613D", "#7A8B6F", "#6E7E96", "#B08A4F", "#9A6A7E", "#5F8C8C", "#A8743C", "#6B7B5A", "#8A6D9A", "#B5654D", "#4F7A6B", "#94804A"];
  const col = c => PAL[((c % PAL.length) + PAL.length) % PAL.length];
  const vN = kept.map(n => ({ id: n.id, label: n.label, value: 5 + n.projectSpread * 4 + Math.min(n.degree, 14), group: n.community, shape: shape(n.type), color: { background: col(n.community), border: col(n.community), highlight: { background: col(n.community), border: "#2B2722" } }, title: `${n.label} - ${n.type}, ${n.projectSpread} projects` }));
  const vE = g.edges.filter(e => keep.has(e.source) && keep.has(e.target) && (e.confidence === "EXTRACTED" || e.weight >= 0.5)).map(e => ({ from: e.source, to: e.target, value: e.weight }));
  const labelOf = {}; g.nodes.forEach(n => labelOf[n.id] = n.label);
  const sel = $("#gcomm");
  const comms = g.communities.filter(c => kept.some(n => n.community === c.id)).sort((a, b) => b.size - a.size);
  comms.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = `${c.name} (${c.size})`; sel.appendChild(o); });
  const nodes = new vis.DataSet(vN), edges = new vis.DataSet(vE);
  const net = new vis.Network($("#net"), { nodes, edges }, {
    nodes: { scaling: { min: 6, max: 40 }, font: { color: "#2B2722", size: 13, face: "ui-sans-serif", strokeWidth: 4, strokeColor: "#FCFAF5" }, borderWidth: 1, color: { border: "#E4DBCE" } },
    edges: { color: { color: "#E0D6C7", highlight: "#C2613D" }, smooth: false, width: .6 },
    physics: { barnesHut: { gravitationalConstant: -9000, springLength: 135 }, stabilization: { iterations: 220 } },
    interaction: { hover: true, tooltipDelay: 120 },
    groups: {} // vis auto-colors by group
  });
  $("#gsearch").addEventListener("input", e => { const q = e.target.value.toLowerCase().trim(); if (!q) return; const hit = vN.find(n => n.label.toLowerCase().includes(q)); if (hit) { net.selectNodes([hit.id]); net.focus(hit.id, { scale: 1.3, animation: true }); } });
  sel.addEventListener("change", e => { const v = e.target.value; nodes.update(vN.map(n => ({ id: n.id, hidden: v !== "all" && String(n.group) !== String(v) }))); });
  $("#gfit").onclick = () => net.fit({ animation: true });
};

// ---------- explorer (miller columns) ----------
views.explorer = async () => {
  view.innerHTML = head("Explorer", "Drill through the layers down to individual chunks.") + `<div class="miller" id="mill"></div>`;
  const mill = $("#mill");
  const layers = ["theme", "card", "session", "project", "wiki"];
  const files = (await J("/api/files")).files;
  const layerOf = f => f.startsWith("themes/") ? "theme" : f.startsWith("cards/") ? "card" : f.startsWith("journal/") ? "session" : f.startsWith("wiki/") ? "wiki" : f.startsWith("library/") ? "project" : "other";
  function colLayers() {
    return `<div class="col"><h4>Layers</h4>${layers.map(l => `<div class="item" data-l="${l}">${l}<span class="pill ${l}">${files.filter(f => layerOf(f) === l).length}</span></div>`).join("")}</div>`;
  }
  function render(activeLayer, activeFile, body) {
    let html = colLayers();
    if (activeLayer) {
      const fl = files.filter(f => layerOf(f) === activeLayer).slice(0, 500);
      html += `<div class="col"><h4>${activeLayer} (${fl.length})</h4>${fl.map(f => `<div class="item ${f === activeFile ? "sel" : ""}" data-f="${esc(f)}">${esc(f.split("/").pop())}</div>`).join("")}</div>`;
    } else html += `<div class="col"><h4>files</h4><div class="body" style="color:var(--ink-3)">Pick a layer.</div></div>`;
    html += `<div class="col"><h4>${activeFile ? esc(activeFile.split("/").pop()) : "content"}</h4><div class="body">${body || '<span style="color:var(--ink-3)">Pick a file.</span>'}</div></div>`;
    mill.innerHTML = html;
    mill.querySelectorAll("[data-l]").forEach(el => el.onclick = () => { el.classList.contains("sel"); render(el.dataset.l, null, null); mill.querySelectorAll("[data-l]").forEach(x => x.classList.toggle("sel", x === el)); });
    mill.querySelectorAll("[data-f]").forEach(el => el.onclick = async () => {
      const f = el.dataset.f; const ch = (await J("/api/chunks?file=" + encodeURIComponent(f))).chunks;
      render(activeLayer, f, ch.map((c, i) => `<div style="border-bottom:1px solid var(--line-2);padding:8px 0"><span class="pill">${i}</span> ${esc(c.text).slice(0, 600)}</div>`).join("") || "(no chunks)");
      if (activeLayer) mill.querySelectorAll("[data-l]").forEach(x => x.classList.toggle("sel", x.dataset.l === activeLayer));
    });
  }
  render(null, null, null);
};

// ---------- timeline ----------
views.timeline = async () => {
  const t = (await J("/api/timeline")).filter(x => x.date);
  const byMonth = {}; t.forEach(s => { const m = s.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; });
  const months = Object.keys(byMonth).sort(); const maxM = Math.max(...Object.values(byMonth), 1);
  const chart = months.map(m => `<div class="bar-row"><span class="lab" style="width:70px">${m}</span><div class="bar-track"><div class="bar-fill" style="width:${(byMonth[m] / maxM * 100).toFixed(0)}%"></div></div><span class="val">${byMonth[m]}</span></div>`).join("");
  const rows = t.slice().sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 120)
    .map(s => `<tr><td class="mono">${esc(s.date)}</td><td>${pill("session")} ${esc(s.project)}</td><td>${esc(s.title)}</td></tr>`).join("");
  view.innerHTML = head("Timeline", `${t.length} captured sessions across real time.`) +
    `<div class="card" style="margin-bottom:14px"><h3>Sessions per month</h3>${chart}</div>
     <div class="card"><h3>Recent sessions</h3><table><thead><tr><th>date</th><th>project</th><th>title</th></tr></thead><tbody>${rows}</tbody></table></div>`;
};

// ---------- themes ----------
views.themes = async () => {
  const t = await J("/api/themes");
  view.innerHTML = head("Themes", `${t.length} cross-project through-lines, synthesized from the graph clusters.`) +
    `<div class="gallery">${t.map((x, i) => `<div class="tile" data-i="${i}"><div class="t">${esc(x.name)}</div><div class="d">${esc(x.through)}</div><div class="meta">${esc(x.projects).slice(0, 120)}</div></div>`).join("")}</div>`;
  view.querySelectorAll(".tile").forEach(el => el.onclick = () => modal(t[el.dataset.i].name, t[el.dataset.i].body));
};

// ---------- projects ----------
views.projects = async () => {
  const p = await J("/api/projects");
  view.innerHTML = head("Projects", `${p.length} project state cards. Click for the full card.`) +
    `<div class="gallery">${p.map(x => `<div class="tile" data-n="${esc(x.name)}"><div class="t">${esc(x.name)} ${x.hasJournal ? '<span class="pill session">active</span>' : ""}</div><div class="d">${esc(x.status)}</div><div class="meta">last active ${esc(x.lastActive || "-")}</div></div>`).join("")}</div>`;
  view.querySelectorAll(".tile").forEach(el => el.onclick = async () => { const c = await J("/api/card?name=" + encodeURIComponent(el.dataset.n)); modal(el.dataset.n, c.body); });
};

// ---------- inspector ----------
views.inspector = async () => {
  view.innerHTML = head("Retrieval inspector", "Watch the pipeline decide. Type a query; see cosine recall, cross-encoder rerank, the route taken, and what gets injected.") +
    `<div class="toolbar"><input id="iq" placeholder="e.g. what did I conclude about sycophancy scoring" style="flex:1"><button id="irun">Run</button></div><div id="iout"></div>`;
  const run = async () => {
    const q = $("#iq").value.trim(); if (!q) return;
    $("#iout").innerHTML = `<div class="loading">Running pipeline...</div>`;
    const r = await POST("/api/retrieve", { query: q });
    const v = r.decision.inject;
    const cands = (r.candidates || []).slice(0, 14);
    const sb = (val, color) => `<div class="scorebar"><div class="sb-track"><div class="sb-fill" style="width:${Math.max(0, Math.min(1, val)) * 100}%;background:${color}"></div></div><span class="val mono">${val == null ? "-" : val.toFixed(3)}</span></div>`;
    const rows = cands.map(c => `<tr data-file="${esc(c.file)}" style="cursor:pointer"><td>${pill(c.layer)} <span class="mono">${esc(c.file.split("/").pop())}</span></td><td>${sb(c.cosine, "#9A9082")}</td><td>${c.rerank == null ? '<span class="hint">n/a (meta)</span>' : sb(c.rerank, "#C2613D")}</td></tr>`).join("");
    $("#iout").innerHTML = `
      <div class="verdict ${v ? "in" : "out"}">${v ? "INJECT" : "SKIP"} &nbsp;&middot;&nbsp; route: ${esc(r.route)} &nbsp;&middot;&nbsp; ${esc(r.decision.reason)}${r.decision.topScore != null ? " (top " + r.decision.topScore + ")" : ""}</div>
      <div class="pipe">
        <div class="card"><h3>Candidates (cosine recall &rarr; rerank) &middot; <span class="hint">click a row</span></h3><table><thead><tr><th>source</th><th>cosine</th><th>rerank</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="card"><h3>Injected context (${(r.injected || []).length})</h3>${(r.injected || []).length ? r.injected.map(h => `<div class="src-row" data-file="${esc(h.file)}" style="border-bottom:1px solid var(--line-2);padding:8px 0;cursor:pointer"><div>${pill(h.layer)} <span class="mono">${esc(h.file)}</span> <span class="hint">${h.score}</span></div><div style="color:var(--ink-2);margin-top:4px">${esc(h.text).slice(0, 280)}</div></div>`).join("") : '<div style="color:var(--ink-3)">Nothing injected for this query.</div>'}</div>
      </div>`;
    $("#iout").querySelectorAll("[data-file]").forEach(el => el.onclick = () => openFile(el.dataset.file));
  };
  $("#irun").onclick = run; $("#iq").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
};

// ---------- storage ----------
views.storage = async () => {
  const s = await J("/api/schema");
  const mb = (s.dbBytes / 1048576).toFixed(1);
  const layerRows = s.layers.map(l => `<tr><td>${pill(l.layer)}</td><td class="mono">${fmt(l.files)}</td><td class="mono">${fmt(l.chunks)}</td></tr>`).join("");
  const ddl = s.tables.map(t => t.sql).filter(Boolean).join(";\n\n");
  view.innerHTML = head("Storage", "Under the hood: the SQLite + sqlite-vec substrate.") + `
    <div class="grid cols-3" style="margin-bottom:14px">
      <div class="card stat"><div class="n">${mb} MB</div><div class="l">database on disk</div></div>
      <div class="card stat"><div class="n">${fmt(s.dim)}</div><div class="l">vector dimensions</div></div>
      <div class="card stat"><div class="n">${esc(s.pragmas.journal_mode || "-")}</div><div class="l">journal mode</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Rows by layer</h3><table><thead><tr><th>layer</th><th>files</th><th>chunks</th></tr></thead><tbody>${layerRows}</tbody></table></div>
      <div class="card"><h3>Schema</h3><pre class="codeblock">${esc(ddl)}</pre></div>
    </div>`;
};

// ---------- chat ----------
let chatHistory = [];
views.chat = async () => {
  view.innerHTML = head("Memory chat", "Every message routes through retrieval first. Ask your whole knowledge base anything.") +
    `<div class="chat-wrap"><div class="msgs" id="msgs"><div class="msg bot"><div class="who">Claude Mind</div><div class="txt">Ask me anything about your work. I always pull from your memory first and cite what I used.</div></div></div>
     <div class="composer"><textarea id="ci" placeholder="Ask your memory..."></textarea><button id="cs">Send</button></div>
     <div class="hint">Routed via your subscription. Sources shown under each answer.</div></div>`;
  const msgs = $("#msgs");
  const add = (cls, html) => { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  const chips = arr => (arr || []).map(s => `<span class="src" data-file="${esc(s.file)}" title="${esc(s.file)}">${esc(s.file.split("/").pop())} &middot; ${s.score}</span>`).join("");
  const wire = el => el.querySelectorAll("[data-file]").forEach(x => x.onclick = () => openFile(x.dataset.file));
  const send = async () => {
    const q = $("#ci").value.trim(); if (!q) return; $("#ci").value = "";
    add("user", `<div class="txt">${esc(q)}</div>`);
    const bot = add("bot", `<div class="who">Claude Mind</div><div class="txt thinking">routing through memory...</div>`);
    const hist = chatHistory.slice(-6).map(h => `${h.role}: ${h.text}`).join("\n");
    try {
      // phase 1: show what the router pulled, instantly (the context routing, visible)
      const pipe = await POST("/api/retrieve", { query: q });
      bot.innerHTML = `<div class="who">Claude Mind &middot; <span class="hint">route ${esc(pipe.route)}/${esc(pipe.decision.reason)}</span></div>${(pipe.injected || []).length ? `<div class="sources" style="margin-bottom:10px">${chips(pipe.injected)}</div>` : ""}<div class="txt thinking">thinking...</div>`;
      wire(bot); msgs.scrollTop = msgs.scrollHeight;
      // phase 2: the grounded answer
      const r = await POST("/api/chat", { message: q, history: hist });
      bot.innerHTML = `<div class="who">Claude Mind &middot; <span class="hint">route ${esc(r.route)}/${esc(r.reason)}</span></div><div class="txt">${esc(r.answer)}</div>${(r.sources || []).length ? `<div class="sources">${chips(r.sources)}</div>` : ""}`;
      wire(bot);
      chatHistory.push({ role: "User", text: q }, { role: "Assistant", text: r.answer });
    } catch (e) { bot.querySelector(".txt").textContent = "Error: " + e.message; }
    msgs.scrollTop = msgs.scrollHeight;
  };
  $("#cs").onclick = send;
  $("#ci").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
};

// ---------- persona ----------
views.persona = async () => {
  const d = await J("/api/persona");
  const u = (d.profile && d.profile.user) || {};
  const bg = u.background || {};
  const facetN = d.facts.byFacet || {};
  const maxF = Math.max(1, ...Object.values(facetN));
  const facetBars = Object.entries(facetN).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="bar-row"><span class="lab">${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / maxF * 100).toFixed(1)}%"></div></div><span class="val">${v}</span></div>`).join("");
  const maxH = Math.max(1, ...(d.history || []).map(h => h.count));
  const histBars = (d.history || []).map(h =>
    `<div class="bar-row"><span class="lab" style="font-size:11px">${esc(h.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(h.count / maxH * 100).toFixed(1)}%"></div></div><span class="val">${h.count}</span></div>`).join("");
  const facetColor = { health: "#b06" };
  const topFacts = (d.facts.top || []).map(f => `<li><span class="pill">${esc(f.facet)}${f.t ? " " + esc(f.t) : ""}</span> ${esc(f.s)} <span class="hint">${f.c}</span></li>`).join("");
  const people = (d.people || []).map(p => `<tr><td><b>${esc(p.label)}</b></td><td>${esc(p.role || "")}</td><td class="hint">${esc((p.notes || []).join("; ")).slice(0, 120)}</td></tr>`).join("");
  const docs = (d.docs || []).map(x => `<div class="card" style="cursor:pointer" data-file="${esc(x.file)}"><h3 style="margin:0 0 4px">${esc(x.title)}</h3><div class="hint">${esc(x.line)}</div></div>`).join("");
  const stat = (n, l, s) => `<div class="card stat"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;
  view.innerHTML = head("Persona", "The deep user model: who the user is, synthesized from their conversation history. Heavily weighted in retrieval; clinical tier quarantined.") + `
    <div class="grid cols-4" style="margin-bottom:14px">
      ${stat(d.facts.total, "structured facts", Object.keys(facetN).length + " facets")}
      ${stat((d.history || []).reduce((a, h) => a + h.count, 0), "conversations", (d.history || []).length + " months")}
      ${stat((d.people || []).length, "people")}
      ${stat((d.docs || []).length, "persona documents")}
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Identity</h3><table><tbody>
        <tr><td>name</td><td>${esc(u.display_name || u.legal_name || "(not set)")}</td></tr>
        <tr><td>location</td><td>${esc(u.location_current || "")}</td></tr>
        <tr><td>visa</td><td class="hint">${esc(u.visa_status || "")}</td></tr>
        <tr><td>education</td><td class="hint">${esc((bg.education || [])[0] || "")}</td></tr>
        <tr><td>cognitive</td><td class="hint">${esc(Object.keys((u.cognitive_profile || {})).filter(k => k !== "notes").join(", "))}</td></tr>
      </tbody></table></div>
      <div class="card"><h3>Facts by facet</h3>${facetBars || "<div class='hint'>Run the persona build to populate.</div>"}</div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Conversation history</h3>${histBars || "<div class='hint'>—</div>"}</div>
      <div class="card"><h3>People</h3><table><tbody>${people || "<tr><td class='hint'>—</td></tr>"}</tbody></table></div>
    </div>
    <div class="card"><h3>Highest-confidence facts</h3><ul class="facts">${topFacts || "<li class='hint'>—</li>"}</ul></div>
    <h3 style="margin:18px 0 8px">Documents</h3>
    <div class="grid cols-3">${docs || "<div class='hint'>No persona documents yet.</div>"}</div>`;
  view.querySelectorAll("[data-file]").forEach(el => el.onclick = () => openFile(el.dataset.file));
};

// ---------- modal ----------
function modal(title, body) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(43,39,34,.35);display:grid;place-items:center;z-index:50;padding:30px";
  ov.innerHTML = `<div style="background:var(--surface);border:1px solid var(--line);border-radius:14px;max-width:760px;width:100%;max-height:84vh;overflow:auto;padding:24px;box-shadow:0 10px 40px rgba(43,39,34,.2)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2 style="margin:0;font-size:18px">${esc(title)}</h2><button class="ghost" id="mx">close</button></div><div style="white-space:pre-wrap;line-height:1.7">${esc(body)}</div></div>`;
  ov.onclick = e => { if (e.target === ov || e.target.id === "mx") ov.remove(); };
  document.body.appendChild(ov);
}
