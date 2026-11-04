/**
 * LKHS graph builder + analytics (ideas repurposed from graphify, reimplemented
 * for our markdown brain).
 *
 * Builds a weighted graph from:
 *   - wiki/*.md   : explicit [[links]] (EXTRACTED edges, document structure)
 *   - journal/*.md: per-session **Entities:** lists -> project->concept edges
 *                   (EXTRACTED) + concept<->concept co-occurrence (INFERRED)
 *   - persona_facts.jsonl : atomic facts bind the entities they name (TYPED edges,
 *                   relation = facet). Statements never enter the graph, only links.
 *
 * Then computes communities (Louvain + a Leiden-style connectivity refinement and
 * a second hierarchy level), "god nodes" (highest weighted degree), cross-community
 * "bridges"/surprising connections, a relation ontology, and confidence stats.
 *
 * G1 (2026-08-04): every node carries the FILES it was built from, so a graph walk
 * lands on retrievable chunks instead of bare labels; every edge carries relation
 * types plus first/last observation dates and an observation count, so the graph is
 * bi-temporal at the edge level (Graphiti-style) and the PPR retriever can ask
 * "as the graph stood in March".
 *
 * Outputs (in graph/): graph.json (full, minified), ppr-index.json (CSR adjacency
 * for the hot retrieval path), GRAPH_REPORT.md, graph.html (standalone viz).
 *
 *   npm run graph
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import * as fs from "fs";
import * as path from "path";
import { canonKey } from "./text-normalize";
import { vaultRoot, personaHub, memDir, clinicalLexicon } from "./config";

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

// G1: files backing each node. A graph walk is only useful for retrieval if a node
// can be turned back into text; concepts stay file-less (they are reached through
// the documents that mention them).
const nodeFiles: Record<string, Set<string>> = {};
function addNode(id: string, type: string, label: string, file?: string) {
  note(id, label);
  if (!g.hasNode(id)) g.addNode(id, { type, label });
  else if (type === "page" || type === "project" || type === "person") g.setNodeAttribute(id, "type", type); // docs/people win over concept
  if (file) (nodeFiles[id] ??= new Set()).add(file.replace(/\\/g, "/"));
}

// G1: edges are bi-temporal. `first`/`last` bracket the observation window and `obs`
// counts how many distinct times the link was seen, so a link asserted once in 2024
// is distinguishable from one restated every week. Relation types accumulate into a
// set (the ontology); untyped structural links carry no relation.
interface EdgeOpts { rel?: string; date?: string | null }
function addEdge(a: string, b: string, inc: number, confidence: "EXTRACTED" | "INFERRED", opts: EdgeOpts = {}) {
  if (a === b) return;
  const { rel, date } = opts;
  if (g.hasEdge(a, b)) {
    g.updateEdgeAttribute(a, b, "weight", (w: number) => (w || 0) + inc);
    g.updateEdgeAttribute(a, b, "obs", (n: number) => (n || 0) + 1);
    if (confidence === "EXTRACTED") g.setEdgeAttribute(a, b, "confidence", "EXTRACTED");
    if (rel) g.updateEdgeAttribute(a, b, "rel", (r: string[]) => (r || []).includes(rel) ? r : [...(r || []), rel]);
    if (date) {
      g.updateEdgeAttribute(a, b, "first", (d: string) => (!d || date < d) ? date : d);
      g.updateEdgeAttribute(a, b, "last", (d: string) => (!d || date > d) ? date : d);
    }
  } else {
    g.addEdge(a, b, {
      weight: inc, confidence, obs: 1,
      rel: rel ? [rel] : [], first: date || null, last: date || null
    });
  }
}

// ISO date (YYYY-MM-DD) or year, whichever the source offers. Anything else -> null,
// never a fabricated date: an undated edge is honestly undated.
const isoDate = (s?: string | null): string | null => {
  if (!s) return null;
  const m = String(s).match(/(\d{4}-\d{2}-\d{2})/) || String(s).match(/^(\d{4})(?:$|[^\d])/);
  return m ? m[1]! : null;
};

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
function frontmatterDate(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  return isoDate(m[1]?.match(/^updated:\s*(.+)$/m)?.[1] ?? m[1]?.match(/^created:\s*(.+)$/m)?.[1]);
}

// ---- ingest wiki ----------------------------------------------------------
function ingestWiki() {
  const dir = path.join(ROOT, "wiki");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    const rel = `wiki/${f}`;
    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const title = frontmatterTitle(content, f.replace(/\.md$/, "").replace(/-/g, " "));
    const date = frontmatterDate(content);
    const pid = norm(title);
    addNode(pid, "page", title, rel);
    for (const target of links(content)) {
      const tid = norm(target);
      addNode(tid, "concept", target);
      addEdge(pid, tid, 1, "EXTRACTED", { rel: "links", date });
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
    // A project node is backed by every artifact that describes it: the session
    // journal, its L2 state card, and its library digest if present. This is what
    // makes a project-node hit in the PPR walk resolve to the right passages.
    addNode(prid, "project", project, `journal/${f}`);
    for (const alt of [`cards/${f}`, `library/${f}`]) if (fs.existsSync(path.join(ROOT, alt))) addNode(prid, "project", project, alt);

    const content = fs.readFileSync(path.join(dir, f), "utf8");
    const entries = content.split(/^## (?=\d{4}-)/m).slice(1); // each session entry
    for (const entry of entries) {
      const date = isoDate(entry.slice(0, 11));                       // the `## YYYY-MM-DD ...` header we just split on
      const entLine = entry.match(/^\*\*Entities:\*\*\s*(.+)$/m)?.[1];
      if (!entLine) continue;
      const ents = links(entLine);
      const ids = ents.map(e => { const id = norm(e); addNode(id, "concept", e); return id; });
      for (const id of ids) addEdge(prid, id, 1, "EXTRACTED", { rel: "mentions", date }); // project mentions concept
      const w = 1 / Math.max(1, ids.length - 1);                      // dampen so a big entry's clique does not dominate
      for (let i = 0; i < ids.length; i++)                            // concept co-occurrence
        for (let j = i + 1; j < ids.length; j++) addEdge(ids[i]!, ids[j]!, w, "INFERRED", { rel: "co-occurs", date });
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
    const date = frontmatterDate(content);
    const prid = norm(title);
    addNode(prid, "project", title, `library/${f}`);
    for (const target of links(content)) {
      const tid = norm(target);
      addNode(tid, "concept", target);
      addEdge(prid, tid, 1, "EXTRACTED", { rel: "describes", date });
    }
  }
}

// ---- ingest cards + themes (the L2/L3 synthesized layers) -----------------
// These are the "community summary" tier GraphRAG builds with an LLM; LKHS already
// authors them, they were just invisible to the graph. Wiring them in means a
// thematic walk can land on a theme card instead of only on raw session prose.
function ingestSynth() {
  for (const [sub, type] of [["cards", "project"], ["themes", "theme"]] as const) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md") || f === "README.md") continue;
      const relPath = `${sub}/${f}`;
      const content = fs.readFileSync(path.join(dir, f), "utf8");
      // Card/theme frontmatter titles are decorated ("ClaudeMind - state card",
      // "theme - ClaudeMind"). The `project:` field is the undecorated truth; fall
      // back to stripping the decoration. Without this the card lands as a SEPARATE
      // isolated node instead of merging its files onto the project it describes.
      const explicit = content.match(/^---\n[\s\S]*?^project:\s*(.+)$/m)?.[1]?.trim();
      const title = explicit || frontmatterTitle(content, f.replace(/\.md$/, ""))
        .replace(/^theme\s*-\s*/i, "").replace(/\s*-\s*(state card|theme card|card)$/i, "").trim();
      const date = frontmatterDate(content);
      const id = norm(title);
      addNode(id, type, title, relPath);
      for (const target of links(content)) {
        const tid = norm(target);
        addNode(tid, "concept", target);
        addEdge(id, tid, 1, "EXTRACTED", { rel: type === "theme" ? "themes" : "state-of", date });
      }
    }
  }
}

