import { describe, expect, it } from "vitest";
import { revisarCoherencia, validarComprobante } from "./factura.js";
import { HaciendaClient } from "./hacienda.js";
import { CAFE, factura } from "./testing/comprobantes.js";
import { CABYS_CAFE, CONTRIBUYENTE, EXONERACION, NOT_FOUND, TIPO_CAMBIO, fakeFetch } from "./testing/fixtures.js";

const CABYS_CONSULTORIA = { codigo: "8311100000100", descripcion: "Servicios de consultoría en gestión", impuesto: 13, categorias: [] };
const CABYS_INSUMO = { codigo: "0113200000000", descripcion: "Insumo agrícola", impuesto: 13, categorias: [] };

/** Hacienda simulada: los contribuyentes, CABYS y exoneraciones de los fixtures. `extra` tiene prioridad. */
function hacienda(extra: Parameters<typeof fakeFetch>[0] = {}) {
  const base: Parameters<typeof fakeFetch>[0] = {
    "/fe/ae": { body: CONTRIBUYENTE },
    "/fe/cabys?codigo=0161001010000": { body: [CABYS_CAFE] },
    "/fe/cabys?codigo=8311100000100": { body: [CABYS_CONSULTORIA] },
    "/fe/cabys?codigo=0113200000000": { body: [CABYS_INSUMO] },
    "/fe/cabys?codigo=": { body: [] },
    "/fe/ex": { body: EXONERACION },
    "/indicadores/tc": { body: TIPO_CAMBIO },
  };
  // fakeFetch usa la primera ruta que coincide, así que las de `extra` van primero
  return new HaciendaClient(fakeFetch({ ...extra, ...Object.fromEntries(Object.entries(base).filter(([k]) => !(k in extra))) }));
}

const de = (r: Awaited<ReturnType<typeof validarComprobante>>, nivel: string) =>
  r.hallazgos.filter((h) => h.nivel === nivel).map((h) => `${h.campo}: ${h.mensaje}`.replace(/[  ]/g, " "));

describe("validarComprobante — esquema oficial 4.4", () => {
  it("acepta una factura correcta sin firmar y avisa que es un borrador", async () => {
    const r = await validarComprobante(factura());
    expect(de(r, "error")).toEqual([]);
    expect(r).toMatchObject({ tipo: "Factura electrónica", esquemaValido: true, firmado: false, valido: true });
    expect(de(r, "info").join()).toContain("No viene firmado");
  });

  it("explica en qué línea del XML falta un elemento obligatorio", async () => {
    const xml = factura().replace(/<Receptor>[\s\S]*?<\/Receptor>/, "");
    const r = await validarComprobante(xml);
    expect(r.esquemaValido).toBe(false);
    expect(de(r, "error").join()).toMatch(/Línea \d+ del XML: Element 'CondicionVenta': This element is not expected\. Expected is \( Receptor \)/);
  });

  it("lee el espacio de nombres de la raíz aunque haya otros xmlns o un prefijo", async () => {
    const conXsi = factura().replace("<FacturaElectronica xmlns=", '<FacturaElectronica xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns=');
    expect(de(await validarComprobante(conXsi), "error")).toEqual([]);
    const conPrefijo = factura()
      .replace(/<(\/?)([A-Z][A-Za-z]*)/g, "<$1fe:$2")
      .replace('<fe:FacturaElectronica xmlns=', "<fe:FacturaElectronica xmlns:fe=");
    expect(de(await validarComprobante(conPrefijo), "error")).toEqual([]);
  });

  it("calcula el total de la línea aunque no traiga ImpuestoNeto (la factura de exportación no lo exige)", () => {
    const linea = { NumeroLinea: "1", Cantidad: "1", PrecioUnitario: "100000", MontoTotal: "100000", SubTotal: "100000",
      Impuesto: [{ Codigo: "01", CodigoTarifaIVA: "08", Tarifa: "13", Monto: "13000" }], MontoTotalLinea: "113000" };
    expect(revisarCoherencia("FacturaElectronicaExportacion", { DetalleServicio: { LineaDetalle: [linea] } })).toEqual([]);
  });

  it("reconoce un comprobante de la versión 4.3", async () => {
    const xml = factura().replace("/v4.4/facturaElectronica", "/v4.3/facturaElectronica");
    const r = await validarComprobante(xml);
    expect(de(r, "error")).toEqual([expect.stringContaining("usa la versión 4.3")]);
  });

  it("rechaza algo que no es un comprobante", async () => {
    expect(de(await validarComprobante("<Pedido><Numero>1</Numero></Pedido>"), "error")).toEqual([
      expect.stringContaining('"Pedido" no es un comprobante electrónico'),
    ]);
    expect((await validarComprobante("hola, esto no es XML")).valido).toBe(false);
  });
});

