# mcp-hacienda-cr

[![ci](https://github.com/jmnzcn/mcp-hacienda-cr/actions/workflows/ci.yml/badge.svg)](https://github.com/jmnzcn/mcp-hacienda-cr/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-hacienda-cr?color=CB3837&logo=npm)](https://www.npmjs.com/package/mcp-hacienda-cr)
[![descargas](https://img.shields.io/npm/dm/mcp-hacienda-cr?label=descargas%2Fmes)](https://www.npmjs.com/package/mcp-hacienda-cr)
![License](https://img.shields.io/badge/licencia-PolyForm%20Noncommercial-orange)

Un servidor MCP que le da a Claude, Cursor y otros asistentes de IA acceso a los datos públicos del
Ministerio de Hacienda de Costa Rica: el tipo de cambio, la situación tributaria de un contribuyente,
los códigos CABYS con su tarifa de IVA y las exoneraciones. Lo hice pensando en la facturación
electrónica, donde cada línea de una factura necesita su código CABYS y el IVA correcto.

Está publicado en npm y en el [registro oficial de MCP](https://registry.modelcontextprotocol.io/v0/servers?search=hacienda)
como `io.github.jmnzcn/mcp-hacienda-cr`.

[English summary](#english-summary)

![Demo: MCP Inspector llamando a tipo_de_cambio, buscar_cabys y consultar_contribuyente](docs/demo.gif)

<sub>Grabado con [MCP Inspector](https://github.com/modelcontextprotocol/inspector) contra la API real de Hacienda: el tipo de cambio del día, los códigos CABYS de "café tostado" con su IVA y la situación tributaria de la CNFL.</sub>

## Qué le podés preguntar a tu asistente

> "¿Qué código CABYS uso para vender café tostado y cuánto IVA lleva?"
>
> Hay 71 códigos para café tostado. Por ejemplo, `2391102010100` (café tostado sin descafeinar, en
> grano) paga IVA del 1 %, pero `2391102020000` (café tostado descafeinado) paga 13 %.

> "Antes de facturarle, ¿la empresa 3-101-000046 está al día con Hacienda?"
>
> COMPAÑIA NACIONAL DE FUERZA Y LUZ S.A. · Cédula jurídica · Régimen general · Al día (no morosa ni
> omisa) · Actividad principal: 3510.0, generación, transmisión y distribución de energía eléctrica.

También: "¿A cuánto está el dólar hoy?" o "¿La exoneración AL-00020402-24 sigue vigente?". Son
respuestas reales del servidor contra la API de Hacienda.

## Herramientas

- `tipo_de_cambio`: el tipo de cambio de referencia del día, dólar (compra y venta) y euro.
- `consultar_contribuyente`: nombre, tipo de identificación, régimen, estado, si está moroso u omiso
  y sus actividades económicas. Ejemplo: `3-101-000046`.
- `buscar_cabys`: busca códigos CABYS por descripción, con su tarifa de IVA. Ejemplo: `café tostado`.
- `obtener_cabys`: el detalle de un código CABYS, con su IVA y su categoría. Ejemplo: `0161001010000`.
- `consultar_exoneracion`: beneficiario, porcentaje, vigencia y códigos CABYS que cubre una
  exoneración. Ejemplo: `AL-00020402-24`.

Todas son de solo lectura y usan las APIs públicas de Hacienda, así que no hace falta registrarse ni
tener una API key.

## Instalación

Requiere Node.js 18 o superior.

En Claude Desktop, agregalo a `claude_desktop_config.json` (Configuración → Desarrollador → Editar
configuración):

```json
{
  "mcpServers": {
    "hacienda-cr": {
      "command": "npx",
      "args": ["-y", "mcp-hacienda-cr"]
    }
  }
}
```

En Claude Code:

```bash
claude mcp add hacienda-cr -- npx -y mcp-hacienda-cr
```

En Cursor, VS Code y otros clientes MCP, usá el comando `npx -y mcp-hacienda-cr` con transporte stdio.

## Cómo funciona

```mermaid
flowchart LR
    U["Usuario"] --> A["Asistente de IA<br/>(Claude, Cursor…)"]
    A -- "MCP (stdio)" --> S["mcp-hacienda-cr"]
    S -- "HTTPS" --> H["api.hacienda.go.cr"]
```

Está escrito en TypeScript con el [SDK oficial de MCP](https://github.com/modelcontextprotocol/typescript-sdk),
y cada herramienta valida su entrada con Zod antes de llamar a Hacienda: una cédula física tiene 9
dígitos, una jurídica o NITE 10, un DIMEX 11 o 12, y un código CABYS 13. Cada respuesta trae un texto
legible para la conversación y los datos exactos en `structuredContent` para que el modelo trabaje
con ellos. Si la cédula no es válida, el código no existe o la API de Hacienda está caída, el usuario
recibe un mensaje claro en vez de un error. Las respuestas quedan en caché 10 minutos (tipo de cambio)
o una hora (lo demás) para no saturar la API.

## Pruebas

Hay 25 pruebas unitarias del cliente y del servidor completo, con un cliente MCP real en memoria y
respuestas de Hacienda grabadas. Aparte, unas pruebas de contrato llaman a la API real para detectar
si Hacienda cambia el formato de sus respuestas, y una prueba de humo levanta el servidor compilado
por stdio, como lo haría Claude, y llama a las cinco herramientas. El CI corre en Node 18, 20 y 22 en
cada push, y las pruebas contra la API real también cada lunes, para enterarme antes que los usuarios
si algo cambia.

```bash
npm install
npm test            # unitarias, sin red
npm run test:live   # contrato con la API real de Hacienda
npm run smoke       # servidor compilado por stdio, de punta a punta
```

## Aviso

Los datos vienen de las APIs públicas del Ministerio de Hacienda y son de referencia. Este proyecto no
está afiliado al Ministerio de Hacienda. Las decisiones fiscales confirmalas con un contador o
directamente con Hacienda.

## Licencia

[PolyForm Noncommercial 1.0.0](LICENSE). Podés usarlo gratis para fines no comerciales: uso personal,
investigación, educación o para evaluarlo. Cualquier uso comercial necesita una licencia:
[neyfred@gmail.com](mailto:neyfred@gmail.com). Las versiones hasta el commit `438da02` (2026-10-26),
incluida la 0.1.1 publicada en npm, se publicaron con licencia MIT.

## English summary

mcp-hacienda-cr is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
assistants such as Claude and Cursor query the public APIs of Costa Rica's Ministry of Finance:
official exchange rates, taxpayer status (registered, delinquent or non-filer, economic activities),
CABYS product and service codes with their VAT rate, and tax exemptions. It is aimed at e-invoicing,
where every invoice line needs a CABYS code and the right VAT rate. No API key is needed. It is
listed in the official MCP registry and installs with one command:

```bash
claude mcp add hacienda-cr -- npx -y mcp-hacienda-cr
```

Ney Fred Jiménez Campos · [LinkedIn](https://www.linkedin.com/in/neyfred/) · [GitHub](https://github.com/jmnzcn)
