/**
 * env-scan.ts — machine + toolchain catalog. The vault models Patrick (persona),
 * his work (wiki/cards), and the memory system itself, but nothing modeled the
 * MACHINE the work runs on. This does.
 *
 * Emits:
 *   .claude/memory/environment.json  — full structured probe (regenerated wholesale)
 *   ENVIRONMENT.md                   — the card any session reads. Two regions:
 *       AUTO-PROBE (between LKHS-ENV-PROBE markers): owned by this script, rewritten
 *       every run — never hand-edit it. Everything else (the hand annotations:
 *       file-location registry, what-matters notes, credential pointers) is PRESERVED
 *       across runs, same contract as VAULT-INDEX.md's AUTO-NAMESPACE markers.
 *
 * Design: probes are best-effort and time-boxed; a missing tool or a hung CLI must
 * never stall the nightly. Runs as a step in lkhs-refresh.ps1 (so the nightly
 * watchdog reports it) and is surfaced to EVERY project session (not just the vault)
 * by the global lkhs-project-card.ps1 hook. Manual escape hatch: npm run env.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { vaultRoot, memDir } from "./config";

const ROOT = vaultRoot();
const MEM = memDir();
const nowIso = new Date().toISOString();
const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

/** Run a command, return trimmed stdout or null. Never throws, never hangs long. */
function run(cmd: string, args: string[], timeout = 6000): string | null {
  try {
    const out = execFileSync(cmd, args, {
      timeout,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const t = String(out).trim();
    return t.length ? t : null;
  } catch {
    return null;
  }
}
const firstLine = (s: string | null) => (s ? s.split(/\r?\n/)[0]!.trim() : null);

// ---- machine ---------------------------------------------------------------
function machine() {
  let diskFreeGb: number | null = null;
  try {
    // Node 18.15+; C: root. Falls back to null if unavailable.
    const st: any = (fs as any).statfsSync?.("C:\\");
    if (st) diskFreeGb = gb(Number(st.bavail) * Number(st.bsize));
  } catch { /* */ }
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    os: `${os.version?.() || os.type()} (build ${os.release()})`,
    arch: os.arch(),
    cpu: cpus[0]?.model?.trim() ?? "unknown",
    cores_logical: cpus.length,
    ram_gb: gb(os.totalmem()),
    disk_c_free_gb: diskFreeGb,
  };
}

// ---- gpu -------------------------------------------------------------------
function gpu() {
  const q = run("nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
  ]);
  if (!q) return null;
  const [name, vram, driver] = firstLine(q)!.split(",").map(s => s.trim());
  // CUDA (driver) version lives in the plain nvidia-smi header, not the query API.
  const header = run("nvidia-smi", []);
  const cuda = header?.match(/CUDA Version:\s*([\d.]+)/)?.[1] ?? null;
  const vramNum = Number(vram);
  return {
    name: name ?? "unknown",
    vram_gb: Number.isFinite(vramNum) ? Math.round(vramNum / 1024) : null,
    driver: driver ?? null,
    cuda,
  };
}

// ---- runtimes + CLIs -------------------------------------------------------
// name -> version-arg. Presence probed via `where`; version best-effort.
const TOOLS: Record<string, string[] | null> = {
  node: ["--version"], npm: ["--version"], npx: null, tsx: ["--version"],
  python: ["--version"], pip: ["--version"], git: ["--version"], gh: ["--version"],
  "nvidia-smi": null, nvcc: ["--version"], ffmpeg: ["-version"], uv: ["--version"],
  conda: ["--version"], docker: ["--version"], claude: ["--version"],
  gemini: ["--version"], agy: ["--version"], cargo: ["--version"], rustc: ["--version"],
};

function tools() {
  const found: { name: string; version: string | null; path: string }[] = [];
  for (const [name, verArgs] of Object.entries(TOOLS)) {
    const wpath = firstLine(run("where.exe", [name], 4000));
    if (!wpath || /Could not find/i.test(wpath)) continue;
    let version: string | null = null;
    if (verArgs) {
      const raw = firstLine(run(name, verArgs, 6000));
      // nvcc/others emit the version on a later line; grab a version-looking token.
      version = raw?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? raw ?? null;
    }
    found.push({ name, version, path: wpath });
  }
  return found;
}