describe("validarComprobante — cuentas, clave y consecutivo", () => {
  it("una factura con descuentos, dos tarifas y una línea exonerada cuadra", async () => {
    const xml = factura({
      lineas: [
        { ...CAFE, descuento: 150 },
        { cabys: "8311100000100", detalle: "Consultoría", cantidad: 3, precio: 25_000.5, codigoTarifa: "08", tarifa: 13, servicio: true },
        { cabys: "0113200000000", detalle: "Insumo exonerado", cantidad: 1, precio: 10_000, codigoTarifa: "08", tarifa: 13, exoneracion: { numero: EXONERACION.numeroDocumento, tarifa: 12 } },
      ],
    });
    const r = await validarComprobante(xml);
    expect(de(r, "error")).toEqual([]);
  });

  it("detecta una línea que no suma", async () => {
    const xml = factura().replace("<MontoTotalLinea>2020.00000</MontoTotalLinea>", "<MontoTotalLinea>2030.00000</MontoTotalLinea>");
    expect(de(await validarComprobante(xml), "error")).toEqual([
      "Línea 1 › MontoTotalLinea: Dice 2 030,00 pero subtotal + impuesto neto da 2 020,00 (diferencia 10,00).",
    ]);
  });

  it("detecta un IVA mal calculado y una tarifa que no corresponde a su código", async () => {
    const xml = factura()
      .replace("<Monto>20.00000</Monto>", "<Monto>26.00000</Monto>")
      .replace("<Tarifa>1</Tarifa>", "<Tarifa>13</Tarifa>");
    const errores = de(await validarComprobante(xml), "error").join("\n");
    expect(errores).toContain("Línea 1 › Impuesto › Tarifa: El código de tarifa 02 corresponde a 1%, pero la tarifa dice 13%.");
    expect(errores).toContain("Línea 1 › Impuesto › Monto: Dice 26,00 pero base imponible × 13% da 260,00");
  });

  it("detecta un total del comprobante que no cuadra con el resumen", async () => {
    const xml = factura().replace("<TotalComprobante>2020.00000</TotalComprobante>", "<TotalComprobante>2200.00000</TotalComprobante>");
    expect(de(await validarComprobante(xml), "error")).toEqual([
      expect.stringContaining("Resumen › TotalComprobante: Dice 2 200,00 pero venta neta + impuesto + otros cargos − IVA devuelto da 2 020,00"),
    ]);
  });

  it("detecta una clave que no coincide con la fecha, el emisor o el consecutivo", async () => {
    const xml = factura().replace("<FechaEmision>2026-10-23", "<FechaEmision>2026-10-24");
    expect(de(await validarComprobante(xml), "error")).toEqual([
      "Clave: Las posiciones 4–9 deben ser la fecha de emisión (241026); dicen 231026.",
    ]);
    const otroEmisor = factura().replace(/<Numero>3101000046<\/Numero>/, "<Numero>3101999999</Numero>");
    expect(de(await validarComprobante(otroEmisor), "error").join()).toContain("deben ser la identificación del emisor (003101999999)");
  });

  it("detecta un consecutivo de otro tipo de comprobante", async () => {
    const xml = factura({ consecutivo: "00100001040000000001" });
    expect(de(await validarComprobante(xml), "error")).toEqual([
      "NumeroConsecutivo: Las posiciones 9–10 son el tipo de comprobante: para factura electrónica van 01; dicen 04.",
    ]);
  });
});

