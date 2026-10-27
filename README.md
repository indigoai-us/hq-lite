# hq-lite

HQ Lite is a Claude Code plugin that gives an agent three HQ capabilities in any repo:

- **Secrets**: list secret names and run commands with secrets injected. Values never reach the agent.
- **Skill sharing**: publish a local skill to your HQ company, and install teammates' skills into `~/.claude/skills/`.
- **Agent-to-agent DMs**: message a teammate or their agent in the same company, and read replies when asked.

It does not need the HQ folder. It registers no hooks, starts no background processes, and writes nothing to your repo.

## Install

Requirements: Node.js 20+, an HQ account in at least one company, and any of: Claude Code, the Claude desktop app, Codex CLI, or the Codex app.

```bash
git clone https://github.com/indigoai-us/hq-lite && bash hq-lite/scripts/install.sh
```

Or, in Claude Code 2.1.275 or later:

```
/plugin install hqforwork --marketplace indigoai-us/hq-lite
```

To message teammates or share skills, you and they need to be in the same HQ company. Create a free one at https://hq.computer and invite them by email.

The installer:

1. Installs the `hq` CLI if missing and signs you in.
2. Copies HQ Lite to `~/.hq-lite` and saves your PATH so desktop apps can find `node` and `hq`.
3. Registers the MCP server with every agent app it finds:
   - Claude Code and the Claude desktop Code tab, as the `hqforwork` plugin
   - The Claude desktop app, in `claude_desktop_config.json`
   - Codex CLI and the Codex app, in `~/.codex/config.toml`, plus the `hq-lite` guide skill in `~/.codex/skills`
4. Runs the doctor.

Restart the Claude desktop app and the Codex app after installing.

`skill_install` writes shared skills to `~/.claude/skills` and, when Codex is installed, `~/.codex/skills`. Pass `target: "claude"` or `target: "codex"` to pick one. The Claude desktop chat app can use the tools but does not load skills from disk.

## What this plugin runs and calls

- The MCP server is `mcp-server/server.mjs`. It is started by
  `mcp-server/launch.sh`, a short shell script that adds common Node
  install locations to PATH and then runs `node server.mjs`. It downloads
  nothing and runs no other program.
- The server calls HQ's API at `https://hqapi.hq.computer` using your own HQ
  sign-in. Set `HQ_VAULT_API_URL` to point it elsewhere and `HQ_LITE_COMPANY`
  to pick a company.
- `scripts/install.sh` is run by you, once, by hand. It is not a hook. If the
  `hq` command is missing it installs the `@indigoai-us/hq-cli` package
  globally with npm, then registers the server with the agent apps it finds.
- Secret values never pass through the agent. `secrets_exec` injects them
  into the command it runs.

## Tools

| Tool | What it does |
|---|---|
| `secrets_list` | Secret names in the company (no values) |
| `secrets_exec` | Run a command with named secrets as env vars; refuses value-printing commands like `printenv` or `echo` |
| `skill_list` | Shared skills in the company, marked if installed |
| `skill_install` | Write a shared skill to `~/.claude/skills/<slug>/SKILL.md`; never overwrites without `force` |
| `skill_publish` | Share a local skill folder (needs `SKILL.md` with `name` and `description`) |
| `dm_contacts` | People and agents you can message |
| `dm_send` | Send a DM; refuses bodies that look like secrets |
| `dm_inbox` | Read recent DMs (only when the user asks) |
| `dm_thread` | Read a 1:1 thread |
| `lite_doctor` | Show login and companies; check for HQ hooks, background processes, and launch agents |

If you belong to several companies, pass `company` or set `HQ_LITE_COMPANY=<slug>`.

## Check it is quiet

```bash
bash scripts/doctor.sh
```

## Uninstall

```bash
bash ~/.hq-lite/scripts/uninstall.sh
```

This removes HQ Lite from Claude Code, the Claude desktop app, and Codex. Installed skills and your HQ login stay until you delete them.

## Limits in this POC

- Skill install copies `SKILL.md` only, not other files in the skill folder.
- Publishing a skill whose name already exists in the company is refused; updating shared skills comes later.
- macOS only. Cursor is not wired up yet.
- `secrets_exec` blocks obvious value-printing commands, but a program you run with a secret can still read it. Treat it as trusted execution.
