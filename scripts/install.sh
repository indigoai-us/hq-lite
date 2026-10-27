#!/bin/bash
# HQ Lite installer.
#
# Copies HQ Lite to ~/.hq-lite and registers its MCP server with every agent app
# found for this user: Claude Code (and the Claude desktop Code tab), the Claude
# desktop app, and Codex (CLI and app). Signs in to HQ if needed.
#
# Creates no HQ folder, registers no hooks, starts no background processes.
# Undo with scripts/uninstall.sh.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.hq-lite"

command -v node >/dev/null || { echo "Node.js 20+ is required (https://nodejs.org)."; exit 1; }
command -v hq >/dev/null || { echo "Installing the hq CLI..."; npm i -g @indigoai-us/hq-cli@5.345.173 >/dev/null; }

# 1. Stable copy + PATH snapshot so desktop apps can find node and hq.
if [ "$SRC" != "$DEST" ]; then
  rm -rf "$DEST.tmp" && mkdir -p "$DEST.tmp"
  cp -R "$SRC/." "$DEST.tmp/"
  rm -rf "$DEST" && mv "$DEST.tmp" "$DEST"
fi
printf 'PATH=%q\n' "$PATH" > "$DEST/env"
chmod +x "$DEST/mcp-server/launch.sh" "$DEST/scripts/"*.sh
LAUNCH="$DEST/mcp-server/launch.sh"

# 2. HQ login.
if ! hq whoami >/dev/null 2>&1; then
  echo "Signing in to HQ (opens your browser)..."
  hq login
fi

registered=()

# 3. Claude Code + Claude desktop Code tab (plugin).
if command -v claude >/dev/null 2>&1; then
  claude plugin marketplace add "$DEST" >/dev/null 2>&1 || claude plugin marketplace update hqforwork >/dev/null 2>&1 || true
  claude plugin install hqforwork@hqforwork >/dev/null 2>&1 || true
  registered+=("Claude Code")
fi

# 4. Claude desktop app (chat).
CLAUDE_DESKTOP_DIR="$HOME/Library/Application Support/Claude"
if [ -d "/Applications/Claude.app" ] || [ -d "$CLAUDE_DESKTOP_DIR" ]; then
  mkdir -p "$CLAUDE_DESKTOP_DIR"
  node - "$CLAUDE_DESKTOP_DIR/claude_desktop_config.json" "$LAUNCH" <<'EOF'
const fs = require("fs");
const [file, launch] = process.argv.slice(2);
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers["hq-lite"] = { command: "/bin/sh", args: [launch] };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
EOF
  registered+=("Claude desktop (restart it)")
fi

# 5. Codex CLI + Codex app (they share ~/.codex/config.toml).
if command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ] || [ -d "/Applications/Codex.app" ]; then
  mkdir -p "$HOME/.codex/skills"
  if command -v codex >/dev/null 2>&1; then
    codex mcp remove hq-lite >/dev/null 2>&1 || true
    codex mcp add hq-lite -- /bin/sh "$LAUNCH" >/dev/null
  elif ! grep -q '^\[mcp_servers.hq-lite\]' "$HOME/.codex/config.toml" 2>/dev/null; then
    printf '\n[mcp_servers.hq-lite]\ncommand = "/bin/sh"\nargs = ["%s"]\n' "$LAUNCH" >> "$HOME/.codex/config.toml"
  fi
  rm -rf "$HOME/.codex/skills/hq-lite"
  cp -R "$DEST/skills/hq-lite" "$HOME/.codex/skills/hq-lite"
  registered+=("Codex (restart the Codex app if open)")
fi

echo
bash "$DEST/scripts/doctor.sh" || true
echo
if [ ${#registered[@]} -eq 0 ]; then
  echo "No agent apps found. Install Claude Code, the Claude desktop app, or Codex, then run this again."
  exit 1
fi
echo "HQ Lite is set up for: ${registered[*]}"
echo "Try asking your agent: \"run lite doctor\" or \"list my HQ secrets\"."
echo "Uninstall: bash $DEST/scripts/uninstall.sh"
