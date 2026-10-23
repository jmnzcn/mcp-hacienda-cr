/**
 * Cliente de las APIs públicas del Ministerio de Hacienda de Costa Rica
 * (https://api.hacienda.go.cr). No requieren registro ni token.
 */

export const HACIENDA_BASE_URL = "https://api.hacienda.go.cr";

const TIMEOUT_MS = 15_000;

/** Error con un mensaje pensado para mostrarse tal cual al usuario final. */
export class HaciendaError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "HaciendaError";
  }
}

export interface TipoDeCambio {
  fecha: string;
  dolar: { compra: number; venta: number };
  euro: { colones: number; dolares: number };
}

export type TipoIdentificacion = "Cédula física" | "Cédula jurídica" | "DIMEX" | "NITE";

export interface Contribuyente {
  identificacion: string;
  nombre: string;
  tipoIdentificacion: TipoIdentificacion | string;
  regimen: string;
  estado: string;
  moroso: boolean;
  omiso: boolean;
  administracionTributaria: string;
  actividades: { codigo: string; descripcion: string; activa: boolean; principal: boolean }[];
}

export interface Cabys {
  codigo: string;
  descripcion: string;
  /** Tarifa de IVA en porcentaje (13, 4, 2, 1, 0.5 o 0). */
  iva: number;
  categorias: string[];
}

export interface Exoneracion {
  autorizacion: string;
  identificacion: string;
  porcentaje: number;
  fechaEmision: string;
  fechaVencimiento: string;
  vigente: boolean;
  tipoDocumento: string;
  institucion: string;
  cabys: string[];
}

const TIPOS_IDENTIFICACION: Record<string, TipoIdentificacion> = {
  "01": "Cédula física",
  "02": "Cédula jurídica",
  "03": "DIMEX",
  "04": "NITE",
};

/** Quita guiones y espacios: "3-101-000046" → "3101000046". */
export function normalizarIdentificacion(identificacion: string): string {
  return identificacion.replace(/[\s-]/g, "");
}

/**
 * Valida el formato de una identificación costarricense antes de consultar a Hacienda
 * (que responde con una página HTML si el formato no es numérico).
 * Física: 9 dígitos · Jurídica y NITE: 10 · DIMEX: 11 o 12.
 */
export function validarIdentificacion(identificacion: string): string {
  const id = normalizarIdentificacion(identificacion);
  if (!/^\d{9,12}$/.test(id)) {
    throw new HaciendaError(
      `"${identificacion}" no es una identificación válida: debe tener entre 9 y 12 dígitos (física: 9, jurídica/NITE: 10, DIMEX: 11 o 12).`
    );
  }
  return id;
}

type Fetch = typeof fetch;

