/**
 * graph-ppr.ts — Personalized PageRank over the LKHS knowledge graph.
 *
 * WHY: the bi-encoder finds passages that LOOK like the query; the cross-encoder
 * judges whether they answer it. Neither can reach a passage that shares no
 * vocabulary with the prompt but is two links away in the graph. That is the
 * multi-hop associative gap HippoRAG was built to close, and until now the LKHS
 * graph was an analytics artifact that never touched retrieval.
 *
 * WHAT: entities named in the prompt seed a random walk with restart over
 * graph/ppr-index.json (CSR adjacency, built by graph-build). The stationary
 * distribution ranks every node by how strongly it is associated with what the
 * prompt named. Nodes that carry FILES become direct retrieval targets; high-mass
 * concept nodes become lexical expansion terms. No LLM in the loop, no embedding
 * call, single-digit milliseconds.
 *
 * The walk is deliberately NOT a substitute for the vector pool. It is a second
 * recall channel merged into the same candidate pool, and the cross-encoder still
 * judges everything against the original prompt on the calibrated scale.
 *
 * Also exposes connectPaths(): weighted shortest paths between two entities, which
 * answers "what connects X and Y" — a question neither vector search nor community
 * summarization can answer, because the answer is a path, not a passage.
 */
import * as fs from "fs";
import * as path from "path";
import { canonKey } from "./text-normalize";
import { vaultRoot } from "./config";

export interface PprIndex {
  v: number;
  id: string[]; label: string[]; type: string[]; files: string[][]; comm: number[];
  off: number[]; tgt: number[]; w: number[]; last: number[];
  /** canonKey(label) -> ordinal, built on load */
  keyOf: Map<string, number>;
  /** canonical keys sorted longest-first, for greedy longest-match seeding */
  keys: string[];
  /** background (uniform-restart) PageRank, computed once per load — see lift() */
  bg?: Float64Array;
  /** vault-relative file -> node ordinal, for seeding the walk from retrieved passages */
  fileOf?: Map<string, number>;
}

const INDEX_PATH = () => path.join(vaultRoot(), "graph", "ppr-index.json");

let _idx: PprIndex | null = null;
let _mtime = -1;

/** Load (or reuse) the CSR index. Reloaded only when graph-build rewrites it. */
export function loadIndex(): PprIndex | null {
  try {
    const p = INDEX_PATH();
    const mtime = fs.statSync(p).mtimeMs;
    if (_idx && mtime === _mtime) return _idx;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    const keyOf = new Map<string, number>();
    for (let i = 0; i < raw.label.length; i++) {
      const k = canonKey(String(raw.label[i] || ""));
      if (k && !keyOf.has(k)) keyOf.set(k, i);
    }
    const fileOf = new Map<string, number>();
    for (let i = 0; i < raw.files.length; i++)
      for (const f of raw.files[i] || []) if (!fileOf.has(f)) fileOf.set(f, i);
    _idx = { ...raw, keyOf, fileOf, keys: [...keyOf.keys()].sort((a, b) => b.length - a.length) };
    _mtime = mtime;
    return _idx;
  } catch { return null; }
}

/**
 * Entities named in the prompt, greedy longest-match so "a second paper"
 * consumes the span instead of matching bare "a paper project" as well. MIN_KEY guards
 * against generic short tokens seeding the whole graph.
 */
const MIN_KEY = 5;
export function seedsFor(prompt: string, idx: PprIndex, maxSeeds = 6): number[] {
  const pk = canonKey(prompt);
  if (!pk) return [];
  const taken: Array<[number, number]> = [];   // claimed [start,end) spans
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && a < e);
  const out: number[] = [];
  for (const k of idx.keys) {
    if (k.length < MIN_KEY || out.length >= maxSeeds) continue;
    const at = pk.indexOf(k);
    if (at < 0 || overlaps(at, at + k.length)) continue;
    taken.push([at, at + k.length]);
    out.push(idx.keyOf.get(k)!);
  }
  return out;
}

