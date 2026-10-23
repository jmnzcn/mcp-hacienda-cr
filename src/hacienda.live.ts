import { describe, expect, it } from "vitest";
import { HaciendaClient } from "./hacienda.js";

// Contrato con la API real: si Hacienda cambia el formato de sus respuestas, esto falla.
const client = new HaciendaClient();

describe("api.hacienda.go.cr (en vivo)", () => {
  it("tipo de cambio: dólar y euro con valores razonables", async () => {
    const tc = await client.tipoDeCambio();
    expect(tc.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tc.dolar.venta).toBeGreaterThan(tc.dolar.compra);
    expect(tc.dolar.compra).toBeGreaterThan(100);
    expect(tc.euro.colones).toBeGreaterThan(100);
  });

  it("contribuyente: la CNFL es una cédula jurídica inscrita", async () => {
    const c = await client.contribuyente("3-101-000046");
    expect(c).toMatchObject({ tipoIdentificacion: "Cédula jurídica", estado: "Inscrito" });
    expect(c?.actividades.length).toBeGreaterThan(0);
  });

  it("contribuyente inexistente devuelve null", async () => {
    await expect(client.contribuyente("3101999999")).resolves.toBeNull();
  });

  it("CABYS: buscar y obtener por código", async () => {
    const { total, resultados } = await client.buscarCabys("café", 3);
    expect(total).toBeGreaterThan(0);
    const detalle = await client.obtenerCabys(resultados[0]!.codigo);
    expect(detalle?.codigo).toBe(resultados[0]!.codigo);
    expect(typeof detalle?.iva).toBe("number");
  });

  it("exoneración conocida", async () => {
    const e = await client.exoneracion("AL-00020402-24");
    expect(e).toMatchObject({ autorizacion: "AL-00020402-24", porcentaje: 12 });
  });
});
