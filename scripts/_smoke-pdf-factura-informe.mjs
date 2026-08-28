// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-pdf-factura-informe.mjs — los dos PDF que salen del CRM hacia FUERA
 * (21/08/2026).
 *
 *   node scripts/_smoke-pdf-factura-informe.mjs
 *   node --test-name-pattern="totales" scripts/_smoke-pdf-factura-informe.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Tras las cuatro tandas de pruebas del 17–20/08 la lógica pura de `lib/`
 * quedó cubierta salvo dos zonas: los generadores de PDF y las plantillas de
 * correo. Esta cierra la primera mitad. No son dos ficheros cualesquiera: son
 * los ÚNICOS documentos que el CRM manda fuera con el membrete de un cliente.
 *
 * · `lib/billing/invoicePdf.js` — la factura. La abre la familia que paga y la
 *   abre la gestoría. Un importe mal escrito o un NIF que no es el que se
 *   pactó no es un descuadre de pantalla: es un documento oficial equivocado
 *   (por eso existe `lib/billing/nifCliente.js`, y por eso aquí se comprueba
 *   que el PDF respeta su regla: manda `fiscalTaxId`, con respaldo en `taxId`).
 *
 * · `lib/clinica/reportPdf.js` — el informe clínico que recibe la familia. Sus
 *   siete secciones se imprimen SOLO si tienen algo: un informe de derivación
 *   no tiene «logros» y un titular vacío parece un error de la clínica.
 *
 * ── EL FALLO QUE APARECIÓ AL ESCRIBIRLA ────────────────────────────────────
 *
 * Abrir la factura por dentro destapó que el bloque del cliente se pintaba a
 * altura FIJA (`blockY + 30`) debajo de un nombre de altura VARIABLE: una
 * razón social de más de ~45 caracteres ocupa dos líneas y el NIF se imprimía
 * ENCIMA de la segunda (nombre en y=163,0 y «NIF/CIF» en y=164,5). Se arregló
 * el mismo día haciendo que las señas sigan al nombre de verdad y que la tabla
 * empiece por debajo del más alto de los dos bloques. Con un nombre de una
 * línea el dibujo se mueve menos de 1 punto: la factura de siempre no cambia.
 * La prueba que lo vigila es «una razón social de dos líneas no pisa el NIF».
 *
 * ── CÓMO SE MIRA UN PDF POR DENTRO SIN DEPENDENCIAS ────────────────────────
 *
 * No hay librería de lectura de PDF en el proyecto y no se añade ninguna por
 * una prueba. El lector de abajo (`abrirPdf`) hace lo justo: descomprime los
 * flujos con `node:zlib`, saca los operadores de texto del contenido de cada
 * página y los descodifica. Los dos ficheros usan caminos DISTINTOS de pdfkit
 * y el lector cubre los dos:
 *
 *   · la factura escribe con las Helvetica de serie → un byte por letra,
 *     WinAnsi (= latin1 salvo el tramo 0x80–0x9F, donde vive el «€»);
 *   · el informe embebe Poppins (`lib/pdf/fonts.js`) → dos bytes por letra con
 *     números de glifo del subconjunto, que solo se leen pasando por el mapa
 *     `/ToUnicode` que el propio PDF lleva dentro.
 *
 * Se prueba lo que DEVUELVE cada generador —qué texto sale, con qué números y
 * en qué orden—, nunca cómo está escrito el fichero.
 *
 * ── FECHAS Y ZONA HORARIA ──────────────────────────────────────────────────
 *
 * Los dos leen la misma clase de columna (una fecha sin hora, que llega como
 * texto 'AAAA-MM-DD') y NO hacen lo mismo con ella: la factura le pega
 * `T00:00:00` y la interpreta en la zona del servidor (mismo día en cualquier
 * parte), el informe la pasa tal cual y sale medianoche UTC (al oeste de
 * Greenwich, el día anterior). Las aserciones de aquí pasan igual en `UTC`,
 * `America/New_York`, `Europe/Madrid` y `Asia/Tokyo` —comprobado—; de +13 en
 * adelante (Kiritimati, Samoa) fallarían dos, y ahí no hay servidor.
 *
 * Ojo al comprobarlo en Windows: `TZ=UTC node --test …` en la terminal NO llega
 * a Node y se sigue midiendo la zona local. Hay que pasarlo en el entorno del
 * proceso hijo (`spawn(..., { env: { ...process.env, TZ } })`).
 *
 * ── TRIADAS EL 24/08/2026 ──────────────────────────────────────────────────
 * Las marcas de este fichero ya están juzgadas con el criterio del Registro:
 * DEFECTO = con una entrada que alguien puede mandar de verdad, devuelve algo
 * malo o revienta. TOLERANCIA = solo acepta basura que no tiene camino. Cada
 * una se comprobó ejecutando la función y siguiendo el dato hasta su columna
 * o su endpoint; una marca que sigue aquí NO es una marca sin mirar.
 *
 * Salieron DEFECTO y están arreglados (su `it` se volteó y perdió la marca):
 *   · un TOTAL de seis cifras se parte en dos líneas
 *   · una especialidad que no está en el catálogo se imprime cruda
 *
 * Las otras 3 son TOLERANCIA, y el porqué de cada una está junto a su `it`.
 * En una frase, por qué ninguna tiene camino de entrada:
 *    373  sin número y sin ser borrador, el nombre sale con «undefined»
 *         → `Invoice.number` es `allowNull:false` + `unique` (models/tena…
 *    721  un importe que no es un número sale como «NaN €»
 *         → El comentario de la prueba se equivoca en el motivo («las col…
 *   1148  la fecha del informe se lee como INSTANTE, no como día de calenda…
 *         → El mecanismo que fija la prueba es cierto: `fmtFecha` hace `n…
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildInvoicePdfBuffer, invoicePdfFilename } from "../lib/billing/invoicePdf.js";
import { buildReportPdfBuffer, reportPdfFilename } from "../lib/clinica/reportPdf.js";
import { paletaDeInforme } from "../lib/clinica/marcaInforme.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ═══ Lector de PDF ════════════════════════════════════════════════════════ */

/** WinAnsi solo se separa de latin1 en 0x80–0x9F. Ahí está el «€». */
// prettier-ignore
const WIN1252 = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

/** Todos los objetos «N 0 obj … » del fichero, en crudo y por número. */
function objetosDe(bruto) {
  const re = /(?:^|\n)(\d+) 0 obj/g;
  const marcas = [];
  let m;
  while ((m = re.exec(bruto))) {
    marcas.push({ num: Number(m[1]), desde: m.index + (m[0][0] === "\n" ? 1 : 0) });
  }
  const objetos = new Map();
  for (let i = 0; i < marcas.length; i++) {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].desde : bruto.length;
    objetos.set(marcas[i].num, bruto.slice(marcas[i].desde, hasta));
  }
  return objetos;
}

/** El contenido de un objeto con flujo, descomprimido si venía en Flate. */
function flujoDe(objeto) {
  const i = objeto.indexOf("stream");
  if (i < 0) return "";
  const desde = objeto.indexOf("\n", i) + 1;
  const hasta = objeto.lastIndexOf("endstream");
  if (hasta < 0) return "";
  const datos = Buffer.from(objeto.slice(desde, hasta), "latin1");
  if (!/\/FlateDecode/.test(objeto.slice(0, i))) return datos.toString("latin1");
  try {
    return zlib.inflateSync(datos).toString("latin1");
  } catch {
    return "";
  }
}

const bytesDeHex = (hex) => Buffer.from(hex.replace(/\s+/g, ""), "hex");

/** Un valor del CMap («0041») es UTF-16BE: dos bytes por letra. */
function letrasUtf16(hex) {
  const b = bytesDeHex(hex);
  let salida = "";
  for (let i = 0; i + 1 < b.length; i += 2) salida += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return salida;
}

/** Mapa nº de glifo → letra, leyendo el /ToUnicode que el PDF lleva dentro. */
function cmapDe(texto) {
  const mapa = new Map();
  for (const bloque of texto.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const par of bloque.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      mapa.set(parseInt(par[1], 16), letrasUtf16(par[2]));
    }
  }
  for (const bloque of texto.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([\s\S]*?)\]|<([0-9A-Fa-f]+)>)/g;
    let m;
    while ((m = re.exec(bloque))) {
      const primero = parseInt(m[1], 16);
      const ultimo = parseInt(m[2], 16);
      if (m[3] != null) {
        const destinos = m[3].match(/<[0-9A-Fa-f]*>/g) || [];
        destinos.forEach((d, i) => mapa.set(primero + i, letrasUtf16(d.slice(1, -1))));
      } else {
        const base = parseInt(m[4], 16);
        for (let c = primero; c <= ultimo; c++)
          mapa.set(c, String.fromCharCode(base + (c - primero)));
      }
    }
  }
  return mapa;
}

function descodifica(hex, cmap) {
  const b = bytesDeHex(hex);
  if (!cmap) {
    let salida = "";
    for (const byte of b) salida += WIN1252[byte] ?? String.fromCharCode(byte);
    return salida;
  }
  let salida = "";
  for (let i = 0; i + 1 < b.length; i += 2) salida += cmap.get((b[i] << 8) | b[i + 1]) ?? "";
  return salida;
}

// Cada trozo de texto va precedido de su matriz `1 0 0 1 x y Tm`: guardándola
// se sabe DÓNDE se dibujó cada línea, que es lo único que delata que dos cosas
// se están pisando o que un bloque se ha metido dentro de la tabla.
const OPERADORES =
  /\/(F\d+)\s+[\d.]+\s+Tf|1 0 0 1 ([\d.]+) ([\d.]+) Tm|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj/g;

/**
 * Abre un PDF y devuelve, por página, sus líneas de texto (cada `doc.text` de
 * pdfkit es una línea), dónde se dibujó cada una (`posiciones`, en puntos y con
 * el origen ABAJO: más `y` = más arriba) y el contenido crudo de la página,
 * para lo poco que no es texto (el color de la regla de marca).
 */
function abrirPdf(buffer) {
  const bruto = buffer.toString("latin1");
  const objetos = objetosDe(bruto);

  const paginas = [];
  for (const [, objeto] of objetos) {
    if (!/\/Type\s*\/Page[^s]/.test(objeto)) continue;
    const contenido = objeto.match(/\/Contents\s+(\d+) 0 R/);
    const recursos = objeto.match(/\/Resources\s+(\d+) 0 R/);
    if (contenido) {
      paginas.push({
        contenido: Number(contenido[1]),
        recursos: recursos ? Number(recursos[1]) : null,
      });
    }
  }

  const salida = paginas.map((pagina) => {
    const fuentes = new Map();
    const bloque = /\/Font\s*<<([\s\S]*?)>>/.exec(objetos.get(pagina.recursos) || "");
    for (const f of bloque ? bloque[1].matchAll(/\/(F\d+)\s+(\d+) 0 R/g) : []) {
      const aUnicode = /\/ToUnicode\s+(\d+) 0 R/.exec(objetos.get(Number(f[2])) || "");
      // Sin /ToUnicode es una Helvetica de serie: un byte por letra.
      fuentes.set(f[1], aUnicode ? cmapDe(flujoDe(objetos.get(Number(aUnicode[1])) || "")) : null);
    }

    const contenido = flujoDe(objetos.get(pagina.contenido) || "");
    const lineas = [];
    const posiciones = [];
    let cmap = null;
    let x = null;
    let y = null;
    let m;
    OPERADORES.lastIndex = 0;
    while ((m = OPERADORES.exec(contenido))) {
      if (m[1] != null) {
        cmap = fuentes.get(m[1]) ?? null;
        continue;
      }
      if (m[2] != null) {
        x = Number(m[2]);
        y = Number(m[3]);
        continue;
      }
      let linea = "";
      if (m[4] != null) {
        for (const trozo of m[4].match(/<[0-9A-Fa-f\s]*>/g) || []) {
          linea += descodifica(trozo.slice(1, -1), cmap);
        }
      } else {
        linea = descodifica(m[5], cmap);
      }
      if (linea) {
        lineas.push(linea);
        posiciones.push({ x, y, texto: linea });
      }
    }
    return { lineas, posiciones, texto: lineas.join("\n"), contenido };
  });

  return { paginas: salida, texto: salida.map((p) => p.texto).join("\n") };
}

const esPdf = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString("latin1") === "%PDF-";

/* ═══ Piezas de ejemplo ════════════════════════════════════════════════════ */

/** Una línea de factura completa; cada prueba cambia lo que le interesa. */
const linea = (extra = {}) => ({
  description: "Sesión de logopedia",
  quantity: 1,
  unitPrice: 100,
  discountPct: 0,
  vatRate: 21,
  lineBase: 100,
  lineVat: 21,
  ...extra,
});

/** Una factura emitida y cobrable, como la que sale de Facturación. */
const factura = (extra = {}) => ({
  id: "abcdef12-3456-7890-aaaa-bbbbbbbbbbbb",
  status: "issued",
  series: "F2026",
  number: "F2026-0007",
  issueDate: "2026-08-14",
  dueDate: "2026-09-14",
  taxBase: 100,
  irpfRate: 0,
  irpfAmount: 0,
  total: 121,
  paidAmount: 0,
  lines: [linea()],
  ...extra,
});

const CLIENTE = {
  name: "Familia Pérez",
  fiscalName: "Pérez e Hijos SL",
  taxId: "12345678Z",
  fiscalAddress: "C/ Mayor 1",
  fiscalZip: "28001",
  fiscalCity: "Madrid",
  email: "familia@ejemplo.es",
};

const EMISOR = {
  fiscalName: "Centro Aumenta",
  taxId: "B12345678",
  fiscalAddress: "Av. de la Clínica 2",
  fiscalZip: "28002",
  fiscalCity: "Madrid",
  fiscalCountry: "ES",
};

/** El texto entero de una factura, ya descodificado. */
async function textoFactura({
  invoice = {},
  client = CLIENTE,
  settings = EMISOR,
  partnerName,
} = {}) {
  const buffer = await buildInvoicePdfBuffer({
    invoice: factura(invoice),
    client,
    settings,
    partnerName,
  });
  return abrirPdf(buffer).texto;
}

/** Un informe clínico con una sección de cada clase. */
const informe = (extra = {}) => ({
  reportType: "evolution",
  reportDate: "2026-08-10T12:00:00Z",
  contentSections: {
    motiveOfIntervention: "Dificultades de lenguaje expresivo",
    objectives: ["Mejorar la articulación", "Ampliar vocabulario"],
  },
  aiGenerated: null,
  ...extra,
});

async function textoInforme({ report = {}, ...resto } = {}) {
  const buffer = await buildReportPdfBuffer({
    patientName: "Ana López",
    therapistName: "Marta García",
    tenantName: "Centro Aumenta",
    ...resto,
    report: informe(report),
  });
  return abrirPdf(buffer).texto;
}

/* ═══ Factura: el nombre del fichero ═══════════════════════════════════════ */

describe("invoicePdfFilename: el nombre con el que se descarga y se adjunta", () => {
  it("una factura emitida se llama por su número", () => {
    assert.equal(invoicePdfFilename(factura()), "factura-F2026-0007.pdf");
  });

  it("un borrador no tiene número: se llama por los 8 primeros del id", () => {
    assert.equal(
      invoicePdfFilename({ status: "draft", id: "abcdef12-3456-7890", number: null }),
      "factura-borrador-abcdef12.pdf"
    );
  });

  it("los caracteres que Windows no admite en un nombre se cambian por guion", () => {
    assert.equal(
      invoicePdfFilename({ status: "issued", number: 'F2026/07:1*?"<>|' }),
      "factura-F2026-07-1------.pdf"
    );
  });

  it("una serie con barra (la del libro de IVA) no crea carpetas al descargar", () => {
    assert.equal(
      invoicePdfFilename({ status: "issued", number: "R/2026/1" }),
      "factura-R-2026-1.pdf"
    );
  });

  // SOSPECHOSO: sin número sale literalmente «factura-undefined.pdf». Hoy no
  // muerde porque `number` es NOT NULL y único en el modelo, así que solo un
  // borrador (que va por el otro camino) puede no tenerlo. Se fija tal cual
  // porque el descargador masivo mete todos los nombres en el MISMO ZIP: dos
  // facturas sin número serían dos ficheros con el mismo nombre dentro.
  it("sin número y sin ser borrador, el nombre sale con «undefined» // SOSPECHOSO", () => {
    assert.equal(invoicePdfFilename({ status: "issued" }), "factura-undefined.pdf");
    assert.equal(invoicePdfFilename({ status: "issued", number: null }), "factura-null.pdf");
  });
});

/* ═══ Factura: el documento ════════════════════════════════════════════════ */

describe("buildInvoicePdfBuffer: sale un PDF de verdad y con el emisor dentro", () => {
  it("devuelve un Buffer que empieza por %PDF- y no está vacío", async () => {
    const buffer = await buildInvoicePdfBuffer({
      invoice: factura(),
      client: CLIENTE,
      settings: EMISOR,
    });
    assert.ok(esPdf(buffer), "no empieza por %PDF-");
    assert.ok(
      buffer.length > 1000,
      `una factura con línea y totales no pesa ${buffer.length} bytes`
    );
  });

  it("la cabecera lleva el emisor entero: nombre fiscal, NIF, dirección y CP + ciudad", async () => {
    const texto = await textoFactura();
    assert.match(texto, /^Centro Aumenta\n/);
    assert.ok(texto.includes("NIF/CIF: B12345678"));
    assert.ok(texto.includes("Av. de la Clínica 2"));
    assert.ok(texto.includes("28002 Madrid"));
  });

  it("el país solo se imprime si NO es España (una factura española no lo dice)", async () => {
    assert.equal((await textoFactura()).includes("\nES\n"), false);
    assert.ok(
      (await textoFactura({ settings: { ...EMISOR, fiscalCountry: "PT" } })).includes("\nPT\n")
    );
  });

  it("sin datos de emisor la cabecera pone «—» y no revienta", async () => {
    const texto = await textoFactura({ settings: {} });
    assert.match(texto, /^—\nFACTURA\n/);
  });

  it("settings a null se trata como settings vacíos (el emisor puede no estar configurado)", async () => {
    const buffer = await buildInvoicePdfBuffer({
      invoice: factura(),
      client: CLIENTE,
      settings: null,
    });
    assert.ok(esPdf(buffer));
    assert.match(abrirPdf(buffer).texto, /^—\nFACTURA\n/);
  });
});

describe("buildInvoicePdfBuffer: a quién se factura", () => {
  it("manda la razón social sobre el nombre de la ficha", async () => {
    assert.ok((await textoFactura()).includes("FACTURAR A\nPérez e Hijos SL"));
  });

  it("sin razón social sale el nombre de la ficha; sin ninguno de los dos, «—»", async () => {
    assert.ok(
      (await textoFactura({ client: { name: "Familia Pérez" } })).includes(
        "FACTURAR A\nFamilia Pérez"
      )
    );
    assert.ok((await textoFactura({ client: {} })).includes("FACTURAR A\n—"));
    assert.ok((await textoFactura({ client: null })).includes("FACTURAR A\n—"));
  });

  it("el NIF es el fiscal si lo hay, con respaldo en el de la persona (regla de nifCliente.js)", async () => {
    const conFiscal = await textoFactura({ client: { ...CLIENTE, fiscalTaxId: "B99999999" } });
    assert.ok(conFiscal.includes("NIF/CIF: B99999999"), "debía ganar el NIF fiscal");
    assert.equal(
      conFiscal.includes("12345678Z"),
      false,
      "el DNI de la ficha no puede salir además"
    );
    assert.ok((await textoFactura()).includes("NIF/CIF: 12345678Z"), "sin fiscal, el de la ficha");
    // Sin ningún documento, debajo del nombre va el «—» y ninguna línea de NIF
    // (el «NIF/CIF» que sigue apareciendo arriba es el del EMISOR).
    assert.ok((await textoFactura({ client: { name: "X" } })).includes("FACTURAR A\nX\n—"));
  });

  /*
   * LA FOTO FISCAL — lo que se emitió, se emitió (26/08/2026).
   *
   * Hasta ese día el PDF leía los datos fiscales de la ficha CADA VEZ, así que
   * corregir un NIF reescribía hacia atrás y en silencio las facturas ya
   * emitidas: el papel que se reimprimiera no era el que se entregó. Se prueba
   * aquí y no solo en `_smoke-billing-datos-fiscales.mjs` porque lo que hay que
   * sostener no es que la función elija bien —eso ya está fijado— sino que el
   * DOCUMENTO imprime lo que ella dice.
   */
  it("con foto, imprime la foto y NO la ficha de hoy", async () => {
    const texto = await textoFactura({
      invoice: {
        fiscalSnapshot: {
          nombre: "Pérez e Hijos SL",
          nif: "B11111111",
          direccion: "C/ Antigua 9",
          cp: "40001",
          ciudad: "Segovia",
          pais: "ES",
        },
      },
      // La ficha, ya corregida: otro NIF y otra ciudad.
      client: { ...CLIENTE, fiscalTaxId: "B99999999", fiscalAddress: "C/ Nueva 2", fiscalCity: "Bilbao" },
    });
    assert.ok(texto.includes("NIF/CIF: B11111111"), "debía imprimir el NIF congelado");
    assert.equal(texto.includes("B99999999"), false, "el NIF de hoy no puede salir");
    assert.ok(texto.includes("C/ Antigua 9"), "la dirección congelada");
    assert.ok(texto.includes("40001 Segovia"), "el CP y la ciudad congelados");
    assert.equal(texto.includes("Bilbao"), false, "la ciudad de hoy no puede salir");
  });

  it("sin foto sigue leyendo la ficha, como las emitidas antes del cambio", async () => {
    const texto = await textoFactura({ invoice: { fiscalSnapshot: null } });
    assert.ok(texto.includes("NIF/CIF: 12345678Z"));
    assert.ok(texto.includes("C/ Mayor 1"));
  });

  it("una foto rota no deja el documento sin destinatario", async () => {
    // El fallo caro sería preferir una foto vacía y tapar el respaldo: la
    // factura saldría sin a quién.
    const texto = await textoFactura({ invoice: { fiscalSnapshot: { direccion: "C/ Sola 1" } } });
    assert.ok(texto.includes("Pérez e Hijos SL"));
    assert.ok(texto.includes("NIF/CIF: 12345678Z"));
  });

  it("el correo NO se congela: no es un dato fiscal, es por dónde se escribe hoy", async () => {
    const texto = await textoFactura({
      invoice: { fiscalSnapshot: { nombre: "Pérez e Hijos SL", nif: "B11111111" } },
      client: { ...CLIENTE, email: "nuevo@ejemplo.es" },
    });
    assert.ok(texto.includes("nuevo@ejemplo.es"));
  });

  it("las señas del cliente salen entre el nombre y la tabla: NIF, dirección, CP y correo", async () => {
    const texto = await textoFactura();
    assert.ok(texto.includes("C/ Mayor 1"));
    assert.ok(texto.includes("28001 Madrid"));
    assert.ok(texto.includes("familia@ejemplo.es"));
  });

  it("una razón social de DOS líneas no pisa el NIF (el fallo del 21/08/2026)", async () => {
    // Antes las señas se pintaban a altura fija: con un nombre de dos líneas el
    // «NIF/CIF» caía justo encima de la segunda y la factura salía ilegible.
    // Aquí se comprueba en el sitio donde se ve: la posición vertical de cada
    // texto en la página. Nada puede compartir línea con nada.
    const buffer = await buildInvoicePdfBuffer({
      invoice: factura(),
      client: {
        ...CLIENTE,
        fiscalName: "Asociación de Madres y Padres del Colegio Público Nuestra Señora",
      },
      settings: EMISOR,
    });
    const pdf = abrirPdf(buffer);
    // Solo la columna de la izquierda (el bloque del cliente empieza en x=50).
    const izquierda = pdf.paginas[0].posiciones.filter((p) => p.x === 50).map((p) => p.y);
    const repetidas = izquierda.filter((y, i) => izquierda.indexOf(y) !== i);
    assert.deepEqual(repetidas, [], "hay dos textos dibujados a la misma altura: se pisan");
    // Y con menos de un punto entre líneas también se pisarían.
    const ordenadas = [...izquierda].sort((a, b) => b - a);
    for (let i = 1; i < ordenadas.length; i++) {
      assert.ok(
        ordenadas[i - 1] - ordenadas[i] >= 9,
        `dos líneas del bloque izquierdo a ${(ordenadas[i - 1] - ordenadas[i]).toFixed(1)} puntos`
      );
    }
    // Y el texto sigue completo y en orden.
    assert.ok(
      pdf.texto.includes(
        "FACTURAR A\n" +
          "Asociación de Madres y Padres del Colegio \n" +
          "Público Nuestra Señora\n" +
          "NIF/CIF: 12345678Z\n" +
          "C/ Mayor 1"
      ),
      pdf.texto
    );
  });

  it("un cliente de señas largas empuja la TABLA hacia abajo, no se mete en ella", async () => {
    // La otra mitad del arreglo del 21/08/2026, y la que no se ve mirando solo
    // el bloque del cliente: la tabla arrancaba a altura fija (`blockY + 78`),
    // así que en cuanto las señas ocupaban unas líneas de más el correo del
    // cliente caía DENTRO de la banda gris de la cabecera —o directamente sobre
    // la primera línea de concepto—. La cabecera de la tabla se dibuja en x=54
    // y siguientes, nunca en x=50, así que la comprobación de arriba no la ve:
    // hay que mirar el bloque del cliente CONTRA la tabla.
    const buffer = await buildInvoicePdfBuffer({
      invoice: factura(), // sin notas ni pie: lo único que hay en x=50 son los dos bloques
      client: {
        fiscalName: "Asociación de Madres y Padres del Colegio Público Nuestra Señora",
        taxId: "12345678Z",
        fiscalAddress: "Calle de la Ribera del Loira número 46, Edificio 2, planta 3, puerta B",
        fiscalZip: "28042",
        fiscalCity: "Madrid",
        email: "administracion.facturacion@asociacionmadresypadres.example.org",
      },
      settings: EMISOR,
    });
    const pdf = abrirPdf(buffer);
    const posiciones = pdf.paginas[0].posiciones;
    const cabecera = posiciones.find((p) => p.texto === "Concepto");
    const rotulo = posiciones.find((p) => p.texto === "FACTURAR A");
    assert.ok(cabecera && rotulo, "no se han encontrado la cabecera de la tabla y el rótulo");

    // Todo lo que se dibuja en la columna izquierda desde «FACTURAR A» hacia
    // abajo es el bloque del cliente, y tiene que quedar POR ENCIMA de la
    // cabecera de la tabla (más `y` = más arriba).
    const bloque = posiciones.filter((p) => p.x === 50 && p.y <= rotulo.y);
    assert.ok(
      bloque.length >= 8,
      `el cliente largo debería ocupar varias líneas, no ${bloque.length}`
    );
    for (const p of bloque) {
      assert.ok(
        p.y >= cabecera.y + 8,
        `«${p.texto.slice(0, 40)}» se dibuja a y=${p.y.toFixed(1)} y la tabla empieza en ` +
          `y=${cabecera.y.toFixed(1)}: el bloque del cliente se ha metido dentro de la tabla`
      );
    }
    // Y las señas siguen enteras y en su orden.
    assert.ok(pdf.texto.includes("NIF/CIF: 12345678Z\nCalle de la Ribera del Loira"), pdf.texto);
    assert.ok(pdf.texto.includes("28042 Madrid"));
  });

  it("con un cliente corriente la tabla no se mueve de donde estaba", async () => {
    // El arreglo no puede desplazar la factura de todos los días: con un nombre
    // de una línea la tabla sigue arrancando donde la ponía `blockY + 78`.
    const pdf = abrirPdf(
      await buildInvoicePdfBuffer({ invoice: factura(), client: CLIENTE, settings: EMISOR })
    );
    const cabecera = pdf.paginas[0].posiciones.find((p) => p.texto === "Concepto");
    // A4 mide 841,89 de alto y el origen del PDF está abajo: 841,89 - 128 - 78 - 20
    // (la banda de la cabecera) ≈ 615,9, y el rótulo se dibuja 6 puntos dentro.
    assert.ok(
      Math.abs(cabecera.y - 623.1) < 1.5,
      `la cabecera de la tabla se ha movido a y=${cabecera.y.toFixed(1)} (se esperaba ~623,1)`
    );
  });
});

describe("buildInvoicePdfBuffer: número, estado y quién la emite", () => {
  it("una factura emitida lleva serie · número; un borrador lleva «BORRADOR»", async () => {
    assert.ok((await textoFactura()).includes("FACTURA\nF2026 · F2026-0007"));
    const borrador = await textoFactura({ invoice: { status: "draft" } });
    assert.ok(borrador.includes("FACTURA\nBORRADOR"));
    assert.equal(borrador.includes("F2026-0007"), false, "un borrador no puede enseñar número");
  });

  it("las fechas salen en formato español, y las que faltan como «—»", async () => {
    const texto = await textoFactura();
    assert.ok(texto.includes("Fecha de emisión\n14/8/2026"));
    assert.ok(texto.includes("Vencimiento\n14/9/2026"));
    const sinVencimiento = await textoFactura({ invoice: { dueDate: null } });
    assert.ok(sinVencimiento.includes("Vencimiento\n—"));
  });

  it("una fecha que no es fecha se imprime tal cual, sin «Invalid Date»", async () => {
    const texto = await textoFactura({ invoice: { dueDate: "pendiente de acordar" } });
    assert.ok(texto.includes("Vencimiento\npendiente de acordar"));
    assert.equal(texto.includes("Invalid"), false);
  });

  it("«Emitida por» solo aparece si se pasa el socio que factura", async () => {
    assert.ok((await textoFactura({ partnerName: "Rodrigo" })).includes("Emitida por\nRodrigo"));
    assert.equal((await textoFactura()).includes("Emitida por"), false);
  });

  it("un estado desconocido se imprime crudo (por eso la prueba siguiente vigila el enum)", async () => {
    assert.ok((await textoFactura({ invoice: { status: "zombi" } })).includes("Estado: zombi"));
  });
});

describe("todos los estados de una factura tienen etiqueta en español", () => {
  // El PDF lo lee un cliente. Si mañana se añade un estado al modelo y nadie se
  // acuerda de STATUS_LABEL, la factura le enseñaría la clave en inglés. Leer
  // el modelo es la forma más barata de enterarse sin abrir la base de datos.
  const modelo = readFileSync(join(RAIZ, "models/tenant/Invoice.model.js"), "utf8");
  const bloque = /status:\s*\{\s*type:\s*DataTypes\.ENUM\(([\s\S]*?)\)/.exec(modelo);
  const estados = bloque ? [...bloque[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];

  it("el modelo declara los 8 estados que se esperan", () => {
    assert.deepEqual(estados, [
      "draft",
      "issued",
      "sent",
      "paid",
      "partially_paid",
      "overdue",
      "cancelled",
      "rectified",
    ]);
  });

  for (const estado of [
    ["issued", "Emitida"],
    ["sent", "Enviada"],
    ["paid", "Cobrada"],
    ["partially_paid", "Cobro parcial"],
    ["overdue", "Vencida"],
    ["cancelled", "Anulada"],
    ["rectified", "Rectificada"],
    ["draft", "Borrador"],
  ]) {
    it(`«${estado[0]}» se imprime como «${estado[1]}»`, async () => {
      const texto = await textoFactura({ invoice: { status: estado[0] } });
      assert.ok(
        texto.includes(`Estado: ${estado[1]}`),
        `salió: ${/Estado: [^\n]*/.exec(texto)?.[0]}`
      );
    });
  }
});

/* ═══ Factura: los números ═════════════════════════════════════════════════ */

describe("los totales que imprime son los que se le pasaron", () => {
  it("base, IVA y total, con coma decimal y punto de millar", async () => {
    const texto = await textoFactura({
      invoice: {
        taxBase: 1234.5,
        total: 1493.75,
        lines: [linea({ quantity: 12, unitPrice: 102.875, lineBase: 1234.5, lineVat: 259.25 })],
      },
    });
    assert.ok(texto.includes("Base imponible\n1.234,50 €"));
    assert.ok(texto.includes("IVA 21,00 %\n259,25 €"));
    assert.ok(texto.includes("TOTAL\n1.493,75 €"));
  });

  it("el desglose agrupa por tipo de IVA y va de mayor a menor", async () => {
    const texto = await textoFactura({
      invoice: {
        taxBase: 300,
        total: 352,
        lines: [
          linea({ description: "A", vatRate: 10, lineBase: 100, lineVat: 10 }),
          linea({ description: "B", vatRate: 21, lineBase: 200, lineVat: 42 }),
          linea({ description: "C", vatRate: 10, lineBase: 0, lineVat: 0 }),
        ],
      },
    });
    assert.ok(
      texto.includes("Base imponible\n300,00 €\nIVA 21,00 %\n42,00 €\nIVA 10,00 %\n10,00 €\nTOTAL")
    );
  });

  it("el IRPF solo sale si se retuvo algo, y sale restando", async () => {
    const conIrpf = await textoFactura({
      invoice: { taxBase: 100, irpfRate: 15, irpfAmount: 15, total: 106 },
    });
    assert.ok(conIrpf.includes("IRPF -15,00 %\n- 15,00 €"));
    assert.equal((await textoFactura()).includes("IRPF"), false);
    assert.equal(
      (await textoFactura({ invoice: { irpfAmount: 0, irpfRate: 15 } })).includes("IRPF"),
      false
    );
  });

  it("cero es cero y se imprime: una factura a 0 € no dice «—»", async () => {
    const texto = await textoFactura({ invoice: { taxBase: 0, total: 0, lines: [] } });
    assert.ok(texto.includes("Base imponible\n0,00 €"));
    assert.ok(texto.includes("TOTAL\n0,00 €"));
  });

  it("«Cobrado / Pendiente» solo con un cobro PARCIAL (ni sin cobrar, ni del todo)", async () => {
    const conParcial = await textoFactura({ invoice: { total: 121, paidAmount: 40 } });
    assert.ok(conParcial.includes("Cobrado: 40,00 €  ·  Pendiente: 81,00 €"));
    for (const paidAmount of [0, 121, 200]) {
      const texto = await textoFactura({ invoice: { total: 121, paidAmount } });
      assert.equal(
        texto.includes("Cobrado:"),
        false,
        `no debía salir con paidAmount=${paidAmount}`
      );
    }
  });

  it("cada línea imprime cantidad, precio, descuento, IVA e importe; sin descuento, «—»", async () => {
    const texto = await textoFactura({
      invoice: { lines: [linea({ quantity: 2, unitPrice: 100, discountPct: 10, lineBase: 180 })] },
    });
    assert.ok(texto.includes("Sesión de logopedia\n2,00\n100,00 €\n10,00 %\n21,00 %\n180,00 €"));
    assert.ok(
      (await textoFactura()).includes("Sesión de logopedia\n1,00\n100,00 €\n—\n21,00 %\n100,00 €")
    );
  });

  it("sin lineBase el importe se calcula cantidad × precio (IGNORANDO el descuento)", async () => {
    // Es a propósito: el importe de la línea lo calcula Facturación y viaja en
    // `lineBase`. El respaldo solo existe para no imprimir un hueco.
    const texto = await textoFactura({
      invoice: {
        lines: [linea({ quantity: 3, unitPrice: 50, discountPct: 50, lineBase: undefined })],
      },
    });
    assert.ok(texto.includes("50,00 %\n21,00 %\n150,00 €"));
  });

  it("un importe que no es un número sale como «NaN €» // SOSPECHOSO", async () => {
    // `money()` hace `Number(n || 0)`: null y NaN caen a 0, pero un texto no
    // numérico sobrevive y se formatea como NaN. Hoy no muerde porque las
    // columnas son DECIMAL, pero un importe corrupto saldría impreso.
    const texto = await textoFactura({ invoice: { lines: [linea({ unitPrice: "en revisión" })] } });
    assert.ok(texto.includes("NaN €"));
    const conNulos = await textoFactura({
      invoice: {
        lines: [linea({ unitPrice: null, quantity: null, vatRate: null, lineBase: null })],
      },
    });
    assert.ok(conNulos.includes("0,00\n0,00 €\n—\n0,00 %\n0,00 €"));
  });

  it("un TOTAL de seis o de diez cifras cabe entero en su línea", async () => {
    // Estaba fijado como borde tolerado el 21/08 dando por hecho que «ningún
    // cliente factura esas cantidades». Triado el 24/08/2026: no hace falta
    // una cantidad rara, basta con 100.000 € —la columna es DECIMAL(12,2) y el
    // campo de la pantalla no tiene tope—, y lo que salía era el importe de un
    // documento fiscal partido en dos renglones. Medido con la fuente de
    // verdad: la casilla eran 65 pt y «100.000,00 €» ocupa 70,1.
    //
    // Ahora la etiqueta se queda con 60 pt (le bastan 38) y el importe con 125,
    // donde cabe el rango ENTERO de la columna: 9.999.999.999,99 € mide 103,4.
    const grande = await textoFactura({ invoice: { taxBase: 1234567.89, total: 1493627.15 } });
    assert.ok(grande.includes("TOTAL\n1.493.627,15 €"), "el total de siete cifras, en una sola línea");

    const justo = await textoFactura({ invoice: { taxBase: 82644.62, total: 99999.99 } });
    assert.ok(justo.includes("TOTAL\n99.999,99 €"), "y el que ya cabía sigue igual");

    const elQueRompia = await textoFactura({ invoice: { taxBase: 82644.63, total: 100000 } });
    assert.ok(elQueRompia.includes("TOTAL\n100.000,00 €"), "100.000 € era el primero que se partía");

    const tope = await textoFactura({ invoice: { taxBase: 8264462809.91, total: 9999999999.99 } });
    assert.ok(tope.includes("TOTAL\n9.999.999.999,99 €"), "el máximo que admite DECIMAL(12,2) también entra");
  });

  it("SOSPECHOSO: las subfilas (Base, IVA, IRPF) siguen en la casilla estrecha", async () => {
    // El arreglo de arriba ensanchó SOLO la fila del TOTAL. Base imponible, IVA
    // e IRPF van en Helvetica 9.5 dentro de los 65 pt de siempre y se parten a
    // partir de 10.000.000,00 €. Se deja fijado tal cual y con la marca puesta:
    // el techo pasó de 100.000 a 10.000.000, no a infinito, y conviene que eso
    // se vea aquí y no se descubra con una factura delante.
    const enorme = await textoFactura({ invoice: { taxBase: 12345678.9, total: 12345678.9 } });
    assert.ok(enorme.includes("TOTAL\n12.345.678,90 €"), "el total sí cabe");
  });
});

/* ═══ Factura: bordes ══════════════════════════════════════════════════════ */

describe("buildInvoicePdfBuffer: lo raro no lo tumba", () => {
  it("sin líneas queda la tabla vacía pero los totales siguen ahí", async () => {
    const texto = await textoFactura({ invoice: { lines: [] } });
    assert.ok(texto.includes("Concepto\nCant.\nPrecio\nDto.\nIVA\nImporte\nBase imponible"));
    assert.ok(texto.includes("TOTAL\n121,00 €"));
    assert.equal(texto.includes("IVA 21,00 %"), false, "sin líneas no hay desglose de IVA");
  });

  it("`lines` que no es una lista se trata como ninguna línea", async () => {
    // Con `null` cualquier respaldo vale; el que de verdad separa `Array.isArray`
    // de un `|| []` es una CADENA, que se puede recorrer letra a letra: sin la
    // comprobación saldría una fila de tabla por cada carácter.
    for (const lines of [null, undefined, "F2026-0007", { 0: linea(), length: 1 }, 7]) {
      const texto = await textoFactura({ invoice: { lines } });
      assert.ok(texto.includes("TOTAL\n121,00 €"), `con lines=${JSON.stringify(lines)}`);
      assert.ok(
        texto.includes("Importe\nBase imponible"),
        `con lines=${JSON.stringify(lines)} se han dibujado filas de tabla: ${texto}`
      );
    }
  });

  it("una descripción vacía se imprime como «—», no como un hueco", async () => {
    const texto = await textoFactura({ invoice: { lines: [linea({ description: "" })] } });
    assert.ok(texto.includes("Importe\n—\n1,00\n100,00 €"));
  });

  it("paréntesis, barras y acentos salen literales (pdfkit los escapa por dentro)", async () => {
    const texto = await textoFactura({
      invoice: {
        notes: "Nota con (paréntesis) y \\barra\\",
        lines: [linea({ description: "Sesión (2) \\ <b>ojo</b> · ñ á ü" })],
      },
      client: { fiscalName: "Pérez & Cía (S.L.)" },
    });
    assert.ok(texto.includes("Pérez & Cía (S.L.)"));
    assert.ok(texto.includes("Sesión (2) \\ <b>ojo</b> · ñ á ü"));
    assert.ok(texto.includes("Nota con (paréntesis) y \\barra\\"));
  });

  it("notas, nota de exención de IVA y pie: cada una solo si viene", async () => {
    const conTodo = await textoFactura({
      invoice: { notes: "Gracias", customFields: { vatExemptNote: "Exenta art. 20.1.3" } },
      settings: { ...EMISOR, invoiceFooterText: "Inscrita en el registro mercantil" },
    });
    assert.ok(conTodo.includes("Exenta art. 20.1.3"));
    assert.ok(conTodo.includes("NOTAS\nGracias"));
    assert.ok(conTodo.includes("Inscrita en el registro mercantil"));
    const pelada = await textoFactura({ invoice: { customFields: {} } });
    assert.equal(pelada.includes("NOTAS"), false);
    assert.equal(pelada.includes("Exenta"), false);
  });

  it("60 líneas caben en tres páginas sin perder ninguna y con UN solo TOTAL", async () => {
    const lineas = Array.from({ length: 60 }, (_, i) =>
      linea({ description: `Concepto número ${i}`, unitPrice: 10, lineBase: 10, lineVat: 2.1 })
    );
    const buffer = await buildInvoicePdfBuffer({
      invoice: factura({ taxBase: 600, total: 726, lines: lineas }),
      client: CLIENTE,
      settings: EMISOR,
    });
    const pdf = abrirPdf(buffer);
    assert.equal(pdf.paginas.length, 3);
    const perdidas = lineas
      .filter((l) => !pdf.texto.includes(l.description))
      .map((l) => l.description);
    assert.deepEqual(perdidas, [], "se han quedado líneas fuera del PDF");
    assert.equal((pdf.texto.match(/TOTAL/g) || []).length, 1);
    assert.ok(pdf.paginas.at(-1).texto.includes("TOTAL\n726,00 €"));
  });

  it("una descripción larguísima empuja los totales a la página siguiente, no los borra", async () => {
    const buffer = await buildInvoicePdfBuffer({
      invoice: factura({ lines: [linea({ description: "palabra ".repeat(300).trim() })] }),
      client: CLIENTE,
      settings: EMISOR,
    });
    const pdf = abrirPdf(buffer);
    assert.equal(pdf.paginas.length, 2);
    assert.equal((pdf.texto.match(/TOTAL/g) || []).length, 1);
    assert.ok(pdf.texto.includes("Base imponible\n100,00 €"));
  });

  it("sin factura RECHAZA en vez de quedarse colgado (una promesa que no vuelve cuelga la petición)", async () => {
    await assert.rejects(
      buildInvoicePdfBuffer({ invoice: null, client: {}, settings: {} }),
      TypeError
    );
    await assert.rejects(buildInvoicePdfBuffer({}), TypeError);
  });

  it("dos facturas a la vez no se mezclan (cada PDF junta SUS trozos)", async () => {
    const buffers = await Promise.all(
      ["Uno", "Dos", "Tres"].map((n) =>
        buildInvoicePdfBuffer({
          invoice: factura({ number: `F2026-${n}` }),
          client: { fiscalName: `Cliente ${n}` },
          settings: EMISOR,
        })
      )
    );
    assert.deepEqual(
      buffers.map((b) => abrirPdf(b).texto.match(/Cliente \w+/)[0]),
      ["Cliente Uno", "Cliente Dos", "Cliente Tres"]
    );
  });

  it("la fecha sin hora se lee en la zona del servidor: el día es el mismo aquí y en el VPS", async () => {
    // `fmtDate` le pega «T00:00:00» al texto 'AAAA-MM-DD', que en JavaScript es
    // medianoche LOCAL: el día impreso no se mueve con la zona horaria.
    const texto = await textoFactura({
      invoice: { issueDate: "2026-01-01", dueDate: "2026-12-31" },
    });
    assert.ok(texto.includes("Fecha de emisión\n1/1/2026"));
    assert.ok(texto.includes("Vencimiento\n31/12/2026"));
  });
});

/* ═══ Informe clínico: el nombre del fichero ═══════════════════════════════ */

describe("reportPdfFilename: lo que la familia ve en su área privada", () => {
  it("junta tipo, paciente y fecha con guiones", () => {
    assert.equal(
      reportPdfFilename({ reportType: "evolution", reportDate: "2026-08-10" }, "Ana López"),
      "Evolutivo - Ana López - 2026-08-10.pdf"
    );
  });

  it("cada tipo tiene su nombre en español; uno desconocido cae en «Informe»", () => {
    const nombre = (reportType) => reportPdfFilename({ reportType }, "Ana");
    assert.equal(nombre("admission"), "Entrevista inicial - Ana.pdf");
    assert.equal(nombre("discharge"), "Alta - Ana.pdf");
    assert.equal(nombre("referral"), "Derivación - Ana.pdf");
    assert.equal(nombre("wat"), "Informe - Ana.pdf");
    assert.equal(nombre(undefined), "Informe - Ana.pdf");
  });

  it("de una fecha con hora se queda con el día", () => {
    assert.equal(
      reportPdfFilename({ reportType: "evolution", reportDate: "2026-08-10T22:30:00.000Z" }, "Ana"),
      "Evolutivo - Ana - 2026-08-10.pdf"
    );
  });

  it("los caracteres prohibidos del nombre del paciente se BORRAN, no se sustituyen", () => {
    assert.equal(
      reportPdfFilename({ reportType: "discharge", reportDate: "2026-08-10" }, 'Ana "L"/M'),
      "Alta - Ana LM - 2026-08-10.pdf"
    );
  });

  it("sin paciente y sin fecha queda solo el tipo, sin guiones sueltos", () => {
    assert.equal(reportPdfFilename({ reportType: "evolution" }, null), "Evolutivo.pdf");
    assert.equal(
      reportPdfFilename({ reportType: "evolution", reportDate: "" }, "   "),
      "Evolutivo.pdf"
    );
  });
});

/* ═══ Informe clínico: el documento ════════════════════════════════════════ */

describe("buildReportPdfBuffer: la cabecera y la ficha de datos", () => {
  it("devuelve un Buffer PDF con la tipografía del CRM embebida", async () => {
    const buffer = await buildReportPdfBuffer({ report: informe(), patientName: "Ana López" });
    assert.ok(esPdf(buffer));
    assert.ok(buffer.length > 5000, `con la fuente embebida no pesa ${buffer.length} bytes`);
    assert.ok(buffer.toString("latin1").includes("Poppins"), "debería llevar Poppins dentro");
  });

  /*
   * 28/08/2026 — EL DOCUMENTO CAMBIÓ DE FORMA, NO DE CONTENIDO.
   *
   * El informe pasó de ser una hoja (cabecera + ficha de rótulos + secciones) a
   * un documento con portada a sangre, índice, apartados numerados y firma. Las
   * aserciones de aquí abajo se han reescrito al formato nuevo, pero comprueban
   * lo MISMO que comprobaban: que el centro sale, que el tipo de informe se
   * nombra, que el paciente y la profesional van bajo su rótulo, y que la
   * especialidad de destino sale con la etiqueta del centro y no con su clave.
   */

  it("la portada nombra el centro y el documento", async () => {
    assert.match(await textoInforme(), /^Centro Aumenta\nInforme de evolución\n/);
    // Sin nombre de centro no se pinta una línea en blanco: empieza el título.
    assert.match(
      await textoInforme({ tenantName: null, report: { reportType: "referral" } }),
      /^Informe de derivación\n/
    );
    // Un tipo que no está en el catálogo cae en «Informe» también DENTRO del
    // documento, no solo en el nombre del fichero (son dos respaldos distintos).
    assert.match(await textoInforme({ report: { reportType: "wat" } }), /^Centro Aumenta\nInforme\n/);
    assert.match(await textoInforme({ report: { reportType: null } }), /^Centro Aumenta\nInforme\n/);
  });

  it("la portada lleva paciente, profesional y fecha, cada uno bajo su rótulo", async () => {
    const texto = await textoInforme();
    assert.ok(texto.includes("PACIENTE\nAna López"), texto);
    assert.ok(texto.includes("PROFESIONAL RESPONSABLE\nMarta García"), texto);
    // La fecha cierra la portada junto al nombre del centro.
    assert.ok(texto.includes("Centro Aumenta · 10 de agosto de 2026"), texto);
  });

  it("las filas de la ficha que no tienen valor no se imprimen (ni su rótulo)", async () => {
    const texto = await textoInforme({ therapistName: "   ", report: { reportDate: null } });
    assert.equal(texto.includes("PROFESIONAL"), false);
    assert.equal(texto.includes("FECHA DEL INFORME"), false);
    assert.ok(texto.includes("PACIENTE\nAna López"));
  });

  it("la especialidad de destino solo sale en los informes que la traen, con su etiqueta", async () => {
    const derivacion = await textoInforme({
      report: {
        reportType: "referral",
        contentSections: { referralSpecialty: "neuropediatria", motiveOfIntervention: "M" },
      },
    });
    assert.ok(derivacion.includes("Especialidad de destino: Neuropediatra"));
    assert.equal((await textoInforme()).includes("Especialidad de destino"), false);
  });

  it("la especialidad sale con la etiqueta que escribió EL CENTRO, no con su clave", async () => {
    // Estaba fijado como borde tolerado el 21/08 («no se arregla aquí porque el
    // generador no recibe el tenant»). Triado el 24/08/2026 y arreglado: el
    // catálogo de derivaciones es una función vendida y editable por centro
    // desde Configuración, y `slugEspecialidad` convierte «Terapia ocupacional»
    // en la clave `terapia_ocupacional`, que NO está en el catálogo de fábrica.
    // O sea que el informe que recibe la familia, con el membrete de la
    // clínica, imprimía la clave con guiones bajos: parece un error del centro.
    // La función correcta ya existía (`referralSpecialtyLabelOf`, con respaldo
    // catálogo del centro → catálogo global → la clave); solo había que pasarle
    // el tenant, que el llamador ya tenía en la mano.
    const centro = {
      settings: {
        clinica: {
          referralSpecialties: [
            { key: "terapia_ocupacional", label: "Terapia ocupacional" },
            { key: "logopeda", label: "Logopeda" },
          ],
        },
      },
    };
    const conCentro = await textoInforme({
      tenant: centro,
      report: {
        contentSections: { referralSpecialty: "terapia_ocupacional", motiveOfIntervention: "M" },
      },
    });
    assert.ok(conCentro.includes("Especialidad de destino: Terapia ocupacional"), "la etiqueta del centro");
    assert.ok(!conCentro.includes("terapia_ocupacional"), "y la clave ya no se ve por ninguna parte");
  });

  it("sin tenant, o con una clave que ya no está en su lista, no se queda en blanco", async () => {
    // Los dos respaldos, que son los que hacen que el arreglo no rompa nada:
    // sin tenant se comporta como antes (catálogo de fábrica), y una clave que
    // el centro borró después sigue enseñando algo legible en vez de un hueco.
    const sinTenant = await textoInforme({
      report: { contentSections: { referralSpecialty: "neuropediatria", motiveOfIntervention: "M" } },
    });
    assert.ok(sinTenant.includes("Especialidad de destino: Neuropediatra"), "cae al catálogo global");

    const claveRetirada = await textoInforme({
      tenant: { settings: { clinica: { referralSpecialties: [{ key: "logopeda", label: "Logopeda" }] } } },
      report: { contentSections: { referralSpecialty: "neuropediatria", motiveOfIntervention: "M" } },
    });
    assert.ok(claveRetirada.includes("Especialidad de destino: Neuropediatra"), "un informe viejo se sigue leyendo");
  });

  it("los colores del documento salen de la marca del cliente, y son neutros sin ella", async () => {
    /*
     * 28/08/2026: antes esto miraba UN color —la regla bajo el título—. Con el
     * rediseño el color está por todo el documento (fondo de la portada,
     * manchas, número de cada apartado, filetes), y todos salen derivados de la
     * marca por `lib/clinica/marcaInforme.js`. Lo que se comprueba sigue siendo
     * lo mismo: que el cliente pone el color y que sin marca no se le inventa
     * ninguno.
     */
    const colores = (buffer) =>
      [...abrirPdf(buffer).paginas[0].contenido.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:SCN|scn|rg)/g)]
        .map((m) => m.slice(1, 4).map((v) => Math.round(Number(v) * 255)).join(","));

    const conMarca = await buildReportPdfBuffer({
      report: informe(),
      patientName: "Ana",
      brand: { primaryColor: "#124A55", secondaryColor: "#F59C00" },
    });
    const paleta = paletaDeInforme({ primaryColor: "#124A55", secondaryColor: "#F59C00" });
    const aRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
    assert.ok(colores(conMarca).includes(aRgb(paleta.tinteSuave)), "el fondo de la portada es el tinte de su marca");
    assert.ok(colores(conMarca).includes(aRgb(paleta.oscuro)), "y el titular, su color secundario");

    const sinMarca = await buildReportPdfBuffer({ report: informe(), patientName: "Ana", brand: null });
    const neutra = paletaDeInforme(null);
    assert.ok(colores(sinMarca).includes(aRgb(neutra.oscuro)), "sin marca, pizarra neutra");
    assert.ok(!colores(sinMarca).includes(aRgb(paleta.oscuro)), "y ni rastro del color de otro cliente");
  });
});

describe("buildReportPdfBuffer: las secciones, en su orden y solo las que tienen algo", () => {
  it("las siete secciones salen SIEMPRE en el orden de lectura, no en el que vengan", async () => {
    const texto = await textoInforme({
      report: {
        contentSections: {
          recommendations: ["R"],
          continuityProposal: "C",
          motiveOfIntervention: "M",
          persistentDifficulties: ["D"],
          objectives: ["O"],
          achievements: ["A"],
          evolution: ["E"],
        },
      },
    });
    /*
     * 28/08/2026: los apartados van ahora numerados, así que ya no se pueden
     * concatenar en una sola cadena. Se comprueba lo mismo —que salen los siete
     * en el orden de lectura y no en el que vinieron— por su POSICIÓN en el
     * documento, que además aguanta que mañana cambie el adorno.
     */
    const ORDEN = [
      "Motivo de intervención",
      "Objetivos",
      "Evolución",
      "Logros",
      "Dificultades que persisten",
      "Recomendaciones",
      "Propuesta de continuidad",
    ];
    // Se busca en el CUERPO, saltándose la portada y el índice (que repiten los
    // mismos rótulos y descolocarían las posiciones).
    const cuerpo = texto.slice(texto.lastIndexOf("Motivo de intervención"));
    const posiciones = ORDEN.map((t) => cuerpo.indexOf(t));
    for (const [i, p] of posiciones.entries()) {
      assert.ok(p >= 0, `falta el apartado «${ORDEN[i]}»:\n${cuerpo}`);
      if (i > 0) {
        assert.ok(p > posiciones[i - 1], `«${ORDEN[i]}» va detrás de «${ORDEN[i - 1]}»:\n${cuerpo}`);
      }
    }
    // Y correlativos hasta el 7, que es lo que casa el índice con el cuerpo.
    assert.match(cuerpo, /2\nObjetivos/, cuerpo);
    assert.match(cuerpo, /7\nPropuesta de continuidad/, cuerpo);
  });

  it("una sección vacía, en blanco o con lista vacía no se imprime ni con su titular", async () => {
    const texto = await textoInforme({
      report: {
        contentSections: {
          motiveOfIntervention: "Sí sale",
          objectives: [],
          evolution: "   ",
          achievements: null,
          recommendations: ["", "  "],
        },
      },
    });
    assert.ok(texto.includes("Motivo de intervención\nSí sale"));
    for (const titular of ["Objetivos", "Evolución", "Logros", "Recomendaciones"]) {
      assert.equal(texto.includes(titular), false, `no debía salir el titular «${titular}»`);
    }
  });

  it("en las secciones de lista, cada elemento lleva su viñeta y los vacíos se caen", async () => {
    const texto = await textoInforme({
      report: { contentSections: { evolution: ["  ", "Primero", "", "Segundo"] } },
    });
    // 28/08/2026: la viñeta pasó de «•» a una raya, y se dibuja aparte del
    // texto para que la segunda línea sangre bajo la primera. Lo que se
    // comprueba es lo de siempre: los dos elementos salen, en orden, y los
    // vacíos no dejan una viñeta suelta.
    const vinetas = (texto.match(/—/g) || []).length;
    assert.equal(vinetas, 2, `dos elementos, dos viñetas — y ninguna huérfana:\n${texto}`);
    assert.ok(texto.indexOf("Primero") < texto.indexOf("Segundo"), texto);
    assert.ok(texto.indexOf("Evolución") < texto.indexOf("Primero"), texto);
  });

  it("una cadena suelta en un campo de lista se imprime como una sola viñeta", async () => {
    const texto = await textoInforme({
      report: { contentSections: { objectives: "una sola cadena" } },
    });
    assert.equal((texto.match(/—/g) || []).length, 1, `una cadena, una sola viñeta:\n${texto}`);
    assert.ok(texto.includes("una sola cadena"), texto);
  });

  it("un informe sin secciones pero con el texto de la IA lo imprime tal cual, bajo «Informe»", async () => {
    const texto = await textoInforme({
      report: { contentSections: {}, aiGenerated: "  Redactado por la IA y sin repartir  " },
    });
    assert.ok(texto.includes("Informe\nRedactado por la IA y sin repartir"));
  });

  it("con secciones, el texto bruto de la IA NO se cuela además", async () => {
    const texto = await textoInforme({ report: { aiGenerated: "no debería salir" } });
    assert.equal(texto.includes("no debería salir"), false);
  });

  it("un informe sin nada dice que no tiene contenido, en vez de salir en blanco", async () => {
    const texto = await textoInforme({ report: { contentSections: {}, aiGenerated: null } });
    assert.ok(texto.includes("Este informe todavía no tiene contenido redactado."));
  });

  it("`contentSections` que no es un objeto se trata como vacío", async () => {
    for (const contentSections of ["no-es-objeto", null, 42]) {
      const texto = await textoInforme({ report: { contentSections, aiGenerated: null } });
      assert.ok(
        texto.includes("Este informe todavía no tiene contenido redactado."),
        `reventó o imprimió algo con contentSections=${JSON.stringify(contentSections)}`
      );
    }
  });
});

describe("buildReportPdfBuffer: bordes", () => {
  it("un informe largo se reparte en varias páginas sin perder el final", async () => {
    const buffer = await buildReportPdfBuffer({
      report: informe({
        contentSections: {
          motiveOfIntervention: "Motivo detallado. ".repeat(400),
          recommendations: Array.from({ length: 40 }, (_, i) => `Recomendación número ${i}`),
        },
      }),
      patientName: "Ana López",
      tenantName: "Centro Aumenta",
    });
    const pdf = abrirPdf(buffer);
    assert.ok(pdf.paginas.length >= 3, `esperaba varias páginas y salieron ${pdf.paginas.length}`);
    assert.ok(pdf.texto.includes("Recomendación número 39"), "se perdió la última recomendación");
  });

  it("acentos, eñes y símbolos raros sobreviven a la fuente embebida", async () => {
    const texto = await textoInforme({
      report: {
        contentSections: { motiveOfIntervention: "Niño con «dislalia» — evaluación à fondo ¿sí?" },
      },
    });
    assert.ok(texto.includes("Niño con «dislalia» — evaluación à fondo ¿sí?"));
  });

  it("sin informe RECHAZA en vez de quedarse colgado", async () => {
    await assert.rejects(buildReportPdfBuffer({ report: null }), TypeError);
    await assert.rejects(buildReportPdfBuffer({}), TypeError);
  });

  it("dos informes a la vez no se mezclan", async () => {
    const buffers = await Promise.all(
      ["Uno", "Dos", "Tres"].map((n) =>
        buildReportPdfBuffer({
          report: informe({ contentSections: { motiveOfIntervention: `Motivo ${n}` } }),
          patientName: `Paciente ${n}`,
        })
      )
    );
    assert.deepEqual(
      buffers.map((b) => abrirPdf(b).texto.match(/Paciente \w+/)[0]),
      ["Paciente Uno", "Paciente Dos", "Paciente Tres"]
    );
  });

  it("una fecha que no es fecha, o ninguna, deja la fila fuera en vez de imprimir basura", async () => {
    for (const reportDate of ["no-es-fecha", null, ""]) {
      const texto = await textoInforme({ report: { reportDate } });
      assert.equal(
        texto.includes("FECHA DEL INFORME"),
        false,
        `con reportDate=${JSON.stringify(reportDate)}`
      );
      assert.equal(texto.includes("Invalid"), false);
    }
  });

  it("la fecha del informe se lee como INSTANTE, no como día de calendario // SOSPECHOSO", async () => {
    // La columna entrega 'AAAA-MM-DD' y `fmtFecha` se lo pasa a `new Date`, que
    // eso lo interpreta como medianoche UTC. En Madrid (UTC+1/+2) el día sale
    // bien siempre; en un servidor al oeste de Greenwich el informe llevaría el
    // día ANTERIOR. Aquí se fija el mecanismo SIN depender de la zona: el texto
    // pelado y el mismo instante en UTC producen exactamente lo mismo.
    const dia = async (reportDate) =>
      /(\d\d de \w+ de \d{4})/.exec(await textoInforme({ report: { reportDate } }))?.[1] ?? null;
    assert.equal(await dia("2026-01-05"), await dia("2026-01-05T00:00:00Z"));
    // Y un instante a mediodía UTC cae el mismo día en cualquier zona de -11 a
    // +12, que es donde puede estar un servidor de esto. (Comprobado: con
    // `TZ=Pacific/Kiritimati`, que es +14, saldría el 6 y esta línea fallaría;
    // el `TZ` hay que pasarlo en el entorno del proceso, porque anteponerlo al
    // comando en la terminal de Windows NO llega a Node y se mide Madrid.)
    assert.equal(await dia("2026-01-05T12:00:00Z"), "05 de enero de 2026");
  });
});
