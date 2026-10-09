#!/usr/bin/env node
// HQ Lite MCP server: secrets, skill sharing, and agent-to-agent DMs.
//
// Works from any directory. Never looks for an HQ folder, never registers hooks,
// never starts background processes. Auth comes from the hq CLI login
// (~/.hq/cognito-tokens.json); everything else is a direct call to the HQ API
// or a one-shot `hq secrets exec`.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./mcp.mjs";

const VERSION = "0.1.0";
const API = (process.env.HQ_VAULT_API_URL || "https://hqapi.hq.computer").replace(/\/+$/, "");
const TOKENS = join(homedir(), ".hq", "cognito-tokens.json");
// Agent skill folders HQ Lite installs into. Claude Code and the Claude desktop
// Code tab read ~/.claude/skills; Codex CLI and the Codex app read ~/.codex/skills.
const SKILL_TARGETS = {
  claude: join(homedir(), ".claude", "skills"),
  codex: join(homedir(), ".codex", "skills"),
};
const SKILLS_DIR = SKILL_TARGETS.claude;

function skillTargets(target) {
  if (target === "claude" || target === "codex") return [target];
  // Default: Claude always, plus Codex when Codex is installed for this user.
  return existsSync(join(homedir(), ".codex")) ? ["claude", "codex"] : ["claude"];
}
const HERE = dirname(fileURLToPath(import.meta.url));
const NOT_LOGGED_IN = "You're not signed in to HQ. Run `hq login` in a terminal, then try again.";

// ─── auth + api ──────────────────────────────────────────────────────────────

function accessToken() {
  // Refresh only when close to expiry; the CLI owns the token file and its locking.
  spawnSync("hq", ["auth", "refresh"], { stdio: "ignore", timeout: 20000 });
  if (!existsSync(TOKENS)) throw new Error(NOT_LOGGED_IN);
  let t;
  try {
    t = JSON.parse(readFileSync(TOKENS, "utf8"));
  } catch {
    throw new Error(NOT_LOGGED_IN);
  }
  if (!t.accessToken || (t.expiresAt && t.expiresAt < Date.now())) throw new Error(NOT_LOGGED_IN);
  return t.accessToken;
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (res.status === 401) throw new Error(NOT_LOGGED_IN);
  if (!res.ok) {
    const msg = data?.error || data?.message || text.slice(0, 200) || res.statusText;
    throw new Error(`HQ returned ${res.status}: ${msg}`);
  }
  return data;
}

const q = (o) =>
  "?" +
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

// ─── company resolution ──────────────────────────────────────────────────────

let companiesCache;
async function companies() {
  if (!companiesCache) {
    const data = await api("GET", "/me/companies");
    const list = Array.isArray(data) ? data : data.companies || [];
    companiesCache = list.map((c) => ({ slug: c.slug, uid: c.companyUid || c.uid, role: c.role }));
  }
  return companiesCache;
}

async function company(arg) {
  const want = arg || process.env.HQ_LITE_COMPANY;
  const list = await companies();
  if (want) {
    const hit = list.find((c) => c.slug === want || c.uid === want);
    if (!hit) throw new Error(`You're not a member of "${want}". Your companies: ${list.map((c) => c.slug).join(", ") || "none"}.`);
    return hit;
  }
  if (list.length === 1) return list[0];
  if (list.length === 0) throw new Error("Your HQ account isn't in any company yet. Ask a teammate to invite you, or create a free company at https://hq.computer.");
  throw new Error(`You're in several companies (${list.map((c) => c.slug).join(", ")}). Pass "company", or set HQ_LITE_COMPANY.`);
}

const companyProp = {
  company: { type: "string", description: "Company slug or cmp_ uid. Optional when you belong to one company or HQ_LITE_COMPANY is set." },
};

// ─── secrets ─────────────────────────────────────────────────────────────────

// Binaries that would just print injected values back into the transcript.
const VALUE_PRINTERS = new Set(["env", "printenv", "echo", "printf", "cat", "base64", "xxd", "od", "hexdump", "set", "export", "declare", "sh", "bash", "zsh", "fish", "dash", "ksh", "tee"]);

function runCapture(cmd, args, cwd) {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    const cap = (d) => {
      out += d.toString();
      if (out.length > 60000) out = out.slice(-60000);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    child.on("error", (e) => resolveP({ code: 127, out: String(e.message) }));
    child.on("close", (code) => resolveP({ code, out }));
  });
}

