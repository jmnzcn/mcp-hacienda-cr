/** Comprobantes 4.4 de prueba, armados con cuentas correctas para poder romperlos de a una cosa. */

export interface Linea {
  cabys: string;
  detalle: string;
  cantidad: number;
  precio: number;
  descuento?: number;
  /** CodigoTarifaIVA y su tarifa. */
  codigoTarifa: string;
  tarifa: number;
  /** Exoneración del IVA de la línea: número de autorización y puntos de tarifa exonerados. */
  exoneracion?: { numero: string; tarifa: number };
  servicio?: boolean;
}

export interface Opciones {
  fecha?: string;
  emisor?: string;
  receptor?: string;
  consecutivo?: string;
  actividad?: string;
  moneda?: { codigo: string; tipoCambio: number };
  lineas?: Linea[];
}

const r5 = (n: number) => Math.round(n * 100_000) / 100_000;
const m = (n: number) => r5(n).toFixed(5);

export const CAFE: Linea = { cabys: "0161001010000", detalle: "Café cereza orgánico, quintal", cantidad: 2, precio: 1000, codigoTarifa: "02", tarifa: 1 };

/** Clave de 50 posiciones: país, fecha, emisor, consecutivo, situación y código de seguridad. */
export function clave(fecha: string, emisor: string, consecutivo: string): string {
  const [a, mes, d] = fecha.split("-");
  return `506${d}${mes}${a!.slice(2)}${emisor.padStart(12, "0")}${consecutivo}1${"12345678"}`;
}

export function factura(o: Opciones = {}): string {
  const fecha = o.fecha ?? "2026-10-23";
  const emisor = o.emisor ?? "3101000046";
  const receptor = o.receptor ?? "3004061893";
  const consecutivo = o.consecutivo ?? "00100001010000000001";
  const lineas = o.lineas ?? [CAFE];
  const moneda = o.moneda ?? { codigo: "CRC", tipoCambio: 1 };

  const t = { servGrav: 0, mercGrav: 0, servExon: 0, mercExon: 0, desc: 0, imp: 0 };
  const desglose = new Map<string, number>();
  const xmlLineas = lineas.map((l, i) => {
    const total = l.cantidad * l.precio;
    const desc = l.descuento ?? 0;
    const sub = total - desc;
    const monto = (sub * l.tarifa) / 100;
    const exon = l.exoneracion ? (sub * l.exoneracion.tarifa) / 100 : 0;
    const neto = monto - exon;
    const parteExon = l.tarifa ? total * (exon / monto) : 0;
    if (l.servicio) { t.servGrav += total - parteExon; t.servExon += parteExon; } else { t.mercGrav += total - parteExon; t.mercExon += parteExon; }
    t.desc += desc;
    t.imp += neto;
    desglose.set(l.codigoTarifa, (desglose.get(l.codigoTarifa) ?? 0) + monto);
    return `
    <LineaDetalle>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <CodigoCABYS>${l.cabys}</CodigoCABYS>
      <Cantidad>${l.cantidad}</Cantidad>
      <UnidadMedida>${l.servicio ? "Sp" : "Unid"}</UnidadMedida>
      <Detalle>${l.detalle}</Detalle>
      <PrecioUnitario>${m(l.precio)}</PrecioUnitario>
      <MontoTotal>${m(total)}</MontoTotal>${desc ? `
      <Descuento><MontoDescuento>${m(desc)}</MontoDescuento><CodigoDescuento>07</CodigoDescuento></Descuento>` : ""}
      <SubTotal>${m(sub)}</SubTotal>
      <BaseImponible>${m(sub)}</BaseImponible>
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifaIVA>${l.codigoTarifa}</CodigoTarifaIVA>
        <Tarifa>${l.tarifa}</Tarifa>
        <Monto>${m(monto)}</Monto>${l.exoneracion ? `
        <Exoneracion>
          <TipoDocumentoEX1>04</TipoDocumentoEX1>
          <NumeroDocumento>${l.exoneracion.numero}</NumeroDocumento>
          <NombreInstitucion>01</NombreInstitucion>
          <FechaEmisionEX>2024-06-10T00:00:00-06:00</FechaEmisionEX>
          <TarifaExonerada>${l.exoneracion.tarifa}</TarifaExonerada>
          <MontoExoneracion>${m(exon)}</MontoExoneracion>
        </Exoneracion>` : ""}
      </Impuesto>
      <ImpuestoAsumidoEmisorFabrica>0</ImpuestoAsumidoEmisorFabrica>
      <ImpuestoNeto>${m(neto)}</ImpuestoNeto>
      <MontoTotalLinea>${m(sub + neto)}</MontoTotalLinea>
    </LineaDetalle>`;
  });

  const gravado = t.servGrav + t.mercGrav;
  const exonerado = t.servExon + t.mercExon;
  const venta = gravado + exonerado;
  const neta = venta - t.desc;
  const opt = (tag: string, v: number) => (v ? `\n    <${tag}>${m(v)}</${tag}>` : "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica">
  <Clave>${clave(fecha, emisor, consecutivo)}</Clave>
  <ProveedorSistemas>${emisor}</ProveedorSistemas>
  <CodigoActividadEmisor>${o.actividad ?? "351000"}</CodigoActividadEmisor>
  <NumeroConsecutivo>${consecutivo}</NumeroConsecutivo>
  <FechaEmision>${fecha}T10:00:00-06:00</FechaEmision>
  <Emisor>
    <Nombre>COMPAÑIA NACIONAL DE FUERZA Y LUZ SOCIEDAD ANONIMA</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${emisor}</Numero></Identificacion>
    <Ubicacion><Provincia>1</Provincia><Canton>01</Canton><Distrito>01</Distrito><OtrasSenas>San José centro</OtrasSenas></Ubicacion>
    <CorreoElectronico>facturas@example.com</CorreoElectronico>
  </Emisor>
  <Receptor>
    <Nombre>EMPRESA RECEPTORA</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${receptor}</Numero></Identificacion>
    <CorreoElectronico>compras@example.com</CorreoElectronico>
  </Receptor>
  <CondicionVenta>01</CondicionVenta>
  <DetalleServicio>${xmlLineas.join("")}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda><CodigoMoneda>${moneda.codigo}</CodigoMoneda><TipoCambio>${moneda.tipoCambio}</TipoCambio></CodigoTipoMoneda>${opt("TotalServGravados", t.servGrav)}${opt("TotalServExonerado", t.servExon)}${opt("TotalMercanciasGravadas", t.mercGrav)}${opt("TotalMercExonerada", t.mercExon)}${opt("TotalGravado", gravado)}${opt("TotalExonerado", exonerado)}
    <TotalVenta>${m(venta)}</TotalVenta>${opt("TotalDescuentos", t.desc)}
    <TotalVentaNeta>${m(neta)}</TotalVentaNeta>${[...desglose].map(([codigo, monto]) => `
    <TotalDesgloseImpuesto><Codigo>01</Codigo><CodigoTarifaIVA>${codigo}</CodigoTarifaIVA><TotalMontoImpuesto>${m(monto)}</TotalMontoImpuesto></TotalDesgloseImpuesto>`).join("")}
    <TotalImpuesto>${m(t.imp)}</TotalImpuesto>
    <MedioPago><TipoMedioPago>01</TipoMedioPago></MedioPago>
    <TotalComprobante>${m(neta + t.imp)}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronica>
`;
}
