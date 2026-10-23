import { describe, expect, it } from "vitest";
import { HaciendaClient, HaciendaError, normalizarIdentificacion, validarIdentificacion } from "./hacienda.js";
import { CABYS_CAFE, CONTRIBUYENTE, EXONERACION, NOT_FOUND, TIPO_CAMBIO, fakeFetch } from "./testing/fixtures.js";

describe("validarIdentificacion", () => {
  it("acepta guiones y espacios", () => {
    expect(normalizarIdentificacion("3-101-000046")).toBe("3101000046");
    expect(validarIdentificacion(" 1 1234 0567 ")).toBe("112340567");
  });

  it.each(["123", "abc", "1234567890123", "3-101-00004X"])("rechaza %s sin llamar a la API", (id) => {
    expect(() => validarIdentificacion(id)).toThrow(HaciendaError);
  });
});

describe("HaciendaClient", () => {
  it("normaliza el tipo de cambio y lo guarda en caché", async () => {
    const fetchMock = fakeFetch({ "/indicadores/tc": { body: TIPO_CAMBIO } });
    const client = new HaciendaClient(fetchMock);

    const tc = await client.tipoDeCambio();
    await client.tipoDeCambio();

    expect(tc).toEqual({
      fecha: "2026-10-23",
      dolar: { compra: 452.44, venta: 456.32 },
      euro: { colones: 510.94, dolares: 1.1197 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("traduce la situación del contribuyente", async () => {
    const fetchMock = fakeFetch({ "/fe/ae?identificacion=3101000046": { body: CONTRIBUYENTE } });
    const c = await new HaciendaClient(fetchMock).contribuyente("3-101-000046");

    expect(c).toMatchObject({
      identificacion: "3101000046",
      tipoIdentificacion: "Cédula jurídica",
      regimen: "Régimen general",
      estado: "Inscrito",
      moroso: false,
      omiso: false,
    });
    expect(c?.actividades).toEqual([
      {
        codigo: "3510.0",
        descripcion: "Generación , transmisión y distribución de energía eléctrica",
        activa: true,
        principal: true,
      },
    ]);
  });

  it("marca a un contribuyente moroso u omiso", async () => {
    const moroso = { ...CONTRIBUYENTE, situacion: { ...CONTRIBUYENTE.situacion, moroso: "SI", omiso: "SI" } };
    const c = await new HaciendaClient(fakeFetch({ "/fe/ae": { body: moroso } })).contribuyente("3101000046");
    expect(c).toMatchObject({ moroso: true, omiso: true });
  });

  it("devuelve null si Hacienda no conoce la identificación (404)", async () => {
    const client = new HaciendaClient(fakeFetch({ "/fe/ae": { status: 404, body: NOT_FOUND } }));
    await expect(client.contribuyente("3101999999")).resolves.toBeNull();
  });

  it("busca CABYS y quita categorías repetidas", async () => {
    const fetchMock = fakeFetch({ "/fe/cabys?q=": { body: { total: 45, cantidad: 1, cabys: [CABYS_CAFE] } } });
    const res = await new HaciendaClient(fetchMock).buscarCabys("café", 5);

    expect(res.total).toBe(45);
    expect(res.resultados[0]).toMatchObject({ codigo: "0161001010000", iva: 1 });
    expect(res.resultados[0]!.categorias).toHaveLength(6);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("q=caf%C3%A9&top=5");
  });

  it("valida el código CABYS antes de consultarlo", async () => {
    const client = new HaciendaClient(fakeFetch({}));
    await expect(client.obtenerCabys("123")).rejects.toThrow("13 dígitos");
  });

  it("devuelve null si el código CABYS no existe (lista vacía)", async () => {
    const client = new HaciendaClient(fakeFetch({ "/fe/cabys?codigo=": { body: [] } }));
    await expect(client.obtenerCabys("9999999999999")).resolves.toBeNull();
  });

  it("calcula si una exoneración está vigente", async () => {
    const client = new HaciendaClient(fakeFetch({ "/fe/ex": { body: EXONERACION } }));

    const vigente = await client.exoneracion("al-00020402-24", new Date("2026-10-23"));
    expect(vigente).toMatchObject({ porcentaje: 12, vigente: true, fechaVencimiento: "2030-06-10" });

    const vencida = await client.exoneracion("AL-00020402-24", new Date("2031-01-01"));
    expect(vencida?.vigente).toBe(false);
  });

  it("convierte errores del servidor en un mensaje claro", async () => {
    const client = new HaciendaClient(fakeFetch({ "/indicadores/tc": { status: 503, body: { code: 503 } } }));
    await expect(client.tipoDeCambio()).rejects.toThrow("respondió con error 503");
  });

  it("convierte una respuesta que no es JSON en un mensaje claro", async () => {
    const client = new HaciendaClient(fakeFetch({ "/indicadores/tc": { body: "<html>mantenimiento</html>" } }));
    await expect(client.tipoDeCambio()).rejects.toThrow("no es JSON");
  });

  it("informa cuando la API no está disponible", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new HaciendaClient(failing).tipoDeCambio()).rejects.toThrow("no está disponible");
  });
});
