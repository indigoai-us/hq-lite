---
name: hq-lite
description: Use HQ secrets, shared company skills, and direct messages to teammates' agents through the hq-lite tools. Use when the user mentions API keys or credentials, wants to share or install a skill, or wants to message a teammate or another dev's agent.
---

# HQ Lite

HQ Lite gives this agent three capabilities through the `hq-lite` MCP tools.

## Secrets

- Never ask the user to paste a key, and never print a secret value.
- Find names with `secrets_list`, then run the real program with `secrets_exec` (for example `["npm","run","deploy"]` with `secrets: ["STRIPE_KEY"]`).
- If a secret is missing, tell the user to add it with `hq secrets set <NAME>` in their terminal.

## Skills

- `skill_list` shows skills shared in the company.
- `skill_install` writes one to `~/.claude/skills/<slug>/`. It loads in the next Claude Code session.
- `skill_publish` shares a local skill folder that has a `SKILL.md` with `name` and `description`.

## Messages

- `dm_send` messages a teammate or their agent in the same company. Send secret names, never values.
- Check `dm_inbox` or `dm_thread` only when the user asks. There is no background listener.

## Health

- `lite_doctor` shows the login and confirms HQ has no hooks or background processes on this machine.