export interface PprOpts {
  /** restart probability; higher = tighter around the seeds. 0.15 is the PageRank default. */
  alpha?: number;
  iters?: number;
  /** drop edges last observed after this YYYYMMDD... no: BEFORE this cut. 0 = no filter. */
  sinceDay?: number;
  /** only walk edges observed on or before this day (as-of queries). 0 = no filter. */
  asOfDay?: number;
}

/**
 * Power iteration for PPR. Returns the mass vector. Cheap: ~50k edges x 20 iters is
 * a few ms, and it touches no model and no disk after the cached index load.
 */
export function ppr(idx: PprIndex, seeds: number[], opts: PprOpts & { seedWeights?: number[] } = {}): Float64Array {
  const n = idx.id.length;
  const mass = new Float64Array(n);
  if (!seeds.length) return mass;
  const alpha = opts.alpha ?? 0.15;
  const iters = opts.iters ?? 20;
  const { sinceDay = 0, asOfDay = 0 } = opts;

  const restart = new Float64Array(n);
  const wts = opts.seedWeights && opts.seedWeights.length === seeds.length ? opts.seedWeights : seeds.map(() => 1);
  const wsum = wts.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < seeds.length; i++) restart[seeds[i]!] = wts[i]! / wsum;
  mass.set(restart);
  const next = new Float64Array(n);

  // Row sums honour the same temporal filter as the walk, so a filtered node's mass
  // is redistributed over its surviving edges instead of leaking.
  const rowSum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let e = idx.off[i]!; e < idx.off[i + 1]!; e++) {
      const d = idx.last[e]!;
      if (sinceDay && d && d < sinceDay) continue;
      if (asOfDay && d && d > asOfDay) continue;
      s += idx.w[e]!;
    }
    rowSum[i] = s;
  }

  for (let it = 0; it < iters; it++) {
    next.fill(0);
    for (let i = 0; i < n; i++) {
      const m = mass[i]!;
      if (m === 0) continue;
      const rs = rowSum[i]!;
      if (rs === 0) { next[i]! += m; continue; }         // dangling: keep mass in place
      const share = (m * (1 - alpha)) / rs;
      for (let e = idx.off[i]!; e < idx.off[i + 1]!; e++) {
        const d = idx.last[e]!;
        if (sinceDay && d && d < sinceDay) continue;
        if (asOfDay && d && d > asOfDay) continue;
        next[idx.tgt[e]!]! += share * idx.w[e]!;
      }
    }
    for (let i = 0; i < n; i++) next[i]! += alpha * restart[i]!;
    mass.set(next);
  }
  return mass;
}

/**
 * Background PageRank: the walk with a UNIFORM restart, i.e. what every query would
 * score if the prompt said nothing. Needed because this graph has extreme hubs — the
 * ClaudeMind project node has degree ~1950 and the user is the graph's centre by
 * construction — so raw PPR mass ranks the same handful of hubs first no matter what
 * was asked. Dividing by the background turns "how much mass" into "how much MORE
 * mass than usual", which is the signal that actually distinguishes queries.
 * Computed once per index load and cached on the index object (~10ms).
 */
function background(idx: PprIndex): Float64Array {
  if (idx.bg) return idx.bg;
  const n = idx.id.length;
  const uniform = 1 / n;
  let mass = new Float64Array(n).fill(uniform);
  const next = new Float64Array(n);
  const rowSum = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let e = idx.off[i]!; e < idx.off[i + 1]!; e++) s += idx.w[e]!; rowSum[i] = s; }
  for (let it = 0; it < 30; it++) {
    next.fill(0);
    for (let i = 0; i < n; i++) {
      const m = mass[i]!;
      if (m === 0) continue;
      const rs = rowSum[i]!;
      if (rs === 0) { next[i]! += m; continue; }
      const share = (m * 0.85) / rs;
      for (let e = idx.off[i]!; e < idx.off[i + 1]!; e++) next[idx.tgt[e]!]! += share * idx.w[e]!;
    }
    for (let i = 0; i < n; i++) next[i]! += 0.15 * uniform;
    mass = Float64Array.from(next);
  }
  idx.bg = mass;
  return mass;
}

