#!/bin/bash
# ====================================================================
#  Claude Mind — setup bootstrap (macOS / Linux)
#  Run once after cloning:   bash setup.sh
#
#  Does the deterministic pre-work:
#    1. Preflight checks (Node, npm, claude CLI, Xcode CLT)
#    2. npm install  (compiles native deps for THIS machine)
#  Then hands off: open Claude Code in this folder and say "run setup",
#  and it will read SETUP.md and finish the personalized install
#  (your profile, file ingestion, Claude-chat persona, background jobs).
# ====================================================================
set -e
cd "$(dirname "$0")"

echo "== Claude Mind setup =="
echo ""
echo "[1/2] Preflight checks..."
node scripts/preflight.mjs

echo ""
echo "[2/2] Installing dependencies (this compiles native modules; takes a few minutes)..."
npm install

chmod +x scripts/lkhs-mcp-launch.sh launch.command 2>/dev/null || true

echo ""
echo "===================================================================="
echo " Bootstrap complete."
echo ""
echo " Next: open Claude Code in this folder and tell it:  run setup"
echo "   claude"
echo ""
echo " Claude will read SETUP.md and finish the install: your profile,"
echo " ingest your files + Claude chat export, and start the background"
echo " memory jobs. Then your console lives at  http://127.0.0.1:7099"
echo "===================================================================="