// ─── skills ──────────────────────────────────────────────────────────────────

function slugFromVaultPath(p) {
  const m = /^skills\/([^/]+)\//.exec(p || "");
  return m ? m[1] : null;
}

function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const fm = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  return fm;
}

async function findSkill(cmp, ref) {
  const shelf = await api("GET", `/v1/skills/${cmp.uid}/shelf`);
  const skills = shelf.skills || [];
  return skills.find((s) => s.skillUid === ref || s.name === ref || slugFromVaultPath(s.vaultPath) === ref);
}

// ─── secret-material guard for DMs ───────────────────────────────────────────

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /sk_(live|test)_[0-9a-zA-Z]{16,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

// ─── tools ───────────────────────────────────────────────────────────────────

const tools = [
  {
    name: "secrets_list",
    description: "List the names of HQ secrets you can use (never values). Use before secrets_exec to find the right names.",
    inputSchema: { type: "object", properties: { ...companyProp, prefix: { type: "string", description: "Optional path prefix, e.g. DEV" } } },
    annotations: { readOnlyHint: true },
    async run({ company: c, prefix }) {
      const cmp = await company(c);
      const data = await api("GET", `/secrets/${cmp.uid}${q({ prefix })}`);
      const list = data.secrets || [];
      if (!list.length) return `No secrets in ${cmp.slug}${prefix ? ` under ${prefix}` : ""}.`;
      return `Secrets in ${cmp.slug} (names only):\n` + list.map((s) => `- ${s.name}`).join("\n");
    },
  },
  {
    name: "secrets_exec",
    description:
      "Run a command with HQ secrets injected as environment variables (each secret under its own name). The values never come back to you. Runs in the given working directory (defaults to the current project).",
    inputSchema: {
      type: "object",
      required: ["secrets", "command"],
      properties: {
        ...companyProp,
        secrets: { type: "array", items: { type: "string" }, description: "Secret names to inject" },
        command: { type: "array", items: { type: "string" }, description: 'Command and args, e.g. ["npm","run","deploy"]' },
        cwd: { type: "string", description: "Working directory (absolute). Defaults to the project directory." },
      },
    },
    async run({ company: c, secrets, command, cwd }) {
      if (!Array.isArray(secrets) || !secrets.length) throw new Error('Pass "secrets" as a list of names.');
      if (!Array.isArray(command) || !command.length) throw new Error('Pass "command" as a list, e.g. ["npm","test"].');
      if (VALUE_PRINTERS.has(basename(command[0]))) {
        throw new Error(`Refusing to run "${command[0]}" with secrets: it would print the values. Run the real program that needs them.`);
      }
      const cmp = await company(c);
      const dir = resolve(cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
      if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`);
      const { code, out } = await runCapture("hq", ["secrets", "exec", "--company", cmp.slug, "--only", secrets.join(","), "--", ...command], dir);
      return `exit ${code}\n${out.trim()}`;
    },
  },
  {
    name: "dm_contacts",
    description: "List people and agents in your HQ company you can message.",
    inputSchema: { type: "object", properties: { ...companyProp } },
    annotations: { readOnlyHint: true },
    async run({ company: c }) {
      const cmp = await company(c);
      const data = await api("GET", `/v1/notify/contacts${q({ companyUid: cmp.uid })}`);
      const list = data.contacts || data.items || (Array.isArray(data) ? data : []);
      if (!list.length) return `No contacts in ${cmp.slug} yet.`;
      return list
        .map((p) => `- ${p.displayName || p.name || ""} ${p.email ? `<${p.email}>` : ""} ${p.personUid || p.agentUid || p.uid || ""} ${p.kind || p.type || ""}`.replace(/\s+/g, " ").trim())
        .join("\n");
    },
  },
  {
    name: "dm_send",
    description:
      "Send a direct message to a person or their agent in your HQ company. Use for agent-to-agent coordination. Never include secrets; use secret names instead.",
    inputSchema: {
      type: "object",
      required: ["to", "body"],
      properties: {
        ...companyProp,
        to: { type: "string", description: "Recipient email or prs_/agt_ uid" },
        body: { type: "string", description: "Message text (max 4000 chars)" },
        prompt: { type: "string", description: "Optional ready-to-run prompt for the recipient's agent" },
      },
    },
    async run({ company: c, to, body, prompt }) {
      if (!to || !body) throw new Error('Pass "to" and "body".');
      if (body.length > 4000) throw new Error("Message is over 4000 characters.");
      if (SECRET_PATTERNS.some((re) => re.test(body) || (prompt && re.test(prompt)))) {
        throw new Error("That message looks like it contains a secret. Send the secret's name instead; the recipient can use it with secrets_exec.");
      }
      const cmp = await company(c);
      const payload = { companyUid: cmp.uid, body, ...(prompt ? { prompt } : {}) };
      if (to.includes("@")) payload.toEmail = to;
      else payload.toPersonUid = to;
      const data = await api("POST", "/v1/notify/dm", payload);
      if (data.state === "connection_requested") return `Sent a connection request to ${to}; the message is delivered once they accept.`;
      return `Sent to ${to}${data.eventId ? ` (event ${data.eventId})` : ""}.`;
    },
  },
  {
    name: "dm_inbox",
    description: "Read your recent HQ direct messages. Only call this when the user asks you to check messages.",
    inputSchema: { type: "object", properties: { ...companyProp, limit: { type: "number", description: "Max messages (default 20)" } } },
    annotations: { readOnlyHint: true },
    async run({ company: c, limit }) {
      const cmp = await company(c);
      const data = await api("GET", `/v1/notify/inbox${q({ companyUid: cmp.uid, limit: limit || 20 })}`);
      const events = data.events || [];
      if (!events.length) return "Inbox is empty.";
      return events
        .map((e) => {
          const from = e.fromEmail || e.from?.email || e.senderEmail || e.fromPersonUid || e.from || "?";
          const when = e.createdAt || e.sentAt || e.timestamp || "";
          const text = e.body || e.message || e.text || "";
          return `- [${when}] from ${typeof from === "string" ? from : JSON.stringify(from)}: ${text}${e.prompt ? `\n  prompt: ${e.prompt}` : ""}`;
        })
        .join("\n");
    },
  },
  {
    name: "dm_thread",
    description: "Read your 1:1 message thread with one person or agent.",
    inputSchema: {
      type: "object",
      required: ["with"],
      properties: { ...companyProp, with: { type: "string", description: "Email or prs_/agt_ uid" }, limit: { type: "number" } },
    },
    annotations: { readOnlyHint: true },
    async run({ company: c, with: other, limit }) {
      const cmp = await company(c);
      const who = other.includes("@") ? { withEmail: other } : { withPersonUid: other };
      const data = await api("GET", `/v1/notify/thread${q({ companyUid: cmp.uid, ...who, limit: limit || 30 })}`);
      const msgs = (data.messages || []).slice().reverse();
      if (!msgs.length) return `No messages with ${other} yet.`;
      return msgs.map((m) => `- [${m.createdAt || m.sentAt || ""}] ${m.direction === "outgoing" || m.direction === "out" ? "you" : other}: ${m.body || m.text || ""}`).join("\n");
    },
  },
  {
    name: "skill_list",
    description: "List skills shared in your HQ company, and which ones are installed locally.",
    inputSchema: { type: "object", properties: { ...companyProp } },
    annotations: { readOnlyHint: true },
    async run({ company: c }) {
      const cmp = await company(c);
      const shelf = await api("GET", `/v1/skills/${cmp.uid}/shelf`);
      const skills = shelf.skills || [];
      if (!skills.length) return `No shared skills in ${cmp.slug} yet. Publish one with skill_publish.`;
      return (
        `Shared skills in ${cmp.slug}:\n` +
        skills
          .map((s) => {
            const slug = slugFromVaultPath(s.vaultPath) || s.name;
            const installed = existsSync(join(SKILLS_DIR, slug, "SKILL.md")) ? " [installed]" : "";
            return `- ${slug} (${s.skillUid})${installed}: ${s.description || ""}`;
          })
          .join("\n")
      );
    },
  },
  {
    name: "skill_install",
    description:
      "Install a shared company skill so your coding agents load it: ~/.claude/skills/<slug>/ (Claude Code, Claude desktop Code tab) and ~/.codex/skills/<slug>/ (Codex CLI and app, when installed). Never overwrites an existing local skill unless force is true. Installed skills only change when you install again.",
    inputSchema: {
      type: "object",
      required: ["skill"],
      properties: {
        ...companyProp,
        skill: { type: "string", description: "Skill slug, name, or skl_ uid" },
        target: { type: "string", enum: ["all", "claude", "codex"], description: "Where to install (default: all installed agents)" },
        force: { type: "boolean" },
      },
    },
    async run({ company: c, skill, target, force }) {
      const cmp = await company(c);
      const hit = await findSkill(cmp, skill);
      if (!hit) throw new Error(`No shared skill "${skill}" in ${cmp.slug}. Try skill_list.`);
      const full = await api("GET", `/v1/skills/${cmp.uid}/${hit.skillUid}`);
      const text = full.instructionText;
      if (!text) throw new Error("HQ returned an empty skill.");
      const slug = slugFromVaultPath(hit.vaultPath) || hit.name;
      const results = [];
      for (const t of skillTargets(target)) {
        const dir = join(SKILL_TARGETS[t], slug);
        const file = join(dir, "SKILL.md");
        const markerPath = join(dir, ".hq-lite.json");
        if (existsSync(file) && !force) {
          let ours = false;
          try {
            ours = JSON.parse(readFileSync(markerPath, "utf8")).skillUid === hit.skillUid;
          } catch {}
          results.push(`${t}: skipped, ${file} already exists${ours ? " (installed earlier from HQ)" : " and was not installed by HQ Lite"}; pass force: true to replace it`);
          continue;
        }
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, text);
        writeFileSync(
          markerPath,
          JSON.stringify({ skillUid: hit.skillUid, company: cmp.slug, contentHash: hit.currentContentHash || null, installedAt: new Date().toISOString() }, null, 2) + "\n"
        );
        results.push(`${t}: installed to ${file}`);
      }
      return (
        `${slug}${full.truncated ? " (HQ truncated the body; some content may be missing)" : ""}\n` +
        results.map((r) => `- ${r}`).join("\n") +
        "\nStart a new agent session to load it."
      );
    },
  },
  {
    name: "skill_publish",
    description: "Publish a local skill folder (must contain SKILL.md with name and description frontmatter) to your HQ company so teammates can install it.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { ...companyProp, path: { type: "string", description: "Path to the skill folder or its SKILL.md" } },
    },
    async run({ company: c, path }) {
      let file = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), path.replace(/^~(?=\/)/, homedir()));
      if (!file.endsWith("SKILL.md")) file = join(file, "SKILL.md");
      if (!existsSync(file)) throw new Error(`No SKILL.md at ${file}.`);
      const content = readFileSync(file, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm.name || !fm.description) throw new Error("SKILL.md needs frontmatter with name and description.");
      const slug = fm.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      const cmp = await company(c);
      const existing = await findSkill(cmp, slug);
      if (existing) throw new Error(`A skill named ${slug} already exists in ${cmp.slug} (${existing.skillUid}). Updating shared skills isn't in HQ Lite yet; rename it to publish a new one.`);
      const data = await api("POST", `/companies/${encodeURIComponent(cmp.slug)}/writes`, {
        path: `skills/${slug}/SKILL.md`,
        content,
        confirm: false,
        documentType: "skill",
        title: fm.name,
      });
      return `Published ${slug} to ${cmp.slug}${data.skillUid ? ` as ${data.skillUid}` : ""}. Teammates can install it with skill_install.`;
    },
  },
  {
    name: "lite_doctor",
    description: "Show your HQ login and companies, and check that HQ has no hooks, background processes, or launch agents on this machine.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async run() {
      const r = spawnSync("bash", [join(HERE, "..", "scripts", "doctor.sh")], { encoding: "utf8", timeout: 30000 });
      let out = (r.stdout || "") + (r.stderr || "");
      try {
        const list = await companies();
        out += `\nCompanies: ${list.map((x) => `${x.slug} (${x.uid})`).join(", ") || "none"}`;
      } catch (e) {
        out += `\nCompanies: ${e.message}`;
      }
      return out.trim();
    },
  },
];

serve({
  name: "hq-lite",
  version: VERSION,
  instructions:
    "HQ Lite gives you three things: HQ secrets (inject by name with secrets_exec, never ask for or print values), shared company skills (skill_list / skill_install / skill_publish), and direct messages to teammates and their agents (dm_*). Only read messages when the user asks.",
  tools,
});
