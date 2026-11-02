/**
 * Validación de comprobantes electrónicos 4.4 de Costa Rica: el XML contra los esquemas oficiales
 * (incluidos en schemas/v4.4), las cuentas que esos esquemas documentan, y los datos que se pueden
 * cruzar con las APIs públicas de Hacienda (contribuyentes, CABYS, exoneraciones, tipo de cambio).
 */
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { validateXML } from "xmllint-wasm";
import { HaciendaError, type HaciendaClient } from "./hacienda.js";

const NS = "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/";
const SCHEMAS = new URL("../schemas/v4.4/", import.meta.url);

/** Raíz del XML → esquema, código de tipo en el consecutivo y nombre para mostrar. */
const TIPOS: Record<string, { esquema: string; codigos: string[]; nombre: string }> = {
  FacturaElectronica: { esquema: "facturaElectronica", codigos: ["01"], nombre: "Factura electrónica" },
  NotaDebitoElectronica: { esquema: "notaDebitoElectronica", codigos: ["02"], nombre: "Nota de débito electrónica" },
  NotaCreditoElectronica: { esquema: "notaCreditoElectronica", codigos: ["03"], nombre: "Nota de crédito electrónica" },
  TiqueteElectronico: { esquema: "tiqueteElectronico", codigos: ["04"], nombre: "Tiquete electrónico" },
  MensajeReceptor: { esquema: "mensajeReceptor", codigos: ["05", "06", "07"], nombre: "Mensaje receptor" },
  FacturaElectronicaCompra: { esquema: "facturaElectronicaCompra", codigos: ["08"], nombre: "Factura electrónica de compra" },
  FacturaElectronicaExportacion: {
    esquema: "facturaElectronicaExportacion",
    codigos: ["09"],
    nombre: "Factura electrónica de exportación",
  },
  ReciboElectronicoPago: { esquema: "reciboElectronicoPago", codigos: ["10"], nombre: "Recibo electrónico de pago" },
};

/** CodigoTarifaIVA → tarifa en porcentaje, según CodigoTarifaIVAType del esquema 4.4. */
export const TARIFAS_IVA: Record<string, number> = {
  "01": 0, "02": 1, "03": 2, "04": 4, "05": 0, "06": 4, "07": 8, "08": 13, "09": 0.5, "10": 0, "11": 0,
};

export type Nivel = "error" | "advertencia" | "info";

export interface Hallazgo {
  nivel: Nivel;
  /** Dónde está el problema, ej. "Línea 2 › SubTotal". */
  campo: string;
  mensaje: string;
}

export interface Resultado {
  tipo: string | null;
  /** Cumple el esquema oficial (sin contar la firma si no viene firmado). */
  esquemaValido: boolean;
  firmado: boolean;
  /** Sin errores de esquema, de cuentas ni de datos de Hacienda. */
  valido: boolean;
  hallazgos: Hallazgo[];
}

const LISTAS = new Set([
  "LineaDetalle", "Impuesto", "Descuento", "Exoneracion", "MedioPago", "OtrosCargos", "TotalDesgloseImpuesto",
  "InformacionReferencia",
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => LISTAS.has(name),
});

type Nodo = Record<string, any>;

const esquemas = new Map<string, string>();
function esquema(nombre: string): string {
  let texto = esquemas.get(nombre);
  if (!texto) {
    texto = readFileSync(new URL(`${nombre}.xsd`, SCHEMAS), "utf8");
    esquemas.set(nombre, texto);
  }
  return texto;
}

