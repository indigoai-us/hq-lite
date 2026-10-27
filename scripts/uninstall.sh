#!/bin/bash
# Remove HQ Lite from every agent app. Leaves your HQ login and any skills you
# installed in ~/.claude/skills or ~/.codex/skills.
set -u
command -v claude >/dev/null 2>&1 && {
  claude plugin uninstall hqforwork@hqforwork >/dev/null 2>&1
  claude plugin uninstall hq-lite@hq-lite >/dev/null 2>&1  # installs made before the rename
  claude plugin marketplace remove hqforwork >/dev/null 2>&1
  claude plugin marketplace remove hq-lite >/dev/null 2>&1
}
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
[ -f "$CFG" ] && node -e '
const fs=require("fs");const f=process.argv[1];
try{const c=JSON.parse(fs.readFileSync(f,"utf8"));if(c.mcpServers){delete c.mcpServers["hq-lite"];fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n");}}catch{}
' "$CFG"
if command -v codex >/dev/null 2>&1; then
  codex mcp remove hq-lite >/dev/null 2>&1
fi
rm -rf "$HOME/.codex/skills/hq-lite" "$HOME/.hq-lite"
echo "HQ Lite removed from Claude Code, Claude desktop, and Codex. Restart any open apps."