// ---- python packages (full in JSON, relevant subset in the card) -----------
const RELEVANT_PKGS = [
  "torch", "transformers", "accelerate", "vllm", "sentence-transformers",
  "datasets", "huggingface-hub", "numpy", "pandas", "scipy", "statsmodels",
  "scikit-learn", "matplotlib", "openai", "anthropic", "google-generativeai",
  "peft", "bitsandbytes", "trl", "safetensors",
];
function pythonPackages() {
  const raw = run("pip", ["list", "--format=json"], 15000);
  if (!raw) return null;
  let list: { name: string; version: string }[];
  try { list = JSON.parse(raw); } catch { return null; }
  const byName = new Map(list.map(p => [p.name.toLowerCase(), p.version]));
  const relevant: Record<string, string> = {};
  for (const p of RELEVANT_PKGS) if (byName.has(p)) relevant[p] = byName.get(p)!;
  // torch CUDA build is the fact that actually matters for the GPU work.
  let torchCuda: string | null = null;
  if (byName.has("torch")) {
    const probe = run("python", ["-c",
      "import torch,json;print(json.dumps({'cuda':torch.version.cuda,'avail':torch.cuda.is_available()}))"], 25000);
    try { if (probe) { const j = JSON.parse(firstLine(probe)!); torchCuda = j.cuda; (relevant as any)._torch_cuda_available = j.avail; } } catch { /* */ }
  }
  return { count: list.length, relevant, torch_cuda: torchCuda, full: Object.fromEntries(byName) };
}

// ---- known locations (existence-checked; the "where does X live" registry) --
const CANDIDATE_LOCATIONS: { key: string; path: string; note: string }[] = [
  { key: "vault", path: ROOT, note: "LKHS / ClaudeMind memory vault" },
  { key: "coding_root", path: "C:\\AI Coding Projects", note: "all coding projects" },
  { key: "coding_master_context", path: "C:\\AI Coding Projects\\CodingMasterContext", note: "coding catalog base" },
  { key: "research_root", path: "C:\\Research", note: "research projects (papers, eval repos)" },
  { key: "research_master_context", path: "C:\\Research\\ResearchMasterContext", note: "research catalog base" },
  { key: "writing_root", path: "C:\\Creative Projects\\Writing", note: "creative writing" },
  { key: "writing_base", path: "C:\\Creative Projects\\Writing\\WritingAIBase", note: "writing catalog base" },
  { key: "global_claude", path: path.join(os.homedir(), ".claude"), note: "universal Claude Code config, hooks, skills" },
  { key: "local_models", path: "C:\\LocalAI", note: "local AI models: LLM/ (llama.cpp CUDA builds, LM Studio, GGUFs) + Diffusion/ (StabilityMatrix)" },
  { key: "transformers_cache", path: path.join(ROOT, "local_cache", "transformers"), note: "rerank/embed model cache" },
];
function locations() {
  return CANDIDATE_LOCATIONS.map(l => ({ ...l, exists: fs.existsSync(l.path) }));
}

// ---------------------------------------------------------------------------
const data = {
  generated: nowIso,
  last_scanned: nowIso,
  machine: machine(),
  gpu: gpu(),
  tools: tools(),
  python_packages: pythonPackages(),
  locations: locations(),
  _note: "Probe output, regenerated wholesale by env-scan.ts every run. Hand annotations live in ENVIRONMENT.md, not here.",
};
fs.writeFileSync(path.join(MEM, "environment.json"), JSON.stringify(data, null, 2));