/** Quita el prefijo del espacio de nombres de libxml2 para que el mensaje se lea. */
function limpiarMensaje(mensaje: string): string {
  return mensaje
    .replace(/^.*?Schemas validity error : /, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valida el XML contra el esquema 4.4 de su tipo. Sin firma, lo valida como borrador. */
export async function validarEsquema(xml: string): Promise<{ tipo: string | null; firmado: boolean; errores: Hallazgo[] }> {
  // La primera etiqueta que no es declaración ni comentario; su espacio de nombres es el del prefijo que usa
  const inicio = xml.match(/<(?:([\w-]+):)?([A-Za-z]+)([^>]*)>/);
  const raiz = inicio?.[2];
  const prefijo = inicio?.[1];
  const ns = inicio?.[3].match(new RegExp(`xmlns${prefijo ? `:${prefijo}` : ""}="([^"]+)"`))?.[1] ?? "";
  const tipo = raiz && TIPOS[raiz] ? raiz : null;
  const firmado = /<(?:[\w-]+:)?Signature[\s>]/.test(xml);

  if (!tipo) {
    return {
      tipo: null,
      firmado,
      errores: [
        {
          nivel: "error",
          campo: raiz ?? "XML",
          mensaje: raiz
            ? `"${raiz}" no es un comprobante electrónico. Se esperaba: ${Object.keys(TIPOS).join(", ")}.`
            : "No se encontró un elemento raíz: el texto no parece XML.",
        },
      ],
    };
  }
  const esperado = NS + TIPOS[tipo].esquema;
  if (ns !== esperado) {
    const version = ns.match(/xml-schemas\/v([\d.]+)\//)?.[1];
    return {
      tipo,
      firmado,
      errores: [
        {
          nivel: "error",
          campo: tipo,
          mensaje: version
            ? `El comprobante usa la versión ${version}. Desde el 1 de septiembre de 2025 solo se acepta la 4.4 (espacio de nombres ${esperado}).`
            : `El espacio de nombres debe ser ${esperado}; el comprobante trae "${ns || "ninguno"}".`,
        },
      ],
    };
  }

  let xsd = esquema(TIPOS[tipo].esquema);
  if (!firmado) xsd = xsd.replace('ref="ds:Signature" minOccurs="1"', 'ref="ds:Signature" minOccurs="0"');
  const resultado = await validateXML({
    xml: [{ fileName: "comprobante.xml", contents: xml }],
    schema: [{ fileName: `${TIPOS[tipo].esquema}.xsd`, contents: xsd }],
    preload: [{ fileName: "xmldsig-core-schema.xsd", contents: esquema("xmldsig-core-schema") }],
  });
  const errores: Hallazgo[] = resultado.errors.map((e) => ({
    nivel: "error",
    campo: e.loc ? `Línea ${e.loc.lineNumber} del XML` : "XML",
    mensaje: limpiarMensaje(e.rawMessage ?? e.message),
  }));
  return { tipo, firmado, errores };
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const suma = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const fmt = (n: number) => n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 5 });

/** Margen para redondeos: los montos llevan hasta 5 decimales, se compara al céntimo. */
const MARGEN = 0.01;

/** Registra un error si `actual` no coincide con `esperado` (o con ninguno, si la regla admite dos lecturas). */
function cuadra(hallazgos: Hallazgo[], campo: string, actual: number | null, esperados: number | number[], regla: string) {
  if (actual === null) return;
  const opciones = Array.isArray(esperados) ? esperados : [esperados];
  const esperado = opciones[0]!;
  if (opciones.every((e) => Math.abs(actual - e) > MARGEN)) {
    hallazgos.push({
      nivel: "error",
      campo,
      mensaje: `Dice ${fmt(actual)} pero ${regla} da ${fmt(esperado)} (diferencia ${fmt(actual - esperado)}).`,
    });
  }
}

/** Revisa la clave, el consecutivo y las cuentas de líneas y resumen, sin consultar a Hacienda. */
export function revisarCoherencia(tipo: string, doc: Nodo): Hallazgo[] {
  const h: Hallazgo[] = [];
  const clave: string = doc.Clave ?? "";
  const consecutivo: string = doc.NumeroConsecutivo ?? doc.NumeroConsecutivoReceptor ?? "";

  if (clave.length === 50) {
    if (clave.slice(0, 3) !== "506") h.push({ nivel: "error", campo: "Clave", mensaje: `Debe empezar con 506 (Costa Rica); empieza con ${clave.slice(0, 3)}.` });
    const fecha = String(doc.FechaEmision ?? doc.FechaEmisionDoc ?? "").slice(0, 10);
    if (tipo !== "MensajeReceptor" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      const ddmmaa = fecha.slice(8, 10) + fecha.slice(5, 7) + fecha.slice(2, 4);
      if (clave.slice(3, 9) !== ddmmaa) {
        h.push({ nivel: "error", campo: "Clave", mensaje: `Las posiciones 4–9 deben ser la fecha de emisión (${ddmmaa}); dicen ${clave.slice(3, 9)}.` });
      }
    }
    const ids = [doc.Emisor?.Identificacion?.Numero, doc.Receptor?.Identificacion?.Numero]
      .filter(Boolean)
      .map((n: string) => String(n).padStart(12, "0"));
    const emisorClave = clave.slice(9, 21);
    if (tipo !== "MensajeReceptor" && ids.length && !(tipo === "FacturaElectronicaCompra" ? ids : ids.slice(0, 1)).includes(emisorClave)) {
      h.push({ nivel: "error", campo: "Clave", mensaje: `Las posiciones 10–21 deben ser la identificación del emisor (${ids[0]}); dicen ${emisorClave}.` });
    }
    if (tipo !== "MensajeReceptor" && consecutivo && clave.slice(21, 41) !== consecutivo) {
      h.push({ nivel: "error", campo: "Clave", mensaje: `Las posiciones 22–41 deben ser el número consecutivo (${consecutivo}); dicen ${clave.slice(21, 41)}.` });
    }
    if (!["1", "2", "3"].includes(clave[41])) {
      h.push({ nivel: "error", campo: "Clave", mensaje: `La posición 42 es la situación del comprobante (1 normal, 2 contingencia, 3 sin internet); dice ${clave[41]}.` });
    }
  }
  if (consecutivo.length === 20 && !TIPOS[tipo].codigos.includes(consecutivo.slice(8, 10))) {
    h.push({
      nivel: "error",
      campo: "NumeroConsecutivo",
      mensaje: `Las posiciones 9–10 son el tipo de comprobante: para ${TIPOS[tipo].nombre.toLowerCase()} van ${TIPOS[tipo].codigos.join(" o ")}; dicen ${consecutivo.slice(8, 10)}.`,
    });
  }

  const lineas: Nodo[] = doc.DetalleServicio?.LineaDetalle ?? [];
  // Por código de impuesto: [monto cobrado, monto neto de exoneraciones]. El esquema dice "monto del
  // impuesto" para los totales sin aclarar si va antes o después de exonerar, así que se aceptan los dos.
  const desglose = new Map<string, [number, number]>();
  let totalDescuentos = 0;
  for (const l of lineas) {
    const n = `Línea ${l.NumeroLinea ?? lineas.indexOf(l) + 1}`;
    const cantidad = num(l.Cantidad), precio = num(l.PrecioUnitario), montoTotal = num(l.MontoTotal), subTotal = num(l.SubTotal);
    const descuentos = suma((l.Descuento ?? []).map((d: Nodo) => num(d.MontoDescuento)));
    totalDescuentos += descuentos;
    if (cantidad !== null && precio !== null) cuadra(h, `${n} › MontoTotal`, montoTotal, cantidad * precio, "cantidad × precio unitario");
    if (montoTotal !== null) cuadra(h, `${n} › SubTotal`, subTotal, montoTotal - descuentos, "monto total − descuentos");

    const impuestos: Nodo[] = l.Impuesto ?? [];
    let exonerado = 0;
    for (const i of impuestos) {
      const exoneradoAqui = suma((i.Exoneracion ?? []).map((e: Nodo) => num(e.MontoExoneracion)));
      const tarifa = num(i.Tarifa), monto = num(i.Monto);
      if (i.Codigo === "01" && i.CodigoTarifaIVA && TARIFAS_IVA[i.CodigoTarifaIVA] !== undefined && tarifa !== null
          && TARIFAS_IVA[i.CodigoTarifaIVA] !== tarifa) {
        h.push({ nivel: "error", campo: `${n} › Impuesto › Tarifa`, mensaje: `El código de tarifa ${i.CodigoTarifaIVA} corresponde a ${TARIFAS_IVA[i.CodigoTarifaIVA]}%, pero la tarifa dice ${tarifa}%.` });
      }
      const base = num(l.BaseImponible) ?? subTotal;
      if (i.Codigo === "01" && tarifa !== null && base !== null) cuadra(h, `${n} › Impuesto › Monto`, monto, (base * tarifa) / 100, `base imponible × ${tarifa}%`);
      exonerado += exoneradoAqui;
      if (i.Codigo) {
        const k = `${i.Codigo}|${i.CodigoTarifaIVA ?? ""}`;
        const [bruto, neto] = desglose.get(k) ?? [0, 0];
        desglose.set(k, [bruto + (monto ?? 0), neto + (monto ?? 0) - exoneradoAqui]);
      }
    }
    const neto = suma(impuestos.map((i) => num(i.Monto))) - exonerado - (num(l.ImpuestoAsumidoEmisorFabrica) ?? 0);
    if (impuestos.length) cuadra(h, `${n} › ImpuestoNeto`, num(l.ImpuestoNeto), neto, "impuesto − exonerado − asumido por el emisor");
    if (subTotal !== null) cuadra(h, `${n} › MontoTotalLinea`, num(l.MontoTotalLinea), subTotal + (num(l.ImpuestoNeto) ?? neto), "subtotal + impuesto neto");
  }

  const r: Nodo | undefined = doc.ResumenFactura;
  if (r && lineas.length) {
    const v = (k: string) => num(r[k]) ?? 0;
    cuadra(h, "Resumen › TotalGravado", num(r.TotalGravado), v("TotalServGravados") + v("TotalMercanciasGravadas"), "servicios + mercancías gravados");
    cuadra(h, "Resumen › TotalExento", num(r.TotalExento), v("TotalServExentos") + v("TotalMercanciasExentas"), "servicios + mercancías exentos");
    cuadra(h, "Resumen › TotalExonerado", num(r.TotalExonerado), v("TotalServExonerado") + v("TotalMercExonerada"), "servicios + mercancías exonerados");
    cuadra(h, "Resumen › TotalNoSujeto", num(r.TotalNoSujeto), v("TotalServNoSujeto") + v("TotalMercNoSujeta"), "servicios + mercancías no sujetos");
    const categorias = ["TotalGravado", "TotalExento", "TotalExonerado", "TotalNoSujeto"];
    if (categorias.some((k) => r[k] !== undefined)) {
      cuadra(h, "Resumen › TotalVenta", num(r.TotalVenta), suma(categorias.map(v)), "gravado + exento + exonerado + no sujeto");
    }
    cuadra(h, "Resumen › TotalVenta", num(r.TotalVenta), suma(lineas.map((l) => num(l.MontoTotal))), "la suma del monto total de las líneas");
    cuadra(h, "Resumen › TotalDescuentos", num(r.TotalDescuentos) ?? 0, totalDescuentos, "la suma de los descuentos de las líneas");
    cuadra(h, "Resumen › TotalVentaNeta", num(r.TotalVentaNeta), v("TotalVenta") - v("TotalDescuentos"), "total venta − descuentos");
    const netos = suma(lineas.map((l) => num(l.ImpuestoNeto)));
    const brutos = suma(lineas.flatMap((l) => (l.Impuesto ?? []).map((i: Nodo) => num(i.Monto))));
    cuadra(h, "Resumen › TotalImpuesto", num(r.TotalImpuesto) ?? 0, [netos, brutos], "la suma del impuesto neto de las líneas");
    cuadra(h, "Resumen › TotalOtrosCargos", num(r.TotalOtrosCargos) ?? 0, suma((doc.OtrosCargos ?? []).map((o: Nodo) => num(o.MontoCargo))), "la suma de otros cargos");
    cuadra(h, "Resumen › TotalComprobante", num(r.TotalComprobante),
      v("TotalVentaNeta") + v("TotalImpuesto") + v("TotalOtrosCargos") - v("TotalIVADevuelto"), "venta neta + impuesto + otros cargos − IVA devuelto");
    for (const d of r.TotalDesgloseImpuesto ?? []) {
      const k = `${d.Codigo}|${d.CodigoTarifaIVA ?? ""}`;
      cuadra(h, `Resumen › Desglose ${d.Codigo}${d.CodigoTarifaIVA ? ` tarifa ${d.CodigoTarifaIVA}` : ""}`, num(d.TotalMontoImpuesto), desglose.get(k) ?? [0],
        "la suma de ese impuesto en las líneas");
    }
    const pagos: Nodo[] = r.MedioPago ?? [];
    if (pagos.length > 1 && pagos.every((p) => p.TotalMedioPago !== undefined)) {
      cuadra(h, "Resumen › MedioPago", suma(pagos.map((p) => num(p.TotalMedioPago))), v("TotalComprobante"), "el total del comprobante");
    }
  }
  return h;
}

/** Normaliza un código de actividad ("3510.0", "351000") a sus 6 dígitos. */
const actividad = (codigo: string) => codigo.replace(/\D/g, "").padEnd(6, "0").slice(0, 6);

const fechaDe = (v: unknown) => String(v ?? "").slice(0, 10);

/** Cruza el comprobante con Hacienda. Una consulta que falla no invalida: se informa como advertencia. */
export async function revisarConHacienda(tipo: string, doc: Nodo, client: HaciendaClient): Promise<Hallazgo[]> {
  const h: Hallazgo[] = [];
  const intentar = async <T>(campo: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof HaciendaError ? error.message : String(error);
      h.push({ nivel: "advertencia", campo, mensaje: `No se pudo verificar con Hacienda: ${msg}` });
      return undefined;
    }
  };
  const tareas: Promise<void>[] = [];

  const partes: [string, Nodo | undefined, string | undefined][] = [
    ["Emisor", doc.Emisor, doc.CodigoActividadEmisor],
    ["Receptor", doc.Receptor, doc.CodigoActividadReceptor],
  ];
  for (const [rol, parte, codigoActividad] of partes) {
    const tipoId = parte?.Identificacion?.Tipo;
    const numero = parte?.Identificacion?.Numero;
    // 05 extranjero no domiciliado y 06 no contribuyente no están en el registro de Hacienda
    if (!numero || !["01", "02", "03", "04"].includes(tipoId)) continue;
    const exportacion = rol === "Receptor" && tipo === "FacturaElectronicaExportacion";
    if (exportacion) continue;
    tareas.push(
      (async () => {
        const c = await intentar(rol, () => client.contribuyente(numero));
        if (c === undefined) return;
        if (c === null) {
          const nivel: Nivel = rol === "Emisor" && tipo !== "FacturaElectronicaCompra" ? "error" : "advertencia";
          h.push({ nivel, campo: `${rol} › Identificacion`, mensaje: `Hacienda no tiene registrado al contribuyente ${numero}.` });
          return;
        }
        if (rol === "Emisor" && tipo !== "FacturaElectronicaCompra" && c.estado.toLowerCase() !== "inscrito") {
          h.push({ nivel: "advertencia", campo: "Emisor", mensaje: `${c.nombre} aparece en Hacienda como "${c.estado}", no como inscrito.` });
        }
        if (c.moroso || c.omiso) {
          h.push({ nivel: "info", campo: rol, mensaje: `${c.nombre} aparece como ${[c.moroso && "moroso", c.omiso && "omiso"].filter(Boolean).join(" y ")} ante Hacienda.` });
        }
        if (codigoActividad) {
          const activas = c.actividades.filter((a) => a.activa);
          if (activas.length && !activas.some((a) => actividad(a.codigo) === actividad(codigoActividad))) {
            h.push({
              nivel: "advertencia",
              campo: `CodigoActividad${rol}`,
              mensaje: `La actividad ${codigoActividad} no aparece entre las actividades activas de ${c.nombre} en Hacienda: ${activas.map((a) => `${a.codigo} ${a.descripcion}`).join("; ")}.`,
            });
          }
        }
      })()
    );
  }

  const fecha = fechaDe(doc.FechaEmision);
  const lineas: Nodo[] = doc.DetalleServicio?.LineaDetalle ?? [];
  const codigos = [...new Set(lineas.map((l) => l.CodigoCABYS).filter(Boolean))].slice(0, 50);
  const cabys = new Map<string, Awaited<ReturnType<HaciendaClient["obtenerCabys"]>>>();
  tareas.push(
    ...codigos.map(async (codigo) => {
      const c = await intentar(`CABYS ${codigo}`, () => client.obtenerCabys(codigo));
      if (c !== undefined) cabys.set(codigo, c);
    })
  );

  const autorizaciones = new Set<string>();
  for (const l of lineas) for (const i of l.Impuesto ?? []) for (const e of i.Exoneracion ?? []) if (e.NumeroDocumento) autorizaciones.add(e.NumeroDocumento);
  const exoneraciones = new Map<string, Awaited<ReturnType<HaciendaClient["exoneracion"]>>>();
  tareas.push(
    ...[...autorizaciones].map(async (a) => {
      const e = await intentar(`Exoneración ${a}`, () => client.exoneracion(a, fecha ? new Date(`${fecha}T12:00:00-06:00`) : undefined));
      if (e !== undefined) exoneraciones.set(a, e);
    })
  );

  const moneda = doc.ResumenFactura?.CodigoTipoMoneda;
  let tc: Awaited<ReturnType<HaciendaClient["tipoDeCambio"]>> | undefined;
  if (moneda?.CodigoMoneda === "USD") tareas.push((async () => { tc = await intentar("TipoCambio", () => client.tipoDeCambio()); })());

  await Promise.all(tareas);

  for (const l of lineas) {
    const n = `Línea ${l.NumeroLinea ?? lineas.indexOf(l) + 1}`;
    const c = cabys.get(l.CodigoCABYS);
    if (c === null) {
      h.push({ nivel: "error", campo: `${n} › CodigoCABYS`, mensaje: `El código ${l.CodigoCABYS} no existe en el catálogo CABYS vigente.` });
      continue;
    }
    for (const i of l.Impuesto ?? []) {
      const tarifa = num(i.Tarifa);
      const exonerada = (i.Exoneracion ?? []).length > 0;
      if (c && i.Codigo === "01" && tarifa !== null && !exonerada && tarifa !== c.iva) {
        h.push({
          nivel: "advertencia",
          campo: `${n} › Impuesto › Tarifa`,
          mensaje: `Cobra IVA ${tarifa}%, pero el CABYS ${c.codigo} (${c.descripcion}) tiene ${c.iva}%. Si no hay una razón legal para otra tarifa, revísela.`,
        });
      }
      for (const e of i.Exoneracion ?? []) {
        const ex = exoneraciones.get(e.NumeroDocumento);
        if (ex === null) {
          h.push({ nivel: "error", campo: `${n} › Exoneracion`, mensaje: `Hacienda no tiene registrada la exoneración ${e.NumeroDocumento}.` });
        } else if (ex) {
          if (!ex.vigente) h.push({ nivel: "error", campo: `${n} › Exoneracion`, mensaje: `La exoneración ${ex.autorizacion} venció el ${ex.fechaVencimiento}, antes de la fecha de la factura.` });
          if (ex.cabys.length && !ex.cabys.includes(l.CodigoCABYS)) {
            h.push({ nivel: "error", campo: `${n} › Exoneracion`, mensaje: `La exoneración ${ex.autorizacion} no cubre el CABYS ${l.CodigoCABYS}.` });
          }
          const receptor = doc.Receptor?.Identificacion?.Numero;
          if (receptor && ex.identificacion && ex.identificacion !== receptor) {
            h.push({ nivel: "error", campo: `${n} › Exoneracion`, mensaje: `La exoneración ${ex.autorizacion} es de ${ex.identificacion}, no del receptor ${receptor}.` });
          }
        }
      }
    }
  }

  if (tc && moneda) {
    const usado = num(moneda.TipoCambio);
    if (fecha === tc.fecha && usado !== null && Math.abs(usado - tc.dolar.venta) / tc.dolar.venta > 0.01) {
      h.push({
        nivel: "advertencia",
        campo: "Resumen › TipoCambio",
        mensaje: `Usa ₡${fmt(usado)} por dólar; el tipo de cambio de referencia de venta de hoy es ₡${fmt(tc.dolar.venta)}.`,
      });
    }
  }
  return h;
}

/** Valida un comprobante completo. Con `client`, también cruza los datos con Hacienda. */
export async function validarComprobante(xml: string, client?: HaciendaClient): Promise<Resultado> {
  const { tipo, firmado, errores } = await validarEsquema(xml);
  const hallazgos = [...errores];
  if (tipo) {
    let doc: Nodo | undefined;
    try {
      doc = parser.parse(xml)[tipo];
    } catch {
      doc = undefined;
    }
    if (doc) {
      hallazgos.push(...revisarCoherencia(tipo, doc));
      if (client) hallazgos.push(...(await revisarConHacienda(tipo, doc, client)));
    }
    if (!firmado) {
      hallazgos.push({ nivel: "info", campo: "Signature", mensaje: "No viene firmado: se validó como borrador. Hacienda exige la firma XAdES-EPES al enviarlo." });
    }
  }
  const orden: Record<Nivel, number> = { error: 0, advertencia: 1, info: 2 };
  hallazgos.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return {
    tipo: tipo ? TIPOS[tipo].nombre : null,
    esquemaValido: tipo !== null && errores.length === 0,
    firmado,
    valido: !hallazgos.some((x) => x.nivel === "error"),
    hallazgos,
  };
}
