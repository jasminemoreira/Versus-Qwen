#!/usr/bin/env node

// MCP Server — standalone process (stdio)
// Started by the VSCode extension or manually via `node server.js --workspace <path>`

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StateEngine } from "../state/engine";
import { ALL_TOOLS, handleToolCall } from "./tools/index";

function getWorkspacePath(): string {
  // Priority: --workspace arg > QWEN_PROJECT_DIR env > VERSUS_WORKSPACE env > cwd
  const args = process.argv.slice(2);
  const wsIndex = args.indexOf("--workspace");
  if (wsIndex !== -1 && args[wsIndex + 1]) {
    return args[wsIndex + 1];
  }
  if (process.env.QWEN_PROJECT_DIR) {
    return process.env.QWEN_PROJECT_DIR;
  }
  if (process.env.VERSUS_WORKSPACE) {
    return process.env.VERSUS_WORKSPACE;
  }
  return process.cwd();
}

async function main() {
  const workspacePath = getWorkspacePath();
  const engine = new StateEngine(workspacePath);
  engine.load();

  const server = new Server(
    {
      name: "versus-qwen",
      version: "0.6.1",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = handleToolCall(name, (args ?? {}) as Record<string, unknown>, engine);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Internal error: ${String(err)}` }),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Versus MCP Server fatal: ${String(err)}\n`);
  process.exit(1);
});
