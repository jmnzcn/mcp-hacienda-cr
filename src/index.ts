#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout es el canal del protocolo MCP: cualquier log va a stderr
console.error("mcp-hacienda-cr listo (stdio)");
