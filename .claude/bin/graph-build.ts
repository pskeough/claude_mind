/**
 * LKHS graph builder + analytics (ideas repurposed from graphify, reimplemented
 * for our markdown brain).
 *
 * Builds a weighted graph from:
 *   - wiki/*.md   : explicit [[links]] (EXTRACTED edges, document structure)
 *   - journal/*.md: per-session **Entities:** lists -> project->concept edges
 *                   (EXTRACTED) + concept<->concept co-occurrence (INFERRED)
 *
 * Then computes Louvain communities, "god nodes" (highest weighted degree),
 * cross-community "bridges"/surprising connections, and confidence stats.
 *
 * Outputs (in graph/): graph.json, GRAPH_REPORT.md, graph.html (standalone viz).
 *
 *   npm run graph
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import * as fs from "fs";
import * as path from "path";
import { canonKey } from "./text-normalize";
import { vaultRoot, personaHub } from "./config";

const ROOT = vaultRoot();
const OUT = path.join(ROOT, "graph");

// Merge key: separator-style variants (Llama-3.1-8B / Llama 3.1 8B) collapse to
// one node. Display label is recovered separately via bestLabel().
const norm = (s: string) => canonKey(s);

// Track the nicest label per node id (most frequent original casing).
const labelCounts: Record<string, Record<string, number>> = {};
function note(id: string, label: string) {
  (labelCounts[id] ??= {})[label] = (labelCounts[id]?.[label] ?? 0) + 1;
}
const bestLabel = (id: string) =>
  Object.entries(labelCounts[id] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? id;

const g = new Graph({ type: "undirected" });

function addNode(id: string, type: string, label: string) {
  note(id, label);
  if (!g.hasNode(id)) g.addNode(id, { type, label });
  else if (type === "page" || type === "project" || type === "person") g.setNodeAttribute(id, "type", type); // docs/people win over concept
}

function addEdge(a: string, b: string, inc: number, confidence: "EXTRACTED" | "INFERRED") {
  if (a === b) return;
  if (g.hasEdge(a, b)) {
    g.updateEdgeAttribute(a, b, "weight", (w: number) => (w || 0) + inc);
    if (confidence === "EXTRACTED") g.setEdgeAttribute(a, b, "confidence", "EXTRACTED");
  } else {
    g.addEdge(a, b, { weight: inc, confidence });
  }
}

const LINK_RE = /\[\[([^\]]+)\]\]/g;
function links(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const t = m[1]!.split("|")[0]!.trim();
    if (t) out.push(t);
  }
  return out;
}

function frontmatterTitle(content: string, fallback: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  const t = m?.[1]?.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  return t || fallback;
}

// ---- ingest wiki ----------------------------------------------------------
function ingestWiki() {
  const dir = path.join(ROOT, "wiki");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const title = frontmatterTitle(content, f.replace(/\.md$/, "").replace(/-/g, " "));
    const pid = norm(title);
    addNode(pid, "page", title);
    for (const target of links(content)) {
      const tid = norm(target);
      addNode(tid, "concept", target);
      addEdge(pid, tid, 1, "EXTRACTED");
    }
  }
}

// ---- ingest journals (per session entry) ----------------------------------
function ingestJournals() {
  const dir = path.join(ROOT, "journal");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const project = f.replace(/\.md$/, "");
    const prid = norm(project);
    addNode(prid, "project", project);

    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const entries = content.split(/^## (?=\d{4}-)/m).slice(1); // each session entry
    for (const entry of entries) {
      const entLine = entry.match(/^\*\*Entities:\*\*\s*(.+)$/m)?.[1];
      if (!entLine) continue;
      const ents = links(entLine);
      const ids = ents.map(e => { const id = norm(e); addNode(id, "concept", e); return id; });
      for (const id of ids) addEdge(prid, id, 1, "EXTRACTED");        // project mentions concept
      const w = 1 / Math.max(1, ids.length - 1);                      // dampen so a big entry's clique does not dominate
      for (let i = 0; i < ids.length; i++)                            // concept co-occurrence
        for (let j = i + 1; j < ids.length; j++) addEdge(ids[i]!, ids[j]!, w, "INFERRED");
    }
  }
}

// ---- ingest library (directory-derived project summaries) -----------------
function ingestLibrary() {
  const dir = path.join(ROOT, "library");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const title = frontmatterTitle(content, f.replace(/\.md$/, ""));
    const prid = norm(title);
    addNode(prid, "project", title);
    for (const target of links(content)) {
      const tid = norm(target);
      addNode(tid, "concept", target);
      addEdge(prid, tid, 1, "EXTRACTED");
    }
  }
}

// ---- ingest persona (the user as a first-class hub) -----------------------
// The user is the center of their own knowledge graph: connect him to the people in
// his life (persona/entities.json) and to every concept/project his persona docs
// link to. The clinical tier is deliberately excluded from the graph.
function ingestPersona() {
  const hub = personaHub();
  const HUB = norm(hub.label);
  let touched = false;
  const ents = path.join(ROOT, "persona", "entities.json");
  if (fs.existsSync(ents)) {
    try {
      const e = JSON.parse(fs.readFileSync(ents, "utf8"));
      addNode(HUB, "person", e.hub?.label || hub.label); touched = true;
      for (const p of e.people || []) {
        const pid = norm(p.label);
        addNode(pid, "person", p.label);
        addEdge(HUB, pid, 2, "EXTRACTED"); // a real relationship, not co-occurrence
      }
    } catch { /* */ }
  }
  const dir = path.join(ROOT, "persona");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(dir, f), "utf8");
      if (!touched) { addNode(HUB, "person", hub.label); touched = true; }
      for (const target of links(content)) {
        const tid = norm(target);
        addNode(tid, "concept", target);
        addEdge(HUB, tid, 1, "EXTRACTED"); // user -> the concepts/projects they are about
      }
    }
  }
}

