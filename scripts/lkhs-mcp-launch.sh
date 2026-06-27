#!/bin/bash
# Claude Mind MCP launcher (macOS/Linux). Resolves the vault from its own location
# (<vault>/scripts/lkhs-mcp-launch.sh) and cds into it so tsx + native deps resolve
# from the vault node_modules no matter which project the Claude Code session is in.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
exec node --import tsx ".claude/bin/lkhs-mcp.ts" "$@"