/**
 * Ranking score. `beta` interpolates between raw mass (0, hub-dominated) and full
 * lift (1, obscure-node-dominated); 0.75 measured best on this graph — it keeps
 * genuinely central answers while letting topic-specific nodes outrank the hubs.
 */
const DEFAULT_BETA = 0.75;
function scoreOf(mass: Float64Array, bg: Float64Array, i: number, beta: number): number {
  const b = bg[i]! || 1e-12;
  return mass[i]! / Math.pow(b, beta);
}

export interface PprResult {
  seeds: Array<{ label: string; type: string }>;
  /** file-backed nodes ranked by PPR mass: direct retrieval targets */
  files: Array<{ file: string; label: string; type: string; mass: number }>;
  /** high-mass nodes with no file: lexical expansion terms */
  terms: Array<{ label: string; type: string; mass: number }>;
}

/**
 * Full query path: prompt -> seeds -> walk -> (files to retrieve, terms to expand).
 * Seeds are excluded from `terms` (the prompt already says them) but NOT from
 * `files` (the named project's own card is usually the best single answer).
 */
export function pprQuery(
  prompt: string,
  opts: PprOpts & {
    maxFiles?: number; maxTerms?: number; beta?: number;
    /**
     * Files the dense retriever already returned, best first. HippoRAG 2's actual
     * design: the walk is seeded from RETRIEVED PASSAGES, not only from entities
     * spotted in the query string. Without this the channel is dead exactly when it
     * is needed most — a question like "what deadline is driving my postgraduate
     * application" names no entity at all, so string-matching finds no seed, while
     * the top dense hit is sitting on the right node.
     */
    anchorFiles?: string[];
  } = {}
): PprResult | null {
  const idx = loadIndex();
  if (!idx) return null;
  const named = seedsFor(prompt, idx);
  const anchors: number[] = [];
  for (const f of opts.anchorFiles || []) {
    const i = idx.fileOf?.get(f.replace(/\\/g, "/"));
    if (i !== undefined && !named.includes(i) && !anchors.includes(i)) anchors.push(i);
    if (anchors.length >= 3) break;
  }
  const seeds = [...named, ...anchors];
  if (!seeds.length) return null;
  // An entity the user typed is a stronger statement of intent than a passage the
  // embedder happened to rank first, so named seeds carry more restart mass.
  const seedWeights = [...named.map(() => 1), ...anchors.map(() => 0.4)];
  const mass = ppr(idx, seeds, { ...opts, seedWeights });
  const bg = background(idx);
  const beta = opts.beta ?? DEFAULT_BETA;
  const seedSet = new Set(seeds);

  // Mass floor before lift: a node the walk barely reached must not rank first
  // merely because its background is microscopic.
  const floor = 1e-6;
  const order = Array.from(mass.keys()).filter(i => mass[i]! > floor)
    .sort((a, b) => scoreOf(mass, bg, b, beta) - scoreOf(mass, bg, a, beta));
  const files: PprResult["files"] = [];
  const terms: PprResult["terms"] = [];
  const seenFile = new Set<string>();
  const maxFiles = opts.maxFiles ?? 12, maxTerms = opts.maxTerms ?? 8;

  for (const i of order) {
    if (files.length >= maxFiles && terms.length >= maxTerms) break;
    const nodeFiles = idx.files[i] || [];
    const s = scoreOf(mass, bg, i, beta);
    if (nodeFiles.length) {
      for (const f of nodeFiles) {
        if (files.length >= maxFiles || seenFile.has(f)) continue;
        seenFile.add(f);
        files.push({ file: f, label: idx.label[i]!, type: idx.type[i]!, mass: s });
      }
    } else if (!seedSet.has(i) && terms.length < maxTerms) {
      terms.push({ label: idx.label[i]!, type: idx.type[i]!, mass: s });
    }
  }
  return { seeds: seeds.map(s => ({ label: idx.label[s]!, type: idx.type[s]! })), files, terms };
}

// ---- connector queries ------------------------------------------------------