// ---- analytics ------------------------------------------------------------
function weightedDegree(id: string): number {
  let d = 0;
  g.forEachEdge(id, (_e, attr) => { d += (attr.weight as number) || 1; });
  return d;
}

function main() {
  ingestWiki();
  ingestJournals();
  ingestLibrary();
  ingestPersona();
  if (g.order === 0) { console.error("Empty graph. Run a backfill / link-entities first."); process.exit(1); }

  louvain.assign(g, { getEdgeWeight: "weight" });

  // finalize labels + degree
  g.forEachNode(id => {
    g.setNodeAttribute(id, "label", bestLabel(id));
    g.setNodeAttribute(id, "degree", weightedDegree(id));
  });
  // project spread: how many distinct projects a concept appears in (volume-independent importance)
  g.forEachNode(id => {
    let spread = 0;
    g.forEachNeighbor(id, nb => { if (g.getNodeAttribute(nb, "type") === "project") spread++; });
    g.setNodeAttribute(id, "projectSpread", spread);
  });

  const nodes = g.mapNodes((id, a) => ({
    id, label: a.label as string, type: a.type as string,
    community: a.community as number, degree: a.degree as number, projectSpread: a.projectSpread as number
  }));
  const edges = g.mapEdges((_e, a, s, t) => ({
    source: s, target: t, weight: a.weight as number, confidence: a.confidence as string
  }));

  // god nodes: ranked by project-spread (cross-cutting), not raw volume
  const godConcepts = nodes.filter(n => n.type === "concept")
    .sort((a, b) => (b.projectSpread - a.projectSpread) || (b.degree - a.degree)).slice(0, 25);

  // communities, named by their highest-degree member
  const comms = new Map<number, typeof nodes>();
  for (const n of nodes) { (comms.get(n.community) ?? comms.set(n.community, []).get(n.community)!).push(n); }
  const communities = [...comms.entries()].map(([c, members]) => {
    const sorted = members.sort((a, b) => b.degree - a.degree);
    return { id: c, name: sorted[0]!.label, size: members.length, top: sorted.slice(0, 8).map(m => m.label) };
  }).sort((a, b) => b.size - a.size);

  // bridges: concepts whose neighbors span the most distinct communities
  const commOf = new Map(nodes.map(n => [n.id, n.community]));
  const bridges = nodes.filter(n => n.type === "concept").map(n => {
    const cs = new Set<number>();
    g.forEachNeighbor(n.id, nb => cs.add(commOf.get(nb)!));
    return { label: n.label, communities: cs.size, degree: n.degree };
  }).filter(b => b.communities >= 2).sort((a, b) => b.communities - a.communities || b.degree - a.degree).slice(0, 20);

  // surprising connections: INFERRED concept<->concept edges across communities, by weight
  const surprises = edges
    .filter(e => e.confidence === "INFERRED" && commOf.get(e.source) !== commOf.get(e.target))
    .map(e => ({ a: bestLabel(e.source), b: bestLabel(e.target), weight: e.weight }))
    .sort((x, y) => y.weight - x.weight).slice(0, 20);

  const extracted = edges.filter(e => e.confidence === "EXTRACTED").length;
  const inferred = edges.length - extracted;
  const singletons = nodes.filter(n => n.degree <= 1 && n.type === "concept");

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "graph.json"), JSON.stringify({ nodes, edges, communities }, null, 2));
  writeReport({ nodes, edges, communities, godConcepts, bridges, surprises, extracted, inferred, singletons });
  writeHtml(nodes, edges, communities);

  console.log(`Graph built: ${nodes.length} nodes, ${edges.length} edges, ${communities.length} communities.`);
  console.log(`Top cross-cutting concept: ${godConcepts[0]?.label} (${godConcepts[0]?.projectSpread} projects). Top bridge: ${bridges[0]?.label} (${bridges[0]?.communities} clusters).`);
  console.log(`Output in ${OUT}\\  (graph.json, GRAPH_REPORT.md, graph.html)`);
}

