// Prueba de humo: levanta el servidor compilado por stdio (como lo haría Claude)
// y llama a cada herramienta contra la API real de Hacienda.
// Uso: npm run build && node scripts/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"] });
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Herramientas: ${tools.map((t) => t.name).join(", ")}\n`);

const calls = [
  ["tipo_de_cambio", {}],
  ["consultar_contribuyente", { identificacion: "3-101-000046" }],
  ["buscar_cabys", { descripcion: "café tostado", limite: 3 }],
  ["obtener_cabys", { codigo: "0161001010000" }],
  ["consultar_exoneracion", { autorizacion: "AL-00020402-24" }],
];

let failed = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) failed++;
  console.log(`▶ ${name}${res.isError ? " (ERROR)" : ""}\n${res.content.map((c) => c.text).join("\n")}\n`);
}

await client.close();
process.exit(failed ? 1 : 0);