describe("validarComprobante — datos de Hacienda", () => {
  it("una factura correcta pasa también contra Hacienda, sin advertencias", async () => {
    const r = await validarComprobante(factura(), hacienda());
    expect(de(r, "error")).toEqual([]);
    expect(de(r, "advertencia")).toEqual([]);
  });

  it("avisa cuando el IVA cobrado no es el del CABYS", async () => {
    const xml = factura({ lineas: [{ ...CAFE, codigoTarifa: "08", tarifa: 13 }] });
    const r = await validarComprobante(xml, hacienda());
    expect(de(r, "error")).toEqual([]);
    expect(de(r, "advertencia")).toEqual([
      expect.stringContaining("Línea 1 › Impuesto › Tarifa: Cobra IVA 13%, pero el CABYS 0161001010000 (Café cereza, orgánico) tiene 1%."),
    ]);
  });

  it("marca un CABYS que no existe", async () => {
    const xml = factura({ lineas: [{ ...CAFE, cabys: "9999999999999" }] });
    expect(de(await validarComprobante(xml, hacienda()), "error")).toEqual([
      "Línea 1 › CodigoCABYS: El código 9999999999999 no existe en el catálogo CABYS vigente.",
    ]);
  });

  it("marca un emisor que Hacienda no tiene registrado y una actividad que no es suya", async () => {
    const r = await validarComprobante(factura({ actividad: "620100" }), hacienda({ "/fe/ae?identificacion=3101000046": { status: 404, body: NOT_FOUND } }));
    expect(de(r, "error")).toEqual(["Emisor › Identificacion: Hacienda no tiene registrado al contribuyente 3101000046."]);
    const r2 = await validarComprobante(factura({ actividad: "620100" }), hacienda());
    expect(de(r2, "advertencia").join()).toContain("La actividad 620100 no aparece entre las actividades activas");
  });

  it("revisa que la exoneración esté vigente, sea del receptor y cubra el CABYS", async () => {
    const linea = { ...CAFE, codigoTarifa: "08", tarifa: 13, exoneracion: { numero: EXONERACION.numeroDocumento, tarifa: 13 } };
    const r = await validarComprobante(factura({ receptor: "3101123456", lineas: [linea] }), hacienda());
    expect(de(r, "error")).toEqual([
      "Línea 1 › Exoneracion: La exoneración AL-00020402-24 no cubre el CABYS 0161001010000.",
      "Línea 1 › Exoneracion: La exoneración AL-00020402-24 es de 3004061893, no del receptor 3101123456.",
    ]);
    const vencida = hacienda({ "/fe/ex": { body: { ...EXONERACION, fechaVencimiento: "2025-01-01T00:00:00" } } });
    const r2 = await validarComprobante(factura({ lineas: [{ ...linea, cabys: "0113200000000" }] }), vencida);
    expect(de(r2, "error")).toEqual(["Línea 1 › Exoneracion: La exoneración AL-00020402-24 venció el 2025-01-01, antes de la fecha de la factura."]);
  });

  it("compara el tipo de cambio en dólares con el de referencia del día", async () => {
    const xml = factura({ moneda: { codigo: "USD", tipoCambio: 500 } });
    expect(de(await validarComprobante(xml, hacienda()), "advertencia")).toEqual([
      "Resumen › TipoCambio: Usa ₡500,00 por dólar; el tipo de cambio de referencia de venta de hoy es ₡456,32.",
    ]);
  });

  it("si Hacienda no responde, lo dice sin invalidar el comprobante", async () => {
    const caida = new HaciendaClient(fakeFetch({ "/": { status: 503, body: "caída" } }));
    const r = await validarComprobante(factura(), caida);
    expect(r.valido).toBe(true);
    expect(de(r, "advertencia").every((a) => a.includes("No se pudo verificar con Hacienda"))).toBe(true);
  });
});
