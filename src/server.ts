import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HaciendaClient, HaciendaError } from "./hacienda.js";

export const SERVER_NAME = "mcp-hacienda-cr";
export const SERVER_VERSION = "0.1.1";

const crc = (n: number) =>
  `₡${n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Resultado de una herramienta: texto legible + datos estructurados para el modelo. */
function ok(text: string, data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: data };
}

/** Errores esperables (formato inválido, API caída) se devuelven como texto, no como excepción. */
async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message =
      error instanceof HaciendaError ? error.message : `Error inesperado: ${error instanceof Error ? error.message : String(error)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function createServer(client = new HaciendaClient()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Consulta datos públicos del Ministerio de Hacienda de Costa Rica: tipo de cambio, situación tributaria de contribuyentes, códigos CABYS con su IVA y exoneraciones. Útil para facturación electrónica. Los datos vienen de api.hacienda.go.cr y son de referencia: confirma decisiones fiscales con un contador.",
    }
  );

  server.registerTool(
    "tipo_de_cambio",
    {
      title: "Tipo de cambio del día",
      description:
        "Tipo de cambio de referencia de hoy según Hacienda: dólar (compra y venta en colones) y euro (en colones y en dólares).",
      annotations: READ_ONLY,
    },
    () =>
      run(async () => {
        const tc = await client.tipoDeCambio();
        return ok(
          [
            `Tipo de cambio al ${tc.fecha} (Ministerio de Hacienda):`,
            `- Dólar: compra ${crc(tc.dolar.compra)} · venta ${crc(tc.dolar.venta)}`,
            `- Euro: ${crc(tc.euro.colones)} · US$${tc.euro.dolares}`,
          ].join("\n"),
          { ...tc }
        );
      })
  );

  server.registerTool(
    "consultar_contribuyente",
    {
      title: "Consultar contribuyente",
      description:
        "Situación tributaria de una persona o empresa en Hacienda a partir de su cédula física, jurídica, DIMEX o NITE: nombre, régimen, estado, si está morosa u omisa y sus actividades económicas. Útil antes de emitir una factura electrónica.",
      inputSchema: {
        identificacion: z
          .string()
          .min(9)
          .describe('Número de identificación, con o sin guiones. Ej: "3-101-000046" o "112340567".'),
      },
      annotations: READ_ONLY,
    },
    ({ identificacion }) =>
      run(async () => {
        const c = await client.contribuyente(identificacion);
        if (!c) {
          return ok(`Hacienda no tiene registrado un contribuyente con la identificación ${identificacion}.`, {
            encontrado: false,
          });
        }
        const alertas = [c.moroso && "MOROSO", c.omiso && "OMISO"].filter(Boolean);
        const actividades = c.actividades.length
          ? c.actividades
              .map((a) => `  - ${a.codigo} ${a.descripcion}${a.principal ? " (principal)" : ""}${a.activa ? "" : " [inactiva]"}`)
              .join("\n")
          : "  - Sin actividades registradas";
        return ok(
          [
            `${c.nombre} (${c.tipoIdentificacion} ${c.identificacion})`,
            `- Estado: ${c.estado} · ${c.regimen}`,
            `- Situación: ${alertas.length ? `⚠️ ${alertas.join(" y ")}` : "al día (no moroso ni omiso)"}`,
            `- Administración: ${c.administracionTributaria}`,
            `- Actividades económicas:`,
            actividades,
          ].join("\n"),
          { encontrado: true, ...c }
        );
      })
  );

  server.registerTool(
    "buscar_cabys",
    {
      title: "Buscar código CABYS",
      description:
        "Busca en el catálogo CABYS (Catálogo de Bienes y Servicios) los códigos que corresponden a un producto o servicio, con su tarifa de IVA. Todo bien o servicio de una factura electrónica en Costa Rica necesita su código CABYS.",
      inputSchema: {
        descripcion: z.string().min(2).describe('Producto o servicio a buscar. Ej: "café tostado", "consultoría informática".'),
        limite: z.number().int().min(1).max(50).default(10).describe("Cantidad máxima de resultados (1–50)."),
      },
      annotations: READ_ONLY,
    },
    ({ descripcion, limite }) =>
      run(async () => {
        const { total, resultados } = await client.buscarCabys(descripcion, limite);
        if (resultados.length === 0) {
          return ok(`No hay códigos CABYS para "${descripcion}". Prueba con otras palabras o un término más general.`, {
            total: 0,
            resultados: [],
          });
        }
        const lineas = resultados.map((c) => `- ${c.codigo} · IVA ${c.iva}% · ${c.descripcion}`);
        return ok(
          [`${total} códigos CABYS para "${descripcion}" (mostrando ${resultados.length}):`, ...lineas].join("\n"),
          { total, resultados }
        );
      })
  );

  server.registerTool(
    "obtener_cabys",
    {
      title: "Detalle de un código CABYS",
      description: "Descripción, tarifa de IVA y categorías de un código CABYS de 13 dígitos.",
      inputSchema: {
        codigo: z.string().describe('Código CABYS de 13 dígitos. Ej: "0161001010000".'),
      },
      annotations: READ_ONLY,
    },
    ({ codigo }) =>
      run(async () => {
        const c = await client.obtenerCabys(codigo);
        if (!c) return ok(`El código CABYS ${codigo} no existe en el catálogo de Hacienda.`, { encontrado: false });
        return ok(
          [`${c.codigo} · ${c.descripcion}`, `- IVA: ${c.iva}%`, `- Categoría: ${c.categorias.join(" › ")}`].join("\n"),
          { encontrado: true, ...c }
        );
      })
  );

  server.registerTool(
    "consultar_exoneracion",
    {
      title: "Consultar exoneración",
      description:
        "Datos de una exoneración de impuestos registrada en Hacienda a partir de su número de autorización: beneficiario, porcentaje, vigencia y códigos CABYS que cubre.",
      inputSchema: {
        autorizacion: z.string().min(3).describe('Número de documento de la exoneración. Ej: "AL-00020402-24".'),
      },
      annotations: READ_ONLY,
    },
    ({ autorizacion }) =>
      run(async () => {
        const e = await client.exoneracion(autorizacion);
        if (!e) return ok(`Hacienda no tiene registrada la exoneración ${autorizacion}.`, { encontrado: false });
        return ok(
          [
            `Exoneración ${e.autorizacion} — ${e.vigente ? "✅ vigente" : "❌ vencida"}`,
            `- Beneficiario: ${e.identificacion}`,
            `- Porcentaje: ${e.porcentaje}%`,
            `- Vigencia: ${e.fechaEmision} → ${e.fechaVencimiento}`,
            `- Tipo: ${e.tipoDocumento} (${e.institucion})`,
            `- Cubre ${e.cabys.length} códigos CABYS`,
          ].join("\n"),
          { encontrado: true, ...e }
        );
      })
  );

  return server;
}
