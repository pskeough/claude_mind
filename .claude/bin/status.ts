/**
 * LKHS status: one-glance health of the brain.
 *
 * Answers "is it working, what's in it, is it fresh" without digging through logs.
 * Covers the store (per layer), the live services (daemon, watcher), the memory
 * layers (sessions, projects, cards, themes, wiki), recent activity, and freshness.
 *
 *   npm run status
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { layerStats, stats } from "./store";
import { config, vaultRoot, daemonPort } from "./config";

const VAULT = vaultRoot();
const cfg: any = config();
const PORT = daemonPort();

const DAY = 86400_000;
const now = Date.now();
const ago = (ms: number) => { const d = (now - ms) / DAY; return d < 1 ? `${Math.round((now - ms) / 3600_000)}h ago` : `${Math.round(d)}d ago`; };

function lastLine(file: string): any | null {
  try {
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]!); } catch { /* */ } }
  } catch { /* */ }
  return null;
}
const countLines = (file: string) => { try { return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).length; } catch { return 0; } };
const countMd = (dir: string) => { try { return fs.readdirSync(path.join(VAULT, dir)).filter(f => f.endsWith(".md") && !f.startsWith("_")).length; } catch { return 0; } };
const mtime = (p: string) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

function pidAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; } }

function daemonHealth(): Promise<any> {
  return new Promise(res => {
    const req = http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 1500 }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch { res(null); } });
    });
    req.on("error", () => res(null)); req.on("timeout", () => { req.destroy(); res(null); });
  });
}

function gateStats(): { injects: number; recent: string[] } {
  const log = path.join(VAULT, ".claude", "logs", "ambient.log");
  try {
    const lines = fs.readFileSync(log, "utf-8").split("\n").filter(l => l.includes("daemon:gate:inject"));
    return { injects: lines.length, recent: lines.slice(-5).map(l => l.replace(/^\[[^\]]+\] daemon:gate:inject /, "").slice(0, 90)) };
  } catch { return { injects: 0, recent: [] }; }
}

function staleCards(maxDays = 14): number {
  const dir = path.join(VAULT, "cards");
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_"))
      .filter(f => (now - mtime(path.join(dir, f))) > maxDays * DAY).length;
  } catch { return 0; }
}

async function main() {
  const bar = "=".repeat(58);
  console.log(`\n${bar}\n  LKHS / Claude Mind  -  status\n${bar}`);

  // Store
  const s = stats();
  console.log(`\nSTORE (SQLite + sqlite-vec): ${s.files} files, ${s.chunks} chunks`);
  for (const r of layerStats()) console.log(`  ${r.layer.padEnd(9)} ${String(r.files).padStart(5)} files  ${String(r.chunks).padStart(6)} chunks`);

  // Services
  const h = await daemonHealth();
  console.log(`\nSERVICES`);
  console.log(`  daemon   ${h ? `UP   :${PORT}  (${h.chunks} chunks, ${h.entities} entities, rerank=${h.rerank})` : `DOWN :${PORT}  (start: npm run serve)`}`);
  let watcher = "no lock";
  try {
    const lock = path.join(VAULT, ".claude", "watcher.lock");
    if (fs.existsSync(lock)) { const pid = parseInt(fs.readFileSync(lock, "utf-8").trim(), 10); watcher = pidAlive(pid) ? `UP   (pid ${pid})` : `STALE lock (pid ${pid} dead)`; }
  } catch { /* */ }
  console.log(`  watcher  ${watcher}`);

  // Memory layers
  const sess = lastLine(path.join(VAULT, "journal", "_sessions.jsonl"));
  const ing = lastLine(path.join(VAULT, "library", "_projects.jsonl"));
  const card = lastLine(path.join(VAULT, "cards", "_cards.jsonl"));
  const theme = lastLine(path.join(VAULT, "themes", "_themes.jsonl"));
  console.log(`\nMEMORY LAYERS`);
  console.log(`  L1 sessions   ${countLines(path.join(VAULT, "journal", "_sessions.jsonl"))} captured across ${countMd("journal")} projects   last: ${sess ? ago(Date.parse(sess.at)) : "n/a"}`);
  console.log(`  L1 library    ${countLines(path.join(VAULT, "library", "_projects.jsonl"))} projects ingested            last: ${ing ? ago(Date.parse(ing.at)) : "n/a"}`);
  console.log(`  L2 cards      ${countMd("cards")} project-state cards          last: ${card ? ago(Date.parse(card.at)) : "n/a"}`);
  console.log(`  L3 themes     ${countMd("themes")} cross-project theme cards    last: ${theme ? ago(Date.parse(theme.at)) : "n/a"}`);
  console.log(`  wiki          ${countMd("wiki")} concept pages`);

  // Graph
  const gj = path.join(VAULT, "graph", "graph.json");
  if (fs.existsSync(gj)) {
    try { const g = JSON.parse(fs.readFileSync(gj, "utf-8")); console.log(`\nGRAPH  ${g.nodes.length} nodes, ${g.edges.length} edges, ${g.communities.length} communities   built: ${ago(mtime(gj))}`); } catch { /* */ }
  }

  // Activity + freshness
  const gs = gateStats();
  console.log(`\nRETRIEVAL  ${gs.injects} memory injections logged`);
  for (const r of gs.recent) console.log(`  - ${r}`);
  const stale = staleCards();
  console.log(`\nFRESHNESS`);
  console.log(`  ${stale === 0 ? "all cards fresh (< 14d)" : `${stale} cards older than 14d -> npm run cards`}`);
  console.log(`\n${bar}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
