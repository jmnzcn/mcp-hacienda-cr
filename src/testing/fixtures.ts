import { vi } from "vitest";

// Respuestas reales de api.hacienda.go.cr (octubre de 2026), recortadas
export const TIPO_CAMBIO = {
  dolar: {
    venta: { fecha: "2026-10-23", valor: 456.32 },
    compra: { fecha: "2026-10-23", valor: 452.44 },
  },
  euro: { fecha: "2026-10-23", dolares: 1.1197, colones: 510.94 },
};

export const CONTRIBUYENTE = {
  nombre: "COMPAÑIA NACIONAL DE FUERZA Y LUZ SOCIEDAD ANONIMA",
  tipoIdentificacion: "02",
  regimen: { codigo: 1, descripcion: "Régimen general" },
  situacion: {
    moroso: "NO",
    omiso: "NO",
    estado: "Inscrito",
    administracionTributaria: "Dirección de Grandes Contribuyentes Nacionales",
  },
  actividades: [
    {
      estado: "A",
      tipo: "P",
      codigo: "3510.0",
      descripcion: "Generación , transmisión y distribución de energía eléctrica",
    },
  ],
};

export const CABYS_CAFE = {
  codigo: "0161001010000",
  descripcion: "Café cereza, orgánico",
  categorias: [
    "Productos de la agricultura, silvicultura y pesca",
    "Productos de la agricultura, horticultura y jardinería comercial",
    "Cultivos estimulantes, de especias y aromáticos",
    "Café, verde",
    "Café, verde",
    "Café cereza",
    "Café cereza, orgánico",
    "Café cereza, orgánico",
  ],
  impuesto: 1,
  uri: "https://api.hacienda.go.cr/fe/cabys?codigo=0161001010000",
  estado: "",
};

export const EXONERACION = {
  numeroDocumento: "AL-00020402-24",
  identificacion: "3004061893",
  porcentajeExoneracion: 12,
  fechaEmision: "2024-06-10T00:00:00",
  fechaVencimiento: "2030-06-10T00:00:00",
  cabys: ["0113200000000", "1201000009900"],
  tipoAutorizacion: "tarifa reducida",
  tipoDocumento: { codigo: "04", descripcion: "Exenciones Dirección General de Hacienda" },
  nombreInstitucion: "Ministerio de Hacienda",
};

export const NOT_FOUND = {
  code: 404,
  status: "Information no available on this system, please try again with new values",
};

type Route = { status?: number; body: unknown } | ((url: URL) => { status?: number; body: unknown });

/** `fetch` simulado que responde según la ruta + query de api.hacienda.go.cr. */
export function fakeFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = Object.keys(routes).find((k) => `${url.pathname}${url.search}`.startsWith(k));
    if (!key) throw new Error(`Ruta no simulada: ${url.pathname}${url.search}`);
    const route = routes[key]!;
    const { status = 200, body } = typeof route === "function" ? route(url) : route;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