// ---- render the AUTO-PROBE block of ENVIRONMENT.md -------------------------
const iso = nowIso.slice(0, 10);
function probeBlock(): string {
  const m = data.machine;
  const L: string[] = [];
  L.push(`## Machine (scanned ${iso})`);
  L.push(`- Host: ${m.hostname} — ${m.os}, ${m.arch}`);
  L.push(`- CPU: ${m.cpu} (${m.cores_logical} logical cores)`);
  L.push(`- RAM: ${m.ram_gb} GB${m.disk_c_free_gb != null ? ` · C: free ${m.disk_c_free_gb} GB` : ""}`);
  if (data.gpu) {
    const g = data.gpu;
    L.push(`- GPU: ${g.name}${g.vram_gb ? `, ${g.vram_gb} GB` : ""}${g.driver ? ` · driver ${g.driver}` : ""}${g.cuda ? ` · CUDA ${g.cuda}` : ""}`);
  } else {
    L.push(`- GPU: none detected (nvidia-smi absent)`);
  }
  L.push("");
  L.push(`## Tools & runtimes`);
  for (const t of data.tools) L.push(`- ${t.name}${t.version ? ` ${t.version}` : ""} — \`${t.path}\``);
  if (data.python_packages) {
    const pp = data.python_packages;
    L.push("");
    L.push(`## Key Python packages (${pp.count} installed total; full list in environment.json)`);
    const keys = Object.keys(pp.relevant).filter(k => !k.startsWith("_"));
    if (keys.length) for (const k of keys) L.push(`- ${k} ${pp.relevant[k]}`);
    else L.push(`- (none of the tracked ML/stats packages found in this environment)`);
    if (pp.torch_cuda) L.push(`- torch CUDA build: ${pp.torch_cuda} (cuda available: ${(pp.relevant as any)._torch_cuda_available})`);
  }
  L.push("");
  L.push(`## Known locations (existence-checked)`);
  for (const l of data.locations) L.push(`- ${l.key}: \`${l.path}\` — ${l.exists ? "present" : "MISSING"} · ${l.note}`);
  return L.join("\n");
}

const S = "<!-- LKHS-ENV-PROBE:START -->";
const E = "<!-- LKHS-ENV-PROBE:END -->";
const block = `${S}\n<!-- auto-generated by .claude/bin/env-scan.ts every nightly refresh — do NOT hand-edit inside these markers; edits here are overwritten. Hand annotations go BELOW the end marker. -->\n\n${probeBlock()}\n\n${E}`;

const HEADER =
`# Environment — ${data.machine.hostname}

> Machine + toolchain catalog for this machine. This is the ground truth for "what GPU / driver / CUDA", "what version of X is installed", and "where does Y live". The probe section is scanned nightly; the annotation section below is hand-maintained and preserved across scans. (Supersedes the stale \`hardware_and_tools\` block in core_profile.json.)`;

const ANNOTATION_SKELETON =
`<!-- ANNOTATIONS: hand-maintained, preserved across scans. Claude appends here when it learns a new tool/path/dependency mid-task. Never put probe output here. -->

## File-location registry
Where things actually live (the part worth writing by hand — specs get probed, paths get rediscovered every time otherwise).

- Memory vault: \`${ROOT}\`
- (fill in as discovered) Local models / GGUF dir: _unknown — set when next working with local weights_
- (fill in as discovered) Eval datasets / raw run outputs: _unknown_

## What matters / machine notes
- (fill in) Which machine is the local-inference box and what runs on it.
- The Surface Pro X (SQ1, ARM64) is the travel/writing laptop, marginal for compute.

## Credential locations (POINTERS ONLY — never store secret values here)
- (fill in as discovered) OpenRouter / Anthropic / Google API keys: _location unknown — record the .env path or manager entry, not the key_
`;

const cardPath = path.join(ROOT, "ENVIRONMENT.md");
let out: string;
try {
  const existing = fs.readFileSync(cardPath, "utf8");
  if (existing.includes(S) && existing.includes(E)) {
    const re = new RegExp(`${S.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${E.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    out = existing.replace(re, block);
  } else {
    // File exists without markers: keep its content as annotations, prepend fresh probe.
    out = `${HEADER}\n\n${block}\n\n${existing.trim()}\n`;
  }
} catch {
  // First run.
  out = `${HEADER}\n\n${block}\n\n${ANNOTATION_SKELETON}`;
}
fs.writeFileSync(cardPath, out);

const gpuStr = data.gpu ? `${data.gpu.name} ${data.gpu.vram_gb ?? "?"}GB` : "no GPU";
console.log(`env-scan: ${data.machine.hostname} · ${gpuStr} · ${data.tools.length} tools · ${data.python_packages?.count ?? 0} py pkgs · ${data.locations.filter(l => l.exists).length}/${data.locations.length} locations present`);