export interface PathHop { label: string; type: string }
export interface Connection {
  path: PathHop[];
  /** product of edge weights along the path; higher = better attested route */
  strength: number;
}

/** Resolve a free-text name to a node ordinal (exact canon key, then containment). */
export function resolveNode(idx: PprIndex, name: string): number | null {
  const k = canonKey(name);
  if (!k) return null;
  const exact = idx.keyOf.get(k);
  if (exact !== undefined) return exact;
  let best: number | null = null, bestLen = Infinity;
  for (const cand of idx.keys) {
    if (cand.includes(k) || k.includes(cand)) {
      const i = idx.keyOf.get(cand)!;
      if (cand.length < bestLen) { best = i; bestLen = cand.length; }
    }
  }
  return best;
}

/**
 * The K best routes between two nodes.
 *
 * Cost is -log P(step), where P is the random-walk transition probability
 * w_uv / sum_v w_uv, NOT -log(weight). Two reasons that matters: raw weights here
 * exceed 1 (a project/concept link accumulates one unit per session), which would
 * make -log(w) NEGATIVE and silently invalidate Dijkstra; and a probability cost
 * penalizes hubs for free — a step through the ClaudeMind node (degree ~1950)
 * carries almost no probability, so routes prefer specific connectors over
 * "everything touches ClaudeMind". Path strength is then the honest probability
 * that a walk from X follows this exact route to Y.
 */
const DEGENERATE = new Set(["unknown", "none", "n a", "na", "misc", "other"]);

export function connectPaths(
  a: string, b: string, k = 3, maxHops = 4,
  opts: { allowHubs?: boolean } = {}
): { from: string; to: string; paths: Connection[]; shared: Array<{ label: string; type: string }>; viaHubs: boolean } | null {
  const idx = loadIndex();
  if (!idx) return null;
  const s = resolveNode(idx, a), t = resolveNode(idx, b);
  if (s === null || t === null) return null;
  const n = idx.id.length;
  const rowSum = new Float64Array(n);
  const degree = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0; for (let e = idx.off[i]!; e < idx.off[i + 1]!; e++) x += idx.w[e]!;
    rowSum[i] = x; degree[i] = idx.off[i + 1]! - idx.off[i]!;
  }
  // Hub suppression. "X and Y are connected because both are the user's work" is true
  // of every pair in this graph and therefore explains nothing. Routing through the
  // top-degree nodes is banned on the first attempt; if no route survives, we retry
  // with hubs allowed and say so (viaHubs), rather than claiming no connection.
  const sortedDeg = Array.from(degree).sort((x, y) => y - x);
  const HUB_DEG = sortedDeg[Math.min(sortedDeg.length - 1, Math.floor(n * 0.002))] ?? Infinity; // top ~0.2%
  const hubBan = new Set<number>();
  if (!opts.allowHubs) for (let i = 0; i < n; i++) if (degree[i]! >= HUB_DEG && i !== s && i !== t) hubBan.add(i);

  const search = (banned: Set<number>): Connection | null => {
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const hops = new Int32Array(n).fill(0);
    const done = new Uint8Array(n);
    dist[s] = 0;
    // Linear-scan frontier: n is a few thousand and paths are short, so a binary heap
    // buys nothing measurable here and costs a dependency.
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < best) { best = dist[i]!; u = i; }
      if (u === -1 || u === t) break;
      done[u] = 1;
      if (hops[u]! >= maxHops) continue;
      const rs = rowSum[u]! || 1;
      for (let e = idx.off[u]!; e < idx.off[u + 1]!; e++) {
        const v = idx.tgt[e]!;
        if (done[v] || banned.has(v)) continue;
        if (v !== t && DEGENERATE.has(canonKey(idx.label[v]!))) continue;   // placeholder nodes explain nothing
        const cost = dist[u]! - Math.log(Math.max(1e-12, idx.w[e]! / rs));  // always positive: P <= 1
        if (cost < dist[v]!) { dist[v] = cost; prev[v] = u; hops[v] = hops[u]! + 1; }
      }
    }
    if (!isFinite(dist[t]!)) return null;
    const path: PathHop[] = [];
    for (let cur = t; cur !== -1; cur = prev[cur]!) {
      path.unshift({ label: idx.label[cur]!, type: idx.type[cur]! });
      if (cur === s) break;
    }
    return { path, strength: Math.exp(-dist[t]!) };
  };

  const collect = (base: Set<number>): Connection[] => {
    const paths: Connection[] = [];
    const banned = new Set(base);
    const seen = new Set<string>();
    for (let round = 0; round < k * 2 && paths.length < k; round++) {
      const found = search(banned);
      if (!found) break;
      const sig = found.path.map(h => h.label).join(">");
      if (!seen.has(sig)) { seen.add(sig); paths.push(found); }
      // Force the next round to detour: ban the intermediate this route leans on most
      // (the highest-degree one, i.e. the least informative connector).
      const mid = found.path.slice(1, -1);
      if (!mid.length) break;
      let banAt = -1, banDeg = -1;
      for (const h of mid) {
        const i = resolveNode(idx, h.label);
        if (i === null || banned.has(i)) continue;
        if (degree[i]! > banDeg) { banDeg = degree[i]!; banAt = i; }
      }
      if (banAt < 0) break;
      banned.add(banAt);
    }
    return paths;
  };

  let paths = collect(hubBan);
  let viaHubs = false;
  if (!paths.length && hubBan.size) { paths = collect(new Set()); viaHubs = true; }

  // Shared neighbours: often a better answer than any path. Ranked by the weaker of
  // the two link weights (a connector both sides lean on beats one side's favourite),
  // hubs excluded for the same reason they are excluded from routes.
  const nbrW = (i: number) => { const m = new Map<number, number>(); for (let e = idx.off[i]!; e < idx.off[i + 1]!; e++) m.set(idx.tgt[e]!, Math.max(m.get(idx.tgt[e]!) ?? 0, idx.w[e]!)); return m; };
  const na = nbrW(s), nb = nbrW(t);
  const shared = [...na.entries()]
    .filter(([i]) => nb.has(i) && !hubBan.has(i) && i !== s && i !== t)
    .map(([i, w]) => ({ i, min: Math.min(w, nb.get(i)!) }))
    .sort((x, y) => y.min - x.min).slice(0, 8)
    .map(({ i }) => ({ label: idx.label[i]!, type: idx.type[i]! }));

  return { from: idx.label[s]!, to: idx.label[t]!, paths: paths.sort((x, y) => y.strength - x.strength), shared, viaHubs };
}

