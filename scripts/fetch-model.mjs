#!/usr/bin/env node
/**
 * fetch-model.mjs — put the embedding model where the engine looks for it.
 *
 *   node scripts/fetch-model.mjs          fetch if missing, no-op if present
 *   node scripts/fetch-model.mjs --check  exit 1 if missing, fetch nothing
 *
 * fastembed downloads bge-small from a Google Cloud bucket that now answers
 * AccessDenied, so a fresh clone cannot embed anything and every ingest fails
 * with TAR_BAD_ARCHIVE. The model folder is therefore published as a release
 * asset of this repo and checked against a pinned SHA-256 before it is unpacked.
 *
 * It must be this exact build (the unquantized model_optimized.onnx fastembed
 * shipped). A different export of the same model, such as the quantized one on
 * Hugging Face, produces different vectors, and every vector an existing vault
 * already stored would stop matching new queries.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const NAME = "fast-bge-small-en-v1.5";
const DIR = path.join(VAULT, "local_cache", NAME);
const URL = `https://github.com/pskeough/claude_mind/releases/download/model-bge-small-v1/${NAME}.tar.gz`;
const SHA256 = "0287103c52664a6e23622ea8a928224fa42d8c08b3cde531fc2c1a14a1d4d0bd";
const ONNX_BYTES = 132883455;

const present = () => {
  try { return fs.statSync(path.join(DIR, "model_optimized.onnx")).size === ONNX_BYTES && fs.existsSync(path.join(DIR, "tokenizer.json")); }
  catch { return false; }
};

if (present()) { console.log(`embedding model present: ${DIR}`); process.exit(0); }
if (CHECK) { console.error(`embedding model missing: ${DIR}\n  FIX: node scripts/fetch-model.mjs`); process.exit(1); }

console.log(`fetching embedding model (78 MB) from\n  ${URL}`);
const res = await fetch(URL, { redirect: "follow" });
if (!res.ok) { console.error(`! download failed: HTTP ${res.status}\n  FIX: check the network and re-run: node scripts/fetch-model.mjs`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
const got = crypto.createHash("sha256").update(buf).digest("hex");
if (got !== SHA256) { console.error(`! checksum mismatch (got ${got}); refusing to unpack.\n  FIX: re-run; if it repeats, the release asset changed and this script needs its new hash.`); process.exit(1); }

fs.mkdirSync(path.dirname(DIR), { recursive: true });
const tgz = path.join(path.dirname(DIR), `${NAME}.tar.gz`);
fs.writeFileSync(tgz, buf);
// tar ships with macOS, Linux and Windows 10+ (bsdtar as tar.exe). Run it from inside
// the folder with a relative name: GNU tar (Git Bash's) reads "C:\..." as host:path.
const tar = spawnSync("tar", ["-xzf", path.basename(tgz)], { cwd: path.dirname(DIR), stdio: "inherit" });
fs.rmSync(tgz, { force: true });
if (tar.status !== 0 || !present()) { console.error(`! unpack failed\n  FIX: unpack ${URL} into ${path.dirname(DIR)} by hand`); process.exit(1); }
console.log(`embedding model installed: ${DIR}`);
