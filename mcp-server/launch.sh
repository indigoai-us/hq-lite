#!/bin/sh
# Start the HQ Lite MCP server with a PATH that can find node and hq.
# Desktop apps (Claude, Codex) launch MCP servers with a minimal PATH, so we
# restore the PATH captured at install time and add common install locations.
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HOME/.hq-lite/env" ] && . "$HOME/.hq-lite/env"
for d in \
  "$HOME/.npm-global/bin" \
  "$HOME/Library/pnpm" \
  "$HOME/.volta/bin" \
  "$HOME/.local/bin" \
  "$HOME/Library/Application Support/Indigo HQ/toolchain/npm-global/bin" \
  /opt/homebrew/bin /usr/local/bin; do
  [ -d "$d" ] && PATH="$PATH:$d"
done
if [ -d "$HOME/.nvm/versions/node" ]; then
  latest=$(ls "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)
  [ -n "$latest" ] && PATH="$PATH:$HOME/.nvm/versions/node/$latest/bin"
fi
export PATH
exec node "$HERE/server.mjs"