// ---- ingest facts (typed, bi-temporal, statement-free) --------------------
// MemGraphRAG's ontology layer, adapted: the fact ledger already holds atomic,
// dated, scoped assertions. Each fact BINDS the entities it names, with the facet
// as the relation type and the fact's own validity window as the edge date. The
// statement text never enters graph.json (it is a committed artifact and facts carry
// scope); only links between labels that are already public in the graph. Clinical
// facts and facts already superseded are excluded outright.
function ingestFacts() {
  const file = path.join(memDir(), "persona_facts.jsonl");
  if (!fs.existsSync(file)) return { facts: 0, edges: 0 };
  const HUB = norm(personaHub().label);
  // Same content classifier persona-facts.ts uses, so the graph's clinical guard
  // cannot drift from the ledger's.
  const CLIN = clinicalLexicon();
  const isClinical = (s: string) =>
    CLIN.med.test(s) || CLIN.coping.test(s) ||
    (CLIN.crisis.test(s) && !CLIN.advocacyGuard.test(s) && !CLIN.academicGuard.test(s));
  // Candidate vocabulary = labels already in the graph, longest-first so
  // "a second paper" wins over "a paper project" on the same span.
  const vocab = g.mapNodes((id, a) => ({ id, k: canonKey(String(a.label || "")) }))
    .filter(v => v.k.length >= 6 && v.id !== HUB)
    .sort((a, b) => b.k.length - a.k.length);
  let facts = 0, edges = 0;
  const before = g.size;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let f: any; try { f = JSON.parse(line); } catch { continue; }
    if (!f?.statement) continue;
    if (f.sensitivity === "clinical" || String(f.scope || "") === "clinical") continue;
    if (isClinical(String(f.statement))) continue;                    // belt-and-braces clinical guard
    if (f.invalid_at && isoDate(f.invalid_at) && isoDate(f.invalid_at)! < new Date().toISOString().slice(0, 10)) continue; // expired
    const k = canonKey(f.statement);
    const named: string[] = [];
    for (const v of vocab) { if (named.length >= 4) break; if (k.includes(v.k) && !named.includes(v.id)) named.push(v.id); }
    if (!named.length) continue;
    facts++;
    const date = isoDate(f.valid_at) || isoDate(f.t_event) || isoDate(f.created);
    const rel = `fact:${f.facet || "unknown"}`;
    const w = 0.5 * (typeof f.confidence === "number" ? Math.max(0.3, f.confidence) : 0.7);
    for (const id of named) addEdge(HUB, id, w, "EXTRACTED", { rel, date });      // the fact is about the user
    for (let i = 0; i < named.length; i++)                                        // and it binds what it names
      for (let j = i + 1; j < named.length; j++) addEdge(named[i]!, named[j]!, w, "EXTRACTED", { rel, date });
  }
  edges = g.size - before;
  return { facts, edges };
}

