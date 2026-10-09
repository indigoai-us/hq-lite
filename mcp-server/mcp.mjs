// Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited). No dependencies.
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

export function serve({ name, version, instructions, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = createInterface({ input: process.stdin });

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const { id, method, params } = req;
    if (id === undefined || id === null) return; // notification
    try {
      if (method === "initialize") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name, version },
            instructions,
          },
        });
      } else if (method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
      } else if (method === "tools/list") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map(({ name, description, inputSchema, annotations }) => ({
              name,
              description,
              inputSchema,
              ...(annotations ? { annotations } : {}),
            })),
          },
        });
      } else if (method === "tools/call") {
        const tool = byName.get(params?.name);
        if (!tool) {
          send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
          return;
        }
        try {
          const text = await tool.run(params.arguments || {});
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(text) }] } });
        } catch (err) {
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: String(err?.message || err) }], isError: true },
          });
        }
      } else {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (err) {
      send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(err?.message || err) } });
    }
  });
}