export class HaciendaClient {
  private cache = new Map<string, { expires: number; value: unknown }>();

  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = HACIENDA_BASE_URL
  ) {}

  /** GET con timeout; devuelve `null` en 404 (el recurso no existe). */
  private async get<T>(path: string, cacheMs = 0): Promise<T | null> {
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) return cached.value as T;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "mcp-hacienda-cr" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "no respondió a tiempo" : "no está disponible";
      throw new HaciendaError(`La API de Hacienda ${reason}. Intenta de nuevo en unos minutos.`);
    }

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new HaciendaError(
        `La API de Hacienda respondió con error ${res.status}. Intenta de nuevo en unos minutos.`,
        res.status
      );
    }

    let value: T;
    try {
      value = (await res.json()) as T;
    } catch {
      throw new HaciendaError("La API de Hacienda devolvió una respuesta inesperada (no es JSON).");
    }
    if (cacheMs > 0) this.cache.set(path, { expires: Date.now() + cacheMs, value });
    return value;
  }

  /** Tipo de cambio de referencia del día (cacheado 10 minutos). */
  async tipoDeCambio(): Promise<TipoDeCambio> {
    const data = await this.get<{
      dolar: { venta: { fecha: string; valor: number }; compra: { fecha: string; valor: number } };
      euro: { fecha: string; dolares: number; colones: number };
    }>("/indicadores/tc", 10 * 60_000);
    if (!data) throw new HaciendaError("Hacienda no devolvió el tipo de cambio.");

    return {
      fecha: data.dolar.venta.fecha,
      dolar: { compra: data.dolar.compra.valor, venta: data.dolar.venta.valor },
      euro: { colones: data.euro.colones, dolares: data.euro.dolares },
    };
  }

  /** Situación tributaria de un contribuyente; `null` si Hacienda no lo tiene registrado. */
  async contribuyente(identificacion: string): Promise<Contribuyente | null> {
    const id = validarIdentificacion(identificacion);
    const data = await this.get<{
      nombre: string;
      tipoIdentificacion: string;
      regimen?: { descripcion: string };
      situacion?: { moroso: string; omiso: string; estado: string; administracionTributaria: string };
      actividades?: { estado: string; tipo: string; codigo: string; descripcion: string }[];
    }>(`/fe/ae?identificacion=${id}`, 60 * 60_000);
    if (!data) return null;

    return {
      identificacion: id,
      nombre: data.nombre,
      tipoIdentificacion: TIPOS_IDENTIFICACION[data.tipoIdentificacion] ?? data.tipoIdentificacion,
      regimen: data.regimen?.descripcion ?? "No informado",
      estado: data.situacion?.estado ?? "No informado",
      moroso: data.situacion?.moroso === "SI",
      omiso: data.situacion?.omiso === "SI",
      administracionTributaria: data.situacion?.administracionTributaria ?? "No informada",
      actividades: (data.actividades ?? []).map((a) => ({
        codigo: a.codigo,
        descripcion: a.descripcion.trim(),
        activa: a.estado === "A",
        principal: a.tipo === "P",
      })),
    };
  }

  /** Busca códigos CABYS por texto. */
  async buscarCabys(descripcion: string, limite = 10): Promise<{ total: number; resultados: Cabys[] }> {
    const q = encodeURIComponent(descripcion.trim());
    const data = await this.get<{ total: number; cabys: RawCabys[] }>(`/fe/cabys?q=${q}&top=${limite}`, 60 * 60_000);
    return { total: data?.total ?? 0, resultados: (data?.cabys ?? []).map(toCabys) };
  }

  /** Detalle de un código CABYS de 13 dígitos; `null` si no existe. */
  async obtenerCabys(codigo: string): Promise<Cabys | null> {
    const limpio = codigo.replace(/\D/g, "");
    if (limpio.length !== 13) {
      throw new HaciendaError(`"${codigo}" no es un código CABYS válido: debe tener 13 dígitos.`);
    }
    const data = await this.get<RawCabys[]>(`/fe/cabys?codigo=${limpio}`, 60 * 60_000);
    const item = data?.[0];
    return item ? toCabys(item) : null;
  }

  /** Datos de una exoneración por su número de autorización (ej. "AL-00020402-24"). */
  async exoneracion(autorizacion: string, hoy = new Date()): Promise<Exoneracion | null> {
    const numero = autorizacion.trim().toUpperCase();
    const data = await this.get<{
      numeroDocumento: string;
      identificacion: string;
      porcentajeExoneracion: number;
      fechaEmision: string;
      fechaVencimiento: string;
      tipoDocumento?: { descripcion?: string };
      nombreInstitucion?: string;
      cabys?: string[];
    }>(`/fe/ex?autorizacion=${encodeURIComponent(numero)}`, 60 * 60_000);
    if (!data) return null;

    return {
      autorizacion: data.numeroDocumento,
      identificacion: data.identificacion,
      porcentaje: data.porcentajeExoneracion,
      fechaEmision: data.fechaEmision.slice(0, 10),
      fechaVencimiento: data.fechaVencimiento.slice(0, 10),
      vigente: new Date(data.fechaVencimiento) >= hoy,
      tipoDocumento: data.tipoDocumento?.descripcion ?? "No informado",
      institucion: data.nombreInstitucion ?? "No informada",
      cabys: data.cabys ?? [],
    };
  }
}

interface RawCabys {
  codigo: string;
  descripcion: string;
  impuesto: number;
  categorias?: string[];
}

function toCabys(raw: RawCabys): Cabys {
  return {
    codigo: raw.codigo,
    descripcion: raw.descripcion,
    iva: raw.impuesto,
    // Hacienda repite niveles de la jerarquía; se dejan solo los distintos y en orden
    categorias: [...new Set(raw.categorias ?? [])],
  };
}