// ---- ingest persona (the user as a first-class hub) -----------------------
// the user is the center of his own knowledge graph: connect him to the people in
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
      addNode(HUB, "person", hub.label, `persona/${f}`);   // the hub resolves to the persona docs
      const date = frontmatterDate(content);
      for (const target of links(content)) {
        const tid = norm(target);
        addNode(tid, "concept", target);
        addEdge(HUB, tid, 1, "EXTRACTED", { rel: "about", date }); // the user -> the concepts/projects he is about
      }
    }
  }
}

// ---- Leiden-style refinement ----------------------------------------------
// graphology ships Louvain, not Leiden. The property Leiden actually buys over
// Louvain is the guarantee that every community is INTERNALLY CONNECTED (its
// refinement phase); Louvain can and does emit communities whose members have no
// path to each other through the community, which makes any summary of that
// community incoherent. We get the same guarantee directly: split each Louvain
// community into its connected components and promote each component to its own
// community. This is a refinement, not the Leiden algorithm, and it is applied
// after Louvain rather than inside its aggregation loop.
function refineConnectivity(): { split: number; before: number } {
  const members = new Map<number, string[]>();
  g.forEachNode((id, a) => {
    const c = a.community as number;
    (members.get(c) ?? members.set(c, []).get(c)!).push(id);
  });
  const before = members.size;
  let next = Math.max(...members.keys()) + 1, split = 0;
  for (const [, ids] of members) {
    const inComm = new Set(ids);
    const seen = new Set<string>();
    const components: string[][] = [];
    for (const start of ids) {
      if (seen.has(start)) continue;
      const comp: string[] = [], stack = [start];
      seen.add(start);
      while (stack.length) {                                  // traversal restricted to the community
        const cur = stack.pop()!;
        comp.push(cur);
        g.forEachNeighbor(cur, nb => { if (inComm.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); } });
      }
      components.push(comp);
    }
    if (components.length <= 1) continue;                     // already internally connected
    components.sort((a, b) => b.length - a.length);           // the largest fragment keeps the original id
    for (const comp of components.slice(1)) {
      const id = next++;
      split++;
      for (const n of comp) g.setNodeAttribute(n, "community", id);
    }
  }
  return { split, before };
}

