#!/bin/bash
# ====================================================================
#  Claude Mind - one-click launcher (macOS / Linux)
#  Double-click on macOS, or run: bash launch.command
#  Starts the retrieval daemon, ambient watcher, and web console
#  (each only if not already running), then opens the console.
#
#  Note: requires `npm install` to have run in this folder so the
#  native deps (better-sqlite3, sqlite-vec, onnxruntime) are built for
#  this platform. The always-on capture/retrieval hooks are currently
#  Windows PowerShell; on macOS the console + MCP server work, but the
#  background hooks would need bash ports (see .claude/hooks).
# ====================================================================
cd "$(dirname "$0")"
echo "Starting Claude Mind..."

up() { lsof -i :"$1" >/dev/null 2>&1; }

if ! up 7077; then ( node --import tsx .claude/bin/lkhs-daemon.ts >/dev/null 2>&1 & ) ; echo "started daemon"; else echo "daemon already up"; fi
if ! pgrep -f "ambient-watcher.ts" >/dev/null 2>&1; then ( node --import tsx .claude/bin/ambient-watcher.ts >/dev/null 2>&1 & ) ; echo "started watcher"; else echo "watcher already up"; fi
if ! up 7099; then ( node --import tsx .claude/bin/lkhs-web.ts >/dev/null 2>&1 & ) ; echo "started web console"; else echo "console already up"; fi

echo "Waiting for the console to warm up..."
for i in $(seq 1 40); do
  if curl -s http://127.0.0.1:7099/api/overview >/dev/null 2>&1; then break; fi
  sleep 1
done

( command -v open >/dev/null && open http://127.0.0.1:7099 ) || ( command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:7099 ) || true
echo ""
echo " Claude Mind Console:  http://127.0.0.1:7099"
