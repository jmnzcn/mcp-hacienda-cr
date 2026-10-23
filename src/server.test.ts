import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { HaciendaClient } from "./hacienda.js";
import { createServer } from "./server.js";
import { CABYS_CAFE, CONTRIBUYENTE, EXONERACION, NOT_FOUND, TIPO_CAMBIO, fakeFetch } from "./testing/fixtures.js";

/** Conecta un cliente MCP real al servidor por un transporte en memoria. */
async function connect(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const server = createServer(new HaciendaClient(fakeFetch(routes)));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

const text = (res: Awaited<ReturnType<Client["callTool"]>>) =>
  (res.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("servidor MCP", () => {
  it("expone las 5 herramientas, todas de solo lectura", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "buscar_cabys",
      "consultar_contribuyente",
      "consultar_exoneracion",
      "obtener_cabys",
      "tipo_de_cambio",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("tipo_de_cambio responde texto en colones y datos estructurados", async () => {
    const client = await connect({ "/indicadores/tc": { body: TIPO_CAMBIO } });
    const res = await client.callTool({ name: "tipo_de_cambio", arguments: {} });

    expect(text(res)).toContain("compra ₡452,44");
    expect(res.structuredContent).toMatchObject({ dolar: { venta: 456.32 } });
  });

  it("consultar_contribuyente muestra la situación y las actividades", async () => {
    const client = await connect({ "/fe/ae": { body: CONTRIBUYENTE } });
    const res = await client.callTool({ name: "consultar_contribuyente", arguments: { identificacion: "3-101-000046" } });

    expect(text(res)).toContain("COMPAÑIA NACIONAL DE FUERZA Y LUZ");
    expect(text(res)).toContain("al día (no moroso ni omiso)");
    expect(text(res)).toContain("3510.0");
  });

  it("consultar_contribuyente avisa si no existe", async () => {
    const client = await connect({ "/fe/ae": { status: 404, body: NOT_FOUND } });
    const res = await client.callTool({ name: "consultar_contribuyente", arguments: { identificacion: "3101999999" } });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ encontrado: false });
  });

  it("devuelve un error legible (sin excepción) si la identificación es inválida", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "consultar_contribuyente", arguments: { identificacion: "abcdefghij" } });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain("no es una identificación válida");
  });

  it("buscar_cabys lista códigos con su IVA", async () => {
    const client = await connect({ "/fe/cabys?q=": { body: { total: 1, cantidad: 1, cabys: [CABYS_CAFE] } } });
    const res = await client.callTool({ name: "buscar_cabys", arguments: { descripcion: "café" } });

    expect(text(res)).toContain("0161001010000 · IVA 1% · Café cereza, orgánico");
  });

  it("obtener_cabys muestra la jerarquía de categorías", async () => {
    const client = await connect({ "/fe/cabys?codigo=": { body: [CABYS_CAFE] } });
    const res = await client.callTool({ name: "obtener_cabys", arguments: { codigo: "0161001010000" } });

    expect(text(res)).toContain("Productos de la agricultura, silvicultura y pesca › ");
  });

  it("consultar_exoneracion indica la vigencia", async () => {
    const client = await connect({ "/fe/ex": { body: EXONERACION } });
    const res = await client.callTool({ name: "consultar_exoneracion", arguments: { autorizacion: "AL-00020402-24" } });

    expect(text(res)).toMatch(/AL-00020402-24 — (✅ vigente|❌ vencida)/);
    expect(text(res)).toContain("Porcentaje: 12%");
  });

  it("rechaza argumentos fuera de rango según el esquema", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "buscar_cabys", arguments: { descripcion: "café", limite: 500 } });
    expect(res.isError).toBe(true);
  });
});