// ---- CLI --------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const connectAt = args.indexOf("--connect");
  if (connectAt >= 0) {
    const [a, b] = args.slice(connectAt + 1);
    const r = connectPaths(String(a), String(b));
    if (!r) { console.error("no index, or one of those is not in the graph"); process.exit(1); }
    console.log(`${r.from}  <->  ${r.to}${r.viaHubs ? "   (only via hub nodes: little specific connection)" : ""}`);
    if (!r.paths.length) console.log("  (no route within the hop limit)");
    for (const p of r.paths) console.log(`  [p=${p.strength.toExponential(2)}] ` + p.path.map(h => h.label).join("  ->  "));
    if (r.shared.length) console.log(`  shared: ${r.shared.map(s => s.label).join(", ")}`);
  } else {
    const q = args.join(" ");
    const t0 = Date.now();
    const r = pprQuery(q);
    const ms = Date.now() - t0;
    if (!r) { console.log("no seeds matched (or no ppr-index.json — run npm run graph)"); process.exit(0); }
    console.log(`seeds: ${r.seeds.map(s => `${s.label} (${s.type})`).join(", ")}   [${ms}ms]`);
    console.log(`\nfiles (direct retrieval targets):`);
    for (const f of r.files) console.log(`  ${f.mass.toExponential(2)}  ${f.file}   <- ${f.label}`);
    console.log(`\nterms (lexical expansion):`);
    for (const t of r.terms) console.log(`  ${t.mass.toExponential(2)}  ${t.label} (${t.type})`);
  }
}
