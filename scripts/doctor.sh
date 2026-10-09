#!/bin/bash
# HQ Lite doctor: proves HQ is not doing anything in the background on this machine.
# Exit 0 when clean, 1 when something HQ-managed is running or registered.
set -u
problems=0
say() { printf '%-34s %s\n' "$1" "$2"; }

# 1. Hooks registered by HQ in Claude Code user settings.
hooks=0
for f in "$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json"; do
  [ -f "$f" ] || continue
  n=$(grep -cE 'master-hook\.sh|/\.claude/hooks/|hq-autocommit|hq core ' "$f" 2>/dev/null)
  hooks=$((hooks + ${n:-0}))
done
say "HQ hooks in Claude settings:" "$hooks"
[ "$hooks" -eq 0 ] || problems=$((problems + 1))

# 1b. Hooks registered by HQ in Codex.
chooks=0
for f in "$HOME/.codex/hooks.json" "$HOME/.codex/config.toml"; do
  [ -f "$f" ] || continue
  n=$(grep -cE 'master-hook\.sh|\.codex/hooks/|hq-autocommit|hq core ' "$f" 2>/dev/null)
  chooks=$((chooks + ${n:-0}))
done
say "HQ hooks in Codex settings:" "$chooks"
[ "$chooks" -eq 0 ] || problems=$((problems + 1))

# 1c. Where HQ Lite is registered.
where=""
grep -q '"hq-lite@hq-lite"' "$HOME/.claude/settings.json" 2>/dev/null && where="$where Claude-Code"
grep -q '"hq-lite"' "$HOME/Library/Application Support/Claude/claude_desktop_config.json" 2>/dev/null && where="$where Claude-desktop"
grep -q '^\[mcp_servers.hq-lite\]' "$HOME/.codex/config.toml" 2>/dev/null && where="$where Codex"
say "HQ Lite registered in:" "${where:- nowhere}"

# 2. HQ background processes.
procs=$(pgrep -u "$(id -u)" -fl 'hq daemon|hq mesh daemon|hq-mesh|hq-sync-runner|hq-sync-menubar|hq agent inbox' 2>/dev/null | grep -v pgrep | wc -l | tr -d ' ')
say "HQ background processes:" "$procs"
[ "$procs" -eq 0 ] || problems=$((problems + 1))

# 3. HQ launch agents.
agents=$(ls "$HOME/Library/LaunchAgents" 2>/dev/null | grep -cE '^ai\.(indigo|getindigo)\.')
say "HQ launch agents:" "$agents"
[ "$agents" -eq 0 ] || problems=$((problems + 1))

# 4. HQ folder.
if [ -d "$HOME/Documents/HQ" ] || [ -d "$HOME/hq" ]; then
  say "HQ folder:" "present (not needed for Lite)"
else
  say "HQ folder:" "none"
fi

# 5. Login + company.
if command -v hq >/dev/null 2>&1; then
  who=$(hq whoami 2>&1 | head -1)
  say "HQ login:" "$who"
else
  say "HQ login:" "hq CLI not installed"
  problems=$((problems + 1))
fi

echo
if [ "$problems" -eq 0 ]; then
  echo "Clean: no HQ hooks, no HQ background processes, no HQ launch agents."
  exit 0
fi
echo "Found $problems issue(s) above."
exit 1