function writeReport(d: any) {
  const L = (x: any) => `- ${x}`;
  const md = [
    `# LKHS Graph Report`,
    `> Generated by graph-build. ${d.nodes.length} nodes, ${d.edges.length} edges, ${d.communities.length} communities. Edge confidence: ${d.extracted} extracted, ${d.inferred} inferred.`,
    ``,
    `## God nodes (cross-cutting concepts)`,
    `Ranked by how many distinct projects they span, not raw volume. The threads that actually connect your work.`,
    ...d.godConcepts.map((n: any) => L(`**${n.label}** - ${n.projectSpread} projects (degree ${Math.round(n.degree)})`)),
    ``,
    `## Communities (auto-detected clusters)`,
    ...d.communities.slice(0, 15).map((c: any) => `### ${c.name} (${c.size} nodes)\n${c.top.map((t: string) => `- ${t}`).join("\n")}`),
    ``,
    `## Bridges (concepts spanning the most clusters)`,
    `Cross-cutting connectors: the same idea showing up across otherwise separate areas.`,
    ...d.bridges.map((b: any) => L(`**${b.label}** - spans ${b.communities} clusters (degree ${b.degree})`)),
    ``,
    `## Surprising connections (cross-cluster co-occurrences)`,
    ...d.surprises.map((s: any) => L(`${s.a} <-> ${s.b} (co-occurred ${s.weight}x, different clusters)`)),
    ``,
    `## Review (possible noise)`,
    `- ${d.singletons.length} concept nodes appear only once (possible typos or one-offs). Run with cleaner entity naming over time to reduce.`,
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "GRAPH_REPORT.md"), md + "\n");
}