// Second hierarchy level: re-run Louvain INSIDE each community that is large enough
// to have internal structure. GraphRAG's local/global split needs a hierarchy to
// route through; one flat level of 14 clusters over 4.5k nodes is too coarse to be
// a retrieval unit. Leaf communities (too small to partition) keep sub = -1.
const MIN_SUBCLUSTER = 40;
function assignSubcommunities(): number {
  const members = new Map<number, string[]>();
  g.forEachNode((id, a) => { const c = a.community as number; (members.get(c) ?? members.set(c, []).get(c)!).push(id); });
  let total = 0;
  for (const [, ids] of members) {
    if (ids.length < MIN_SUBCLUSTER) { for (const n of ids) g.setNodeAttribute(n, "sub", -1); continue; }
    const sub = new Graph({ type: "undirected" });
    for (const n of ids) sub.addNode(n);
    const inComm = new Set(ids);
    g.forEachEdge((_e, attr, s, t) => {
      if (inComm.has(s) && inComm.has(t) && !sub.hasEdge(s, t)) sub.addEdge(s, t, { weight: attr.weight || 1 });
    });
    try {
      louvain.assign(sub, { getEdgeWeight: "weight" });
      const seenSub = new Set<number>();
      sub.forEachNode((n, a) => { const c = a.community as number; seenSub.add(c); g.setNodeAttribute(n, "sub", c); });
      total += seenSub.size;
    } catch { for (const n of ids) g.setNodeAttribute(n, "sub", -1); }
  }
  return total;
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
  ingestSynth();
  ingestPersona();
  if (g.order === 0) { console.error("Empty graph. Run a backfill / link-entities first."); process.exit(1); }
  const factStats = ingestFacts();   // last: binds only labels the structural passes already created

  louvain.assign(g, { getEdgeWeight: "weight" });
  const refined = refineConnectivity();
  const subCount = assignSubcommunities();

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
    community: a.community as number, sub: (a.sub ?? -1) as number,
    degree: a.degree as number, projectSpread: a.projectSpread as number,
    files: [...(nodeFiles[id] ?? [])]
  }));
  const edges = g.mapEdges((_e, a, s, t) => ({
    source: s, target: t, weight: a.weight as number, confidence: a.confidence as string,
    rel: (a.rel as string[]) ?? [], first: (a.first as string) ?? null, last: (a.last as string) ?? null,
    obs: (a.obs as number) ?? 1
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

  // Relation ontology: which link types the corpus actually produces, by frequency.
  // MemGraphRAG's ontology layer, learned rather than declared.
  const ontology = new Map<string, number>();
  for (const e of edges) for (const r of e.rel.length ? e.rel : ["untyped"]) ontology.set(r, (ontology.get(r) ?? 0) + 1);
  const ontologyRows = [...ontology.entries()].sort((a, b) => b[1] - a[1]);

  // Temporal: dormant vs live links. An edge last observed 6 months ago is a fact
  // about the past; one restated last week is a live thread.
  const dated = edges.filter(e => e.last);
  const cut = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const dormant = dated.filter(e => e.last! < cut).length;
  const fresh = dated.length - dormant;
  const rising = dated.filter(e => e.last! >= cut && e.obs >= 3)
    .map(e => ({ a: bestLabel(e.source), b: bestLabel(e.target), obs: e.obs, last: e.last! }))
    .sort((x, y) => y.obs - x.obs).slice(0, 15);

  const withFiles = nodes.filter(n => n.files.length).length;

  fs.mkdirSync(OUT, { recursive: true });
  // Minified: this file is loaded per rebuild by the daemon and per call by the MCP
  // server. Pretty-printing it cost ~3.5MB of parse for nobody's benefit.
  fs.writeFileSync(path.join(OUT, "graph.json"), JSON.stringify({ nodes, edges, communities }));
  writePprIndex(nodes, edges);
  writeReport({ nodes, edges, communities, godConcepts, bridges, surprises, extracted, inferred, singletons,
    ontologyRows, dormant, fresh, undated: edges.length - dated.length, rising, refined, subCount, factStats, withFiles });
  writeHtml(nodes, edges, communities);

  console.log(`Graph built: ${nodes.length} nodes, ${edges.length} edges, ${communities.length} communities (${refined.before} pre-refinement, ${refined.split} disconnected fragments split out, ${subCount} sub-communities).`);
  console.log(`Retrievable: ${withFiles} nodes carry files. Facts: ${factStats.facts} bound ${factStats.edges} new typed edges. Temporal: ${fresh} live / ${dormant} dormant / ${edges.length - dated.length} undated edges.`);
  console.log(`Top cross-cutting concept: ${godConcepts[0]?.label} (${godConcepts[0]?.projectSpread} projects). Top bridge: ${bridges[0]?.label} (${bridges[0]?.communities} clusters).`);
  console.log(`Output in ${OUT}\\  (graph.json, ppr-index.json, GRAPH_REPORT.md, graph.html)`);
}

/**
 * CSR adjacency for the retrieval hot path. graph.json is the analytics artifact
 * (7MB+, every attribute); the retriever needs offsets/targets/weights and nothing
 * else, so it gets a compact index it can parse in a few ms and keep resident.
 * Layout: parallel arrays indexed by node ordinal, plus the standard CSR pair
 * (off[i]..off[i+1] slices tgt/w). `last` is the per-edge recency for as-of walks.
 */
function writePprIndex(nodes: any[], edges: any[]) {
  const idx = new Map<string, number>(nodes.map((n, i) => [n.id, i]));
  const deg = new Array(nodes.length).fill(0);
  for (const e of edges) { deg[idx.get(e.source)!]++; deg[idx.get(e.target)!]++; }
  const off = new Array(nodes.length + 1).fill(0);
  for (let i = 0; i < nodes.length; i++) off[i + 1] = off[i] + deg[i];
  const cur = off.slice(0, nodes.length);
  const tgt = new Array(off[nodes.length]).fill(0);
  const w = new Array(off[nodes.length]).fill(0);
  const last = new Array(off[nodes.length]).fill(0);
  // Dates as YYYYMMDD ints, 0 = undated: comparable with <=, and a third the bytes
  // of quoted ISO strings across ~98k directed entries.
  const dnum = (d: string | null) => d ? Number(d.length === 4 ? `${d}0101` : d.replace(/-/g, "")) : 0;
  for (const e of edges) {
    const a = idx.get(e.source)!, b = idx.get(e.target)!;
    const wt = Number(((e.weight as number) || 1).toFixed(3));
    const ld = dnum(e.last);
    tgt[cur[a]] = b; w[cur[a]] = wt; last[cur[a]] = ld; cur[a]++;
    tgt[cur[b]] = a; w[cur[b]] = wt; last[cur[b]] = ld; cur[b]++;
  }
  fs.writeFileSync(path.join(OUT, "ppr-index.json"), JSON.stringify({
    v: 1,
    id: nodes.map(n => n.id),
    label: nodes.map(n => n.label),
    type: nodes.map(n => n.type),
    files: nodes.map(n => n.files),
    comm: nodes.map(n => n.community),
    off, tgt, w, last
  }));
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
    `## Relation ontology (learned, not declared)`,
    `Link types the corpus actually produces, by frequency. \`fact:*\` types come from the persona fact ledger; the rest are structural.`,
    ...d.ontologyRows.map(([r, n]: [string, number]) => L(`\`${r}\` - ${n} edges`)),
    ``,
    `## Temporal state`,
    `Edges carry the window in which the link was observed, so the graph distinguishes what is live from what is history.`,
    L(`${d.fresh} live edges (observed in the last 90 days), ${d.dormant} dormant, ${d.undated} undated`),
    ``,
    `### Live threads (repeatedly restated, recently)`,
    ...d.rising.map((r: any) => L(`${r.a} <-> ${r.b} - ${r.obs} observations, last ${r.last}`)),
    ``,
    `## Retrieval readiness`,
    L(`${d.withFiles} of ${d.nodes.length} nodes resolve to source files (a graph walk lands on retrievable text, not bare labels)`),
    L(`${d.factStats.facts} persona facts bound entities, adding ${d.factStats.edges} typed edges`),
    L(`Community refinement: ${d.refined.before} Louvain communities -> ${d.communities.length} after splitting ${d.refined.split} internally-disconnected fragments; ${d.subCount} sub-communities at level 2`),
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
