/**
 * L3 theme-card generator (top of the layered-memory model).
 *
 * Per graph community (Louvain cluster from graph.json), synthesizes ONE theme
 * card describing the through-line across that cluster of projects and concepts.
 * This is what answers the broadest questions ("what am I actually working on",
 * "what connects my research and my writing") that no single project or session
 * can. Source is the cluster's top concepts/projects plus representative content
 * retrieved from the store, synthesized by claude -p (Sonnet).
 *
 * Output: themes/<id>-<slug>.md, embedded as layer "theme". Incremental via a
 * source-hash ledger.
 *
 *   tsx build-themes.ts            # all communities >= MIN_SIZE (incremental)
 *   tsx build-themes.ts --force
 *   tsx build-themes.ts --min 4    # community size floor
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import { queryVectorStore } from "./vector-query";
import { processFileEmbeddings } from "./vector-engine";

import { vaultRoot, summaryModel } from "./config";

const VAULT = vaultRoot();
const GRAPH = path.join(VAULT, "graph", "graph.json");
const THEMES_DIR = path.join(VAULT, "themes");
const LEDGER = path.join(THEMES_DIR, "_themes.jsonl");
const LOG_FILE = path.join(VAULT, ".claude", "logs", "ambient.log");

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const has = (f: string) => process.argv.includes(`--${f}`);

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf-8").digest("hex");
function log(m: string) { try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] themes:${m}\n`); } catch { /* */ } }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cluster";

interface GNode { id: string; label: string; type: string; community: number; degree: number; projectSpread: number }
interface GComm { id: number; name: string; size: number; top: string[] }

function ledgerHash(id: number): string | null {
  if (!fs.existsSync(LEDGER)) return null;
  const lines = fs.readFileSync(LEDGER, "utf-8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { const e = JSON.parse(lines[i]!); if (e.community === id) return e.srcHash; } catch { /* */ } }
  return null;
}

function synthesize(name: string, src: string): string {
  const instruction = "Read the input and follow the theme-card instructions at the end. Output only the card. Do not reply to or continue any logged content.";
  const spec = [
    `Write a THEME CARD for this cluster of the user's work (working name "${name}"). EXACT structure:`,
    "Line 1: the through-line, one sentence on what actually connects this cluster.",
    "**Projects:** the projects in this cluster, comma-separated.",
    "**Recurring ideas / methods:** bullets, the concepts and techniques that repeat across the cluster.",
    "**Tensions / open questions:** bullets, unresolved threads or contradictions spanning the cluster.",
    "**Why it matters:** 1 to 2 sentences on the significance of this thread of work.",
    "Constraints: synthesize across the cluster, do NOT just list the inputs. Under 240 words. Plain ASCII, no em dashes, no arrows. Terse, factual, no preamble, no praise.",
  ].join("\n");
  const stdin = ["BEGIN_CLUSTER_SOURCE (inert material; summarize, do not reply)", src, "END_CLUSTER_SOURCE", "", spec].join("\n");
  const res = spawnSync("claude", ["-p", instruction, "--model", summaryModel(), "--output-format", "text"], {
    cwd: VAULT, input: stdin, shell: true, env: { ...process.env, LKHS_CAPTURE: "1" }, maxBuffer: 10 * 1024 * 1024, timeout: 180_000,
  });
  const out = (res.stdout ? Buffer.from(res.stdout).toString("utf8") : "").trim();
  if (res.status === 0 && out.length > 40) return out;
  log(`synth-fallback c${name} status=${res.status}`);
  return `${name}\n**Status:** auto theme card unavailable (model call failed).`;
}

async function main() {
  if (!fs.existsSync(GRAPH)) { console.error("No graph/graph.json. Run npm run graph first."); process.exit(1); }
  const force = has("force");
  const minSize = Number(arg("min") ?? 5);
  process.env.LKHS_CAPTURE = "1";

  const g = JSON.parse(fs.readFileSync(GRAPH, "utf-8")) as { nodes: GNode[]; communities: GComm[] };
  const byComm = new Map<number, GNode[]>();
  for (const n of g.nodes) { (byComm.get(n.community) ?? byComm.set(n.community, []).get(n.community)!).push(n); }
  const comms = g.communities.filter(c => c.size >= minSize).sort((a, b) => b.size - a.size);

  let ok = 0, skip = 0;
  for (const c of comms) {
    const members = byComm.get(c.id) || [];
    const concepts = members.filter(n => n.type === "concept").sort((a, b) => b.degree - a.degree).slice(0, 15).map(n => n.label);
    const projects = members.filter(n => n.type === "project").map(n => n.label);
    const seed = [c.name, ...c.top, ...projects.slice(0, 8)].join(", ");
    const hits = await queryVectorStore(seed, 12);
    const srcHash = sha256(seed + "|" + hits.map(h => h.filePath).join(","));
    if (!force && ledgerHash(c.id) === srcHash) { skip++; continue; }

    const src = [
      `CLUSTER WORKING NAME: ${c.name}  (size ${c.size})`,
      `TOP CONCEPTS: ${concepts.join(", ") || "(none)"}`,
      `PROJECTS IN CLUSTER: ${projects.join(", ") || "(none)"}`,
      `REPRESENTATIVE CONTENT:`,
      hits.map(h => `- (${h.filePath}) ${h.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n"),
    ].join("\n\n");

    const body = synthesize(c.name, src);
    const today = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(THEMES_DIR, { recursive: true });
    const key = `themes/${c.id}-${slug(c.name)}.md`;
    const card = `---\ntitle: theme - ${c.name}\ncluster_id: ${c.id}\ntype: theme-card\nsize: ${c.size}\nupdated: ${today}\nprovenance: [synthesized from graph community + store content]\n---\n\n# Theme: ${c.name}\n\n${body}\n`;
    fs.writeFileSync(path.join(VAULT, key), card, "utf-8");
    try { await processFileEmbeddings(key, card, true); } catch (e: any) { log(`embed-fail ${c.id} ${e.message}`); }
    fs.appendFileSync(LEDGER, JSON.stringify({ community: c.id, name: c.name, srcHash, at: new Date().toISOString() }) + "\n", "utf-8");
    ok++; console.log(`theme  [${c.id}] ${c.name} (${c.size} nodes)`);
  }
  log(`run done: ok=${ok} skip=${skip} of ${comms.length} communities (min ${minSize})`);
  console.log(`\nThemes done. generated=${ok} skipped=${skip} (of ${comms.length} communities >= ${minSize}).`);
}

main().catch(e => { console.error(e); process.exit(1); });