function writeHtml(nodes: any[], edges: any[], communities: any[]) {
  // Interactive explorer. Balanced subset (top per community by project-spread then
  // degree) so it reads as structure, not a hairball; full detail is in graph.json.
  const PER_COMM = 24;
  const byComm = new Map<number, any[]>();
  for (const n of nodes) { (byComm.get(n.community) ?? byComm.set(n.community, []).get(n.community)!).push(n); }
  const kept: any[] = [];
  for (const [, members] of byComm) {
    members.sort((a, b) => (b.projectSpread - a.projectSpread) || (b.degree - a.degree));
    kept.push(...members.slice(0, PER_COMM));
  }
  const keep = new Set(kept.map(n => n.id));
  const shapeOf = (t: string) => t === "project" ? "box" : t === "page" ? "triangle" : t === "person" ? "star" : "dot";
  const vNodes = kept.map(n => ({
    id: n.id, label: n.label, value: 5 + n.projectSpread * 4 + Math.min(n.degree, 14), group: n.community,
    shape: shapeOf(n.type), type: n.type, comm: n.community,
    title: `${n.label}  -  ${n.type}, ${n.projectSpread} projects, degree ${Math.round(n.degree)}`
  }));
  const vEdges = edges.filter(e => keep.has(e.source) && keep.has(e.target) && (e.confidence === "EXTRACTED" || e.weight >= 0.5))
    .map(e => ({ from: e.source, to: e.target, value: e.weight, conf: e.confidence }));
  const keptCommIds = new Set(kept.map(n => n.community));
  const commList = communities.filter((c: any) => keptCommIds.has(c.id)).map((c: any) => ({ id: c.id, name: c.name, size: c.size }));
  const data = JSON.stringify({ nodes: vNodes, edges: vEdges, comms: commList });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Claude Mind - Knowledge Graph</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>
 html,body{margin:0;height:100%;background:#0d1117;color:#c9d1d9;font-family:system-ui,Segoe UI,sans-serif;overflow:hidden}
 #net{width:100vw;height:100vh}
 .panel{position:fixed;z-index:2;background:rgba(22,27,34,.94);border:1px solid #30363d;border-radius:8px;padding:10px 12px}
 #top{top:10px;left:12px;font-size:13px;max-width:48vw}
 #top b{color:#58a6ff}
 #ctrls{top:10px;right:12px;display:flex;gap:8px;align-items:center}
 #ctrls input,#ctrls select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 8px;font-size:13px}
 #ctrls input{width:200px}
 #side{right:12px;top:64px;width:300px;max-height:78vh;overflow:auto;display:none;font-size:13px;line-height:1.5}
 #side h3{margin:0 0 6px;font-size:15px;color:#58a6ff}
 #side .meta{color:#8b949e;font-size:12px;margin-bottom:8px}
 #side .nb{cursor:pointer;padding:2px 0;color:#c9d1d9}
 #side .nb:hover{color:#58a6ff}
 .legend{bottom:12px;left:12px;font-size:12px;color:#8b949e}
 .legend span{margin-right:12px}
</style></head>
<body>
<div id="net"></div>
<div id="top" class="panel">Claude Mind <b id="cnt"></b><br><span style="color:#8b949e">size = cross-cutting reach, color = cluster, shape = type. drag to explore, click a node.</span></div>
<div id="ctrls" class="panel">
  <input id="search" placeholder="search nodes...">
  <select id="commsel"><option value="all">all clusters</option></select>
  <button id="reset" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 8px;cursor:pointer">reset</button>
</div>
<div id="side" class="panel"></div>
<div class="legend panel"><span>&#9733; person</span><span>&#9632; project</span><span>&#9650; wiki page</span><span>&#9679; concept</span></div>
<script>
const D=${data};
const labelOf={}, typeOf={}, adj={};
D.nodes.forEach(function(n){labelOf[n.id]=n.label;typeOf[n.id]=n.type;adj[n.id]=[];});
D.edges.forEach(function(e){ if(adj[e.from]&&adj[e.to]){adj[e.from].push({id:e.to,w:e.value});adj[e.to].push({id:e.from,w:e.value});} });
const nodes=new vis.DataSet(D.nodes), edges=new vis.DataSet(D.edges);
document.getElementById('cnt').textContent=D.nodes.length+' nodes / '+D.edges.length+' links / '+D.comms.length+' clusters';
const sel=document.getElementById('commsel');
D.comms.sort(function(a,b){return b.size-a.size;}).forEach(function(c){var o=document.createElement('option');o.value=c.id;o.textContent=c.name+' ('+c.size+')';sel.appendChild(o);});
const net=new vis.Network(document.getElementById('net'),{nodes:nodes,edges:edges},{
  nodes:{scaling:{min:6,max:42},font:{color:'#c9d1d9',size:13,strokeWidth:3,strokeColor:'#0d1117'},borderWidth:1},
  edges:{color:{color:'#283039',highlight:'#58a6ff',hover:'#58a6ff'},smooth:false,width:0.5},
  physics:{barnesHut:{gravitationalConstant:-9000,springLength:130,springConstant:0.03},stabilization:{iterations:250}},
  interaction:{hover:true,tooltipDelay:120,navigationButtons:false}
});
function showSide(id){
  var s=document.getElementById('side');
  var nbs=(adj[id]||[]).slice().sort(function(a,b){return b.w-a.w;}).slice(0,18);
  var html='<h3>'+labelOf[id]+'</h3><div class="meta">'+typeOf[id]+'  -  '+nbs.length+' shown connections</div>';
  nbs.forEach(function(n){ html+='<div class="nb" data-id="'+n.id+'">'+labelOf[n.id]+'  <span style="color:#6e7681">'+n.w.toFixed(1)+'</span></div>'; });
  s.innerHTML=html; s.style.display='block';
  Array.prototype.forEach.call(s.querySelectorAll('.nb'),function(el){el.onclick=function(){focusNode(el.getAttribute('data-id'));};});
}
function focusNode(id){ net.selectNodes([id]); net.focus(id,{scale:1.3,animation:{duration:400}}); showSide(id); }
net.on('click',function(p){ if(p.nodes.length){showSide(p.nodes[0]);} else {document.getElementById('side').style.display='none';} });
document.getElementById('search').addEventListener('input',function(e){
  var q=e.target.value.toLowerCase().trim(); if(!q) return;
  var hit=D.nodes.find(function(n){return n.label.toLowerCase().indexOf(q)>=0;});
  if(hit) focusNode(hit.id);
});
sel.addEventListener('change',function(e){
  var v=e.target.value;
  nodes.update(D.nodes.map(function(n){return {id:n.id,hidden:(v!=='all'&&String(n.comm)!==String(v))};}));
});
document.getElementById('reset').onclick=function(){sel.value='all';nodes.update(D.nodes.map(function(n){return{id:n.id,hidden:false};}));document.getElementById('side').style.display='none';net.fit({animation:true});};
</script></body></html>`;
  fs.writeFileSync(path.join(OUT, "graph.html"), html);
}

main();
