#!/usr/bin/env node
/**
 * desktop-config.mjs - find and edit Claude Desktop's claude_desktop_config.json.
 *
 * Desktop keeps its config in a different place per OS and per build:
 *   macOS    ~/Library/Application Support/Claude
 *   Linux    ~/.config/Claude
 *   Windows  %APPDATA%\Claude (classic installer) AND, for the Microsoft Store
 *            (MSIX) build, %LOCALAPPDATA%\Claude-Data\claude_<hash>\. The Store
 *            build reads only the second one, so writing %APPDATA% alone left
 *            Store users with no servers at all.
 *
 * desktopConfigDirs() returns every candidate directory that exists. When none
 * exists yet (Desktop installed but never opened, or not installed), it returns
 * the platform default so a later install still finds the entry.
 *
 * setDesktopServer(name, entry) / removeDesktopServer(name) edit mcpServers in
 * every config found, backing each file up once per run as
 * claude_desktop_config.json.bak-claudemind. Idempotent: an unchanged entry is
 * not rewritten.
 *
 * CLI (for checking by hand):
 *   node scripts/desktop-config.mjs            list config paths and their servers
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILE = "claude_desktop_config.json";

// HOME / APPDATA / LOCALAPPDATA are read from env first so a test can point the
// whole thing at a sandbox without touching the real Desktop config.
const home = () => process.env.HOME || process.env.USERPROFILE || os.homedir();

// CLAUDEMIND_DESKTOP_PLATFORM lets a test exercise another OS layout under a fake HOME.
const PLATFORM = process.env.CLAUDEMIND_DESKTOP_PLATFORM || process.platform;

export function desktopConfigDirs(platform = PLATFORM) {
  const dirs = [];
  if (platform === "darwin") {
    dirs.push(path.join(home(), "Library", "Application Support", "Claude"));
  } else if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home(), "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA || path.join(home(), "AppData", "Local");
    dirs.push(path.join(appData, "Claude"));
    const store = path.join(local, "Claude-Data");
    try {
      for (const d of fs.readdirSync(store)) {
        if (/^claude_/i.test(d) && fs.statSync(path.join(store, d)).isDirectory()) dirs.push(path.join(store, d));
      }
    } catch { /* no Store build */ }
  } else {
    dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home(), ".config"), "Claude"));
  }
  const existing = dirs.filter((d) => fs.existsSync(d));
  return existing.length ? existing : [dirs[0]];
}

export function desktopConfigFiles(platform = PLATFORM) {
  return desktopConfigDirs(platform).map((d) => path.join(d, FILE));
}

function readCfg(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  return raw.trim() ? JSON.parse(raw) : {};
}

const backedUp = new Set();
function writeCfg(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !backedUp.has(file)) {
    fs.copyFileSync(file, `${file}.bak-claudemind`);
    backedUp.add(file);
  }
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}

/** Add or replace mcpServers[name] in every Desktop config. Returns [{file, status}]. */
export function setDesktopServer(name, entry) {
  const out = [];
  for (const file of desktopConfigFiles()) {
    try {
      const cfg = readCfg(file);
      cfg.mcpServers = cfg.mcpServers || {};
      if (JSON.stringify(cfg.mcpServers[name]) === JSON.stringify(entry)) { out.push({ file, status: "unchanged" }); continue; }
      cfg.mcpServers[name] = entry;
      writeCfg(file, cfg);
      out.push({ file, status: "written" });
    } catch (e) { out.push({ file, status: `error: ${e.message}` }); }
  }
  return out;
}

/** Remove mcpServers[name] from every Desktop config that has it. */
export function removeDesktopServer(name) {
  const out = [];
  for (const file of desktopConfigFiles()) {
    try {
      const cfg = readCfg(file);
      if (!cfg.mcpServers || !(name in cfg.mcpServers)) { out.push({ file, status: "absent" }); continue; }
      delete cfg.mcpServers[name];
      writeCfg(file, cfg);
      out.push({ file, status: "removed" });
    } catch (e) { out.push({ file, status: `error: ${e.message}` }); }
  }
  return out;
}

/**
 * The Desktop entry for the lkhs-memory server. Desktop starts servers with a
 * minimal PATH and an arbitrary working directory, so everything is absolute:
 * the node binary running this installer, tsx's loader as a file URL (a bare
 * `--import tsx` resolves from the cwd, which is not the vault), and the server.
 * The server chdirs into the vault itself; LKHS_VAULT_ROOT pins which vault.
 */
export function lkhsMemoryEntry(vault) {
  return {
    command: process.execPath,
    args: [
      "--import", pathToFileURL(path.join(vault, "node_modules", "tsx", "dist", "loader.mjs")).href,
      path.join(vault, ".claude", "bin", "lkhs-mcp.ts"),
    ],
    env: { LKHS_VAULT_ROOT: vault },
  };
}

export function printResults(results, indent = "  ") {
  for (const r of results) console.log(`${indent}${r.status.padEnd(9)} ${r.file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of desktopConfigFiles()) {
    let names = "(no file yet)";
    try { if (fs.existsSync(file)) names = Object.keys(readCfg(file).mcpServers || {}).join(", ") || "(no servers)"; } catch (e) { names = `unreadable: ${e.message}`; }
    console.log(`${file}\n  ${names}`);
  }
}

/** True when any Desktop config already has mcpServers[name]. */
export function desktopHasServer(name) {
  return desktopConfigFiles().some((f) => { try { return !!readCfg(f).mcpServers?.[name]; } catch { return false; } });
}

/**
 * The one paragraph to paste into Desktop > Settings > Profile. Desktop has a
 * single preferences box, so when both the memory server and the wellbeing
 * module are on, the two texts are merged into one paragraph with one shared
 * chat id and one "don't mention" line, instead of two pastes that each claim
 * to be the whole instruction.
 */
export function desktopPreferences(vault, { memory, wellbeing } = {}) {
  const read = (p) => { try { return fs.readFileSync(path.join(vault, p), "utf8").trim(); } catch { return ""; } };
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(vault, ".claude", "lkhs.config.json"), "utf8")); } catch {}
  const mem = memory ?? desktopHasServer("lkhs-memory");
  const wb = wellbeing ?? cfg.rhythm?.enabled === true;
  const memText = read("extras/desktop-preferences.txt");
  const wbText = read("extras/wellbeing/desktop-preferences.txt");
  if (mem && !wb) return memText;
  if (wb && !mem) return wbText;
  if (!mem && !wb) return "";
  const strip = (s) => s.replace(/\s*Don't mention the tool otherwise\.\s*$/, "").trim();
  return [
    strip(wbText),
    strip(memText).replace("a chat id you make up for this conversation and reuse every time", "the same chat id"),
    "Keep mood and health details out of save_session summaries; wellbeing_note is for those.",
    "Don't mention either tool otherwise.",
  ].join(" ");
}
