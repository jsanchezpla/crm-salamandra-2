// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-pdf-contrato.mjs — la COPIA que se lleva quien firma el contrato del
 * centro (21/08/2026).
 *
 *   node --test scripts/_smoke-pdf-contrato.mjs
 *   node --test-name-pattern="constancia" scripts/_smoke-pdf-contrato.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/documents/contratoFirmadoPdf.js` son 321 líneas sin una sola prueba. Es
 * el único sitio del CRM que fabrica un documento con valor probatorio: lo que
 * imprime es lo que una familia podrá enseñar dentro de tres años para decir
 * «esto firmé». La única comprobación que existía —en
 * `_smoke-contrato-estructurado.mjs`, que pide base de datos— era el tamaño del
 * fichero, con este comentario: «el texto va comprimido dentro del PDF, así que
 * no se puede buscar a pelo». Un PDF de 20 KB con el clausulado equivocado pesa
 * exactamente lo mismo que uno con el bueno.
 *
 * Sí se puede buscar: aquí abajo hay un lector mínimo que descomprime los
 * flujos de contenido y traduce los códigos de glifo con el CMap `/ToUnicode`
 * que pdfkit ya mete en el propio documento. Con eso se comprueba lo que de
 * verdad importa, línea a línea:
 *
 *   · que sale el clausulado ENTERO de cada documento aceptado, y NINGUNO de
 *     los que no se aceptaron (un anexo opcional sin marcar no puede aparecer
 *     como aceptado: eso es firmar algo que nadie firmó);
 *   · que los datos declarados que se imprimen son los que se le pasaron;
 *   · que la traza —cuándo, desde qué IP, con qué navegador y qué versión del
 *     documento— va IMPRESA, que es lo que convierte el garabato en una firma
 *     que se sostiene;
 *   · que el pie del centro sale en TODAS las páginas y ni una vez de más (el
 *     truco del margen a cero de `pintarPie`: si se rompe, cada pie dispara un
 *     salto de página, y cada salto otro pie, hasta que se acaba la memoria);
 *   · y que nada de lo que llega del portal —un PNG corrupto, una plantilla a
 *     medias, un nombre con `<script>`, un emoji— tumba la generación. Si esto
 *     revienta, la familia firma y se queda sin su copia.
 *
 * FECHAS: `fmtFechaHora` (la constancia) va clavada a Europe/Madrid y es la
 * misma en cualquier máquina. `fmtFecha` (la fecha de la firma y los campos de
 * tipo `date`) NO lleva zona: las fechas de calendario de esta prueba están
 * elegidas para decir lo mismo con `TZ=UTC` y en Madrid, que es donde corre
 * producción, y el día que sí baila tiene su propio `it` marcado SOSPECHOSO al
 * final.
 *
 * DOS LÍMITES SABIDOS de esta prueba, para que nadie le pida más de lo que da:
 *
 *   · El `it` de «clavada a Europe/Madrid» solo lo DEMUESTRA en una máquina que
 *     NO esté en Madrid. Aquí y en producción el reloj ya es de Madrid, así que
 *     si alguien borrara ese `timeZone` la prueba seguiría verde: comprobado
 *     borrándolo. Para que valga hay que lanzarla con la zona cambiada
 *     (`TZ=UTC node --test scripts/_smoke-pdf-contrato.mjs`), que es un paso a
 *     mano; `npm test` no lo hace.
 *   · `lib/pdf/fonts.js` busca Poppins colgando del directorio DESDE EL QUE SE
 *     LANZA node. Fuera de la raíz del repo cae a Helvetica, el lector de abajo
 *     deja de traducir los glifos y todo esto se pone rojo con un diff
 *     incomprensible. Se lanza desde la raíz, como hace `npm test`.
 *
 * No se importa `lib/utils/errors.js` ni nada que arrastre `next/server`: esto
 * tiene que correr con Node pelado.
 *
 * ── TRIADAS EL 24/08/2026 ──────────────────────────────────────────────────
 * Las marcas de este fichero ya están juzgadas con el criterio del Registro:
 * DEFECTO = con una entrada que alguien puede mandar de verdad, devuelve algo
 * malo o revienta. TOLERANCIA = solo acepta basura que no tiene camino. Cada
 * una se comprobó ejecutando la función y siguiendo el dato hasta su columna
 * o su endpoint; una marca que sigue aquí NO es una marca sin mirar.
 *
 * Las otras 7 son TOLERANCIA, y el porqué de cada una está junto a su `it`.
 * En una frase, por qué ninguna tiene camino de entrada:
 *    759  un `signerData` que es una LISTA sí cuela `length` co…
 *         → Hacen falta DOS imposibles a la vez: que `signerData` sea un …
 *    819  la fecha del recuadro de firma SÍ depende de la zona de la máquina
 *         → No es un dato que nadie mande: es la zona horaria del proceso…
 *    842  una aceptación sin `acceptedAt` imprime «Aceptado el » y se queda…
 *         → El ternario de `seccionBloque` mira si hay aceptación, no si …
 *    858  sin título, la cabecera y la constancia llaman al documento de fo…
 *         → La cabecera hace `plantilla?.title || 'Contrato firmado'` y l…
 *    869  una versión 0 desaparece del nombre del documento
 *         → `version ? ... : ...` trata el 0 como «no hay versión» y la c…
 *    908  un `secondSignatureLabel` que no es texto tumba la generación
 *         → `recuadroFirma` hace `etiqueta.toUpperCase()` sin pasar por e…
 *    924  `contratoPdfFilename` REVIENTA si le dan una fecha ilegible
 *         → Llama a `new Date(fecha).toISOString()` a pelo, sin el `Numbe…
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import {
  buildContratoFirmadoPdf,
  contratoPdfFilename,
} from "../lib/documents/contratoFirmadoPdf.js";

/* ── Un lector de PDF del tamaño de un puño ────────────────────────────────
 *
 * No hay librería de lectura de PDF en el proyecto y no se añade una por una
 * prueba. Basta con esto porque el documento lo escribe pdfkit y siempre de la
 * misma forma: objetos `N 0 obj`, flujos con `/Filter /FlateDecode`, texto
 * `Identity-H` y un CMap `/ToUnicode` por fuente que dice qué carácter es cada
 * código. Si algún día pdfkit cambiara de forma, esto dejaría de encontrar
 * texto y las pruebas se pondrían rojas — que es lo que tiene que pasar.
 */

function inflar(crudo) {
  try {
    return zlib.inflateSync(crudo);
  } catch {
    return crudo; // el flujo no iba comprimido
  }
}

/** Todos los objetos del documento: número → { dic, datos }. */
function objetosDe(pdf) {
  const s = pdf.toString("latin1");
  const objetos = new Map();
  const re = /(\d+) 0 obj\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const desde = m.index + m[0].length;
    const hasta = s.indexOf("\nendobj", desde);
    if (hasta < 0) continue;
    const cuerpo = s.slice(desde, hasta);
    const corte = cuerpo.indexOf("stream\n");
    if (corte < 0) {
      objetos.set(Number(m[1]), { dic: cuerpo, datos: null });
    } else {
      const fin = cuerpo.lastIndexOf("\nendstream");
      objetos.set(Number(m[1]), {
        dic: cuerpo.slice(0, corte),
        datos: inflar(Buffer.from(cuerpo.slice(corte + 7, fin), "latin1")),
      });
    }
  }
  return objetos;
}

/** El `/ToUnicode` de pdfkit: un `bfrange` con la lista de códigos. */
function cmapDe(texto) {
  const mapa = new Map();
  const rangos = /beginbfrange([\s\S]*?)endbfrange/g;
  let r;
  while ((r = rangos.exec(texto))) {
    const linea = /<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>\s*\[([\s\S]*?)\]/g;
    let l;
    while ((l = linea.exec(r[1]))) {
      const desde = parseInt(l[1], 16);
      (l[2].match(/<[0-9a-fA-F]+>/g) || []).forEach((destino, i) => {
        const hex = destino.slice(1, -1);
        let salida = "";
        for (let p = 0; p < hex.length; p += 4) {
          salida += String.fromCharCode(parseInt(hex.slice(p, p + 4), 16));
        }
        mapa.set(desde + i, salida);
      });
    }
  }
  return mapa;
}

/** Las líneas de texto del PDF, en el orden en que se pintaron. */
function lineasDelPdf(pdf) {
  const objetos = objetosDe(pdf);

  const cmaps = new Map(); // /F2 → Map(código → carácter)
  for (const [, obj] of objetos) {
    const i = obj.dic.indexOf("/Font");
    if (i < 0) continue;
    const re = /\/(F\d+)\s+(\d+) 0 R/g;
    let m;
    while ((m = re.exec(obj.dic.slice(i)))) {
      const fuente = objetos.get(Number(m[2]));
      const uni = fuente && /\/ToUnicode\s+(\d+) 0 R/.exec(fuente.dic);
      const cmap = uni && objetos.get(Number(uni[1]));
      cmaps.set(m[1], cmap ? cmapDe(cmap.datos.toString("latin1")) : null);
    }
  }

  const lineas = [];
  for (const [, obj] of objetos) {
    if (!obj.datos) continue;
    const flujo = obj.datos.toString("latin1");
    if (!/\bTf\b/.test(flujo)) continue; // no es un flujo de contenido
    let cmap = null;
    let actual = "";
    for (const trozo of flujo.split(/\r?\n/)) {
      const fuente = /\/(F\d+)\s+[\d.]+\s+Tf/.exec(trozo);
      if (fuente) cmap = cmaps.get(fuente[1]) ?? null;

      if (trozo === "BT") actual = "";
      else if (trozo === "ET") {
        if (actual) lineas.push(actual);
        actual = "";
      } else if (/\bTJ\b|\bTj\b/.test(trozo)) {
        for (const cadena of trozo.match(/<[0-9a-fA-F]*>/g) || []) {
          const hex = cadena.slice(1, -1);
          for (let p = 0; p < hex.length; p += 4) {
            const codigo = parseInt(hex.slice(p, p + 4), 16);
            actual += cmap ? (cmap.get(codigo) ?? "") : String.fromCharCode(codigo);
          }
        }
      }
    }
    if (actual) lineas.push(actual);
  }
  return lineas;
}

/**
 * El texto de los párrafos justificados sale SIN espacios: pdfkit coloca cada
 * palabra en su sitio en vez de escribir el espacio. Para buscar dentro del
 * clausulado se compara todo apelmazado, que es lo único honesto que se puede
 * afirmar de un texto justificado.
 */
const apelmazar = (s) => s.replace(/\s+/g, "");
const cuerpoDelPdf = (pdf) => apelmazar(lineasDelPdf(pdf).join(" "));
const paginasDe = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
const esPdf = (b) => Buffer.isBuffer(b) && b.subarray(0, 5).toString("latin1") === "%PDF-";
const busca = (lineas, re) => lineas.find((l) => re.test(l)) ?? null;

/* ── Piezas de ejemplo ─────────────────────────────────────────────────────
 *
 * PNG de 1×1 de verdad: pdfkit mira los magic bytes, no se cree la cabecera.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const ACEPTADO = "2026-08-04T10:00:00+02:00";

/** Una plantilla como la de tunutrilaura: datos agrupados, contrato + anexos. */
function plantillaCompleta() {
  return {
    key: "paciente",
    title: "Contrato de acompañamiento",
    version: 3,
    footer: "Centro Prueba · CIF B00000000 · Barcelona",
    secondSignatureLabel: "Firma de la menor",
    fields: [
      { key: "nombre", label: "Nombre y apellidos", type: "text", group: "Datos personales" },
      { key: "dni", label: "DNI", type: "dni", group: "Datos personales" },
      { key: "sinRellenar", label: "Alergias", type: "text", group: "Datos personales" },
      { key: "lugarFirma", label: "Localidad", type: "text", group: "Firma" },
      { key: "fechaFirma", label: "Fecha de la firma", type: "date", group: "Firma" },
    ],
    blocks: [
      { id: "contrato", title: "Contrato principal", body: "Cuerpo del contrato." },
      { id: "anexo1", title: "Anexo I", body: "Texto del anexo uno." },
      { id: "anexo2", title: "Anexo II", body: "Texto del anexo dos." },
    ],
  };
}

function firmaCompleta() {
  return {
    signerName: "Paciente De Prueba",
    signerData: {
      nombre: "Paciente De Prueba",
      dni: "12345678Z",
      sinRellenar: "",
      lugarFirma: "Barcelona",
      fechaFirma: "2026-08-04",
      menorNombre: "Lucía Menor",
    },
    acceptances: [
      { id: "contrato", title: "Contrato principal", acceptedAt: ACEPTADO },
      { id: "anexo1", title: "Anexo I", acceptedAt: ACEPTADO },
    ],
    signedAt: ACEPTADO,
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 (Portal)",
    templateVersion: 3,
  };
}

const generar = (extra = {}) =>
  buildContratoFirmadoPdf({
    plantilla: plantillaCompleta(),
    firma: firmaCompleta(),
    imagenFirma: PNG,
    tenantName: "Centro Prueba",
    brand: { primaryColor: "#124A55" },
    ...extra,
  });

/* ═══ El nombre del fichero ════════════════════════════════════════════════ */

describe("contratoPdfFilename: lo que verá quien lo descargue", () => {
  it("junta título, firmante y día con guiones, y termina en .pdf", () => {
    assert.equal(
      contratoPdfFilename("Contrato de acompañamiento", "Paciente De Prueba", ACEPTADO),
      "Contrato de acompañamiento - Paciente De Prueba - 2026-08-04.pdf"
    );
  });

  it("el día sale del instante en UTC, así que es el mismo en cualquier máquina", () => {
    assert.equal(
      contratoPdfFilename("C", "A", new Date("2026-08-04T23:30:00Z")),
      "C - A - 2026-08-04.pdf"
    );
  });

  it("los huecos no dejan guiones sueltos: sin firmante, sin fecha, sin nada", () => {
    assert.equal(contratoPdfFilename("Contrato", "", null), "Contrato.pdf");
    assert.equal(contratoPdfFilename("Contrato", "Ana", null), "Contrato - Ana.pdf");
    assert.equal(contratoPdfFilename(), "Contrato firmado.pdf");
    assert.equal(contratoPdfFilename("   ", null, ""), "Contrato firmado.pdf");
  });

  it("quita los caracteres que Windows no admite en un nombre de fichero", () => {
    // \ / : * ? " < > | fuera. Sí, donde había una barra quedan dos espacios:
    // se prefiere eso a inventarse el nombre que la persona no escribió.
    assert.equal(
      contratoPdfFilename('A/B:C*D?E"F<G>H|I', "Ana / Luz", null),
      "ABCDEFGHI - Ana  Luz.pdf"
    );
  });

  it("un título que era SOLO caracteres prohibidos cae al nombre de fábrica", () => {
    assert.equal(contratoPdfFilename("///", "Ana", null), "Contrato firmado - Ana.pdf");
  });
});

/* ═══ El documento entero ══════════════════════════════════════════════════ */

describe("buildContratoFirmadoPdf: el PDF dice exactamente lo que se le pasó", () => {
  it("un contrato completo sale línea a línea como se espera", async () => {
    const pdf = await generar();
    assert.ok(esPdf(pdf));
    assert.deepEqual(lineasDelPdf(pdf), [
      "Centro Prueba", // la marca del centro, encima del título
      "Contrato de acompañamiento",
      "Centro Prueba · CIF B00000000 · Barcelona", // el pie
      "Datos personales", // grupo
      "NOMBRE Y APELLIDOS",
      "Paciente De Prueba",
      "DNI",
      "12345678Z",
      // «Alergias» no aparece: un campo vacío no imprime ni su etiqueta.
      "Firma", // grupo
      "LOCALIDAD",
      "Barcelona",
      "FECHA DE LA FIRMA",
      "04 de agosto de 2026", // en cristiano, no en ISO
      "Contrato principal",
      "Cuerpo del contrato.",
      "Aceptado el 04/08/2026, 10:00",
      "Anexo I",
      "Texto del anexo uno.",
      "Aceptado el 04/08/2026, 10:00",
      // El Anexo II no se aceptó: no está.
      "FIRMA",
      "Paciente De Prueba",
      "DNI/NIE: 12345678Z",
      "En Barcelona, a 04 de agosto de 2026",
      "CONSTANCIA DE LA FIRMA ELECTRÓNICA",
      "Fecha y hora: 04/08/2026, 10:00",
      "Dirección IP: 203.0.113.7",
      "Navegador: Mozilla/5.0 (Portal)",
      "Documento: Contrato de acompañamiento (versión 3)",
    ]);
  });

  it("sin tenantName sale el rótulo genérico, y sin título el nombre de fábrica", async () => {
    const pdf = await generar({ plantilla: {}, tenantName: "   " });
    const lineas = lineasDelPdf(pdf);
    assert.equal(lineas[0], "Documento firmado");
    assert.equal(lineas[1], "Contrato firmado");
  });

  it("un campo `date` con un valor que no es una fecha se imprime tal cual, no vacío", async () => {
    const plantilla = { title: "T", fields: [{ key: "f", label: "Fecha", type: "date" }] };
    const pdf = await generar({ plantilla, firma: { signerData: { f: "no-es-fecha" } } });
    assert.ok(lineasDelPdf(pdf).includes("no-es-fecha"));
  });

  it("el DNI del recuadro sale del PRIMER campo de tipo dni, se llame como se llame", async () => {
    const plantilla = {
      title: "T",
      fields: [
        { key: "documentoIdentidad", label: "Documento", type: "dni" },
        { key: "otroDni", label: "Otro", type: "dni" },
      ],
    };
    const firma = {
      signerName: "Ana",
      signerData: { documentoIdentidad: "11111111H", otroDni: "22222222J" },
    };
    const lineas = lineasDelPdf(await generar({ plantilla, firma }));
    assert.ok(lineas.includes("DNI/NIE: 11111111H"));
    assert.ok(!lineas.includes("DNI/NIE: 22222222J"));
  });

  it("la localidad vale por `lugarFirma` o por `localidad`, y sin ninguna no se imprime esa línea", async () => {
    const conLocalidad = await generar({
      plantilla: { title: "T" },
      firma: { signerName: "Ana", signerData: { localidad: "Girona" }, signedAt: ACEPTADO },
    });
    assert.ok(lineasDelPdf(conLocalidad).includes("En Girona, a 04 de agosto de 2026"));

    const sinNada = await generar({ plantilla: { title: "T" }, firma: { signerName: "Ana" } });
    assert.equal(busca(lineasDelPdf(sinNada), /^En |^a \d/), null);
  });

  it("sin `fechaFirma` declarada, la fecha del recuadro es la del instante en que se firmó", async () => {
    const pdf = await generar({
      plantilla: { title: "T" },
      firma: {
        signerName: "Ana",
        signerData: { lugarFirma: "Vic" },
        signedAt: "2026-08-04T12:00:00Z",
      },
    });
    assert.ok(lineasDelPdf(pdf).includes("En Vic, a 04 de agosto de 2026"));
  });

  it("con las dos, manda la `fechaFirma` que se declaró, no el instante del servidor", async () => {
    // Las dos fechas del caso completo caen el mismo día, así que ahí no se
    // distingue quién manda. Aquí se separan a propósito: lo que vale es lo que
    // la persona declaró al firmar, que es lo que dice el documento en papel.
    const pdf = await generar({
      plantilla: { title: "T" },
      firma: {
        signerName: "Ana",
        signerData: { lugarFirma: "Vic", fechaFirma: "2026-01-15" },
        signedAt: "2026-08-04T12:00:00Z",
      },
    });
    assert.ok(lineasDelPdf(pdf).includes("En Vic, a 15 de enero de 2026"));
  });
});

/* ═══ Los bloques: se imprime lo aceptado y SOLO lo aceptado ═══════════════ */

describe("el clausulado: entero, y solo el que se aceptó", () => {
  it("un bloque que no está entre las aceptaciones no aparece ni de lejos", async () => {
    const cuerpo = cuerpoDelPdf(await generar());
    assert.ok(cuerpo.includes(apelmazar("Texto del anexo uno")));
    assert.ok(!cuerpo.includes(apelmazar("Anexo II")));
    assert.ok(!cuerpo.includes(apelmazar("Texto del anexo dos")));
  });

  it("se imprime el texto ÍNTEGRO, no un resumen ni la lista de títulos", async () => {
    const parrafo = "Cláusula que se repite para ocupar páginas de verdad. ".repeat(400);
    const pdf = await generar({
      plantilla: {
        title: "Largo",
        footer: "PIE",
        blocks: [{ id: "b", title: "Clausulado", body: parrafo }],
      },
      firma: { signerName: "Ana", acceptances: [{ id: "b", acceptedAt: ACEPTADO }] },
    });
    const cuerpo = cuerpoDelPdf(pdf);
    assert.ok(cuerpo.includes(apelmazar(parrafo.slice(0, 200))));
    // Y el final del clausulado también: no se corta a media página.
    assert.ok(cuerpo.includes(apelmazar(parrafo.slice(-200))));
    assert.ok(paginasDe(pdf) > 3, `un clausulado así no cabe en ${paginasDe(pdf)} páginas`);
  });

  it("un bloque sin cuerpo imprime su título y su aceptación, sin reventar", async () => {
    const pdf = await generar({
      plantilla: { title: "T", blocks: [{ id: "b", title: "Solo título" }] },
      firma: { signerName: "Ana", acceptances: [{ id: "b", acceptedAt: ACEPTADO }] },
    });
    const lineas = lineasDelPdf(pdf);
    assert.ok(lineas.includes("Solo título"));
    assert.ok(lineas.includes("Aceptado el 04/08/2026, 10:00"));
  });

  it("el id de la aceptación se casa como TEXTO: un id numérico encuentra su bloque", async () => {
    // `acceptances` es JSONB: nada garantiza que el id llegue como cadena. El
    // `texto(a?.id)` del Map es lo que hace que un 7 encuentre al bloque "7" y
    // que un id con espacios de más siga casando. Sin él, el bloque aceptado
    // desaparecería del documento sin decir nada.
    for (const id of [7, " contrato ", "contrato"]) {
      const lineas = lineasDelPdf(
        await generar({
          plantilla: { title: "T", blocks: [{ id: "contrato", title: "Bloque" }] },
          firma: { signerName: "Ana", acceptances: [{ id, acceptedAt: ACEPTADO }] },
        })
      );
      const esperado = id !== 7; // el bloque se llama "contrato", no "7"
      assert.equal(lineas.includes("Bloque"), esperado, `con id=${JSON.stringify(id)}`);
    }

    const lineas = lineasDelPdf(
      await generar({
        plantilla: { title: "T", blocks: [{ id: "7", title: "Bloque" }] },
        firma: { signerName: "Ana", acceptances: [{ id: 7, acceptedAt: ACEPTADO }] },
      })
    );
    assert.ok(lineas.includes("Bloque"), "un id numérico 7 tiene que casar con el bloque «7»");
  });

  it("una hora de aceptación ilegible se queda a medias, no imprime «Invalid Date»", async () => {
    // Lo que salva esto es el `Number.isNaN` de `fmtFechaHora`. Sin él, un
    // `acceptedAt` corrupto en el JSONB imprimiría «Aceptado el Invalid Date»
    // en un documento firmado.
    for (const acceptedAt of ["no-es-fecha", "2026-13-45", 0, {}]) {
      const lineas = lineasDelPdf(
        await generar({
          plantilla: { title: "T", blocks: [{ id: "b", title: "Bloque" }] },
          firma: { signerName: "Ana", acceptances: [{ id: "b", acceptedAt }] },
        })
      );
      assert.ok(lineas.includes("Aceptado el "), `con acceptedAt=${JSON.stringify(acceptedAt)}`);
      assert.equal(busca(lineas, /Invalid Date/), null);
    }
  });

  it("aceptaciones que no son una lista, o con un hueco dentro, no imprimen ningún bloque", async () => {
    const plantilla = { title: "T", blocks: [{ id: "b", title: "Bloque" }] };
    for (const acceptances of ["todas", null, [null], [{ id: "otro" }], undefined]) {
      const lineas = lineasDelPdf(
        await generar({ plantilla, firma: { signerName: "Ana", acceptances } })
      );
      assert.ok(
        !lineas.includes("Bloque"),
        `con acceptances=${JSON.stringify(acceptances)} coló un bloque`
      );
    }
  });
});

/* ═══ El recuadro de la firma ══════════════════════════════════════════════ */

describe("el recuadro de la firma: el garabato es lo de menos", () => {
  it("sin dibujo se explica POR QUÉ; con dibujo, ese párrafo no sale", async () => {
    const sinDibujo = cuerpoDelPdf(await generar({ imagenFirma: null }));
    assert.ok(
      sinDibujo.includes(
        apelmazar("Persona menor de edad: acepta el documento sin firma manuscrita")
      )
    );
    assert.ok(sinDibujo.includes(apelmazar("madre, padre o tutor legal")));

    const conDibujo = cuerpoDelPdf(await generar());
    assert.ok(!conDibujo.includes(apelmazar("Persona menor de edad")));
  });

  it("un PNG corrupto deja el hueco pero NO tumba el documento", async () => {
    const pdf = await generar({ imagenFirma: Buffer.from("esto no es un PNG ni de lejos") });
    assert.ok(esPdf(pdf));
    const lineas = lineasDelPdf(pdf);
    assert.ok(lineas.includes("Paciente De Prueba"));
    assert.ok(lineas.includes("CONSTANCIA DE LA FIRMA ELECTRÓNICA"));
  });

  it("sin nombre de firmante queda la raya con un guion, no una línea en blanco", async () => {
    for (const signerName of ["", "   ", null, undefined]) {
      const lineas = lineasDelPdf(
        await generar({ plantilla: { title: "T" }, firma: { signerName } })
      );
      assert.ok(
        lineas.includes("—"),
        `con signerName=${JSON.stringify(signerName)} no salió el guion`
      );
    }
  });

  it("la segunda firma exige las DOS cosas: imagen y etiqueta en la plantilla", async () => {
    const conLabel = { title: "T", secondSignatureLabel: "Firma de la menor" };
    const datos = { signerName: "Ana", signerData: { menorNombre: "Lucía Menor" } };

    const completa = lineasDelPdf(
      await generar({ plantilla: conLabel, firma: datos, imagenSegunda: PNG })
    );
    assert.ok(completa.includes("FIRMA DE LA MENOR"));
    assert.ok(completa.includes("Lucía Menor"));

    const sinImagen = lineasDelPdf(
      await generar({ plantilla: conLabel, firma: datos, imagenSegunda: null })
    );
    assert.ok(!sinImagen.includes("FIRMA DE LA MENOR"));

    const sinLabel = lineasDelPdf(
      await generar({ plantilla: { title: "T" }, firma: datos, imagenSegunda: PNG })
    );
    assert.ok(!sinLabel.includes("FIRMA DE LA MENOR"));
  });
});

/* ═══ La constancia ════════════════════════════════════════════════════════ */

describe("la constancia de la firma electrónica: la traza va IMPRESA", () => {
  it("los cuatro datos salen con su etiqueta y su valor", async () => {
    const lineas = lineasDelPdf(await generar());
    assert.ok(lineas.includes("Fecha y hora: 04/08/2026, 10:00"));
    assert.ok(lineas.includes("Dirección IP: 203.0.113.7"));
    assert.ok(lineas.includes("Navegador: Mozilla/5.0 (Portal)"));
    assert.ok(lineas.includes("Documento: Contrato de acompañamiento (versión 3)"));
  });

  it("la fecha y hora va clavada a Europe/Madrid: no depende de la máquina", async () => {
    // Un instante en UTC que en Madrid cae al día siguiente.
    const pdf = await generar({
      plantilla: { title: "T" },
      firma: { signerName: "Ana", signedAt: "2026-08-04T23:30:00Z" },
    });
    assert.ok(lineasDelPdf(pdf).includes("Fecha y hora: 05/08/2026, 01:30"));
  });

  it("sin IP ni navegador lo DICE, en vez de dejar la línea muda", async () => {
    const lineas = lineasDelPdf(
      await generar({ plantilla: { title: "T" }, firma: { signerName: "Ana" } })
    );
    assert.ok(lineas.includes("Dirección IP: no registrada"));
    assert.ok(lineas.includes("Navegador: no registrado"));
  });

  it("sin instante de firma, la línea de fecha y hora se salta entera", async () => {
    const lineas = lineasDelPdf(
      await generar({ plantilla: { title: "T" }, firma: { signerName: "Ana", signedAt: null } })
    );
    assert.equal(busca(lineas, /^Fecha y hora/), null);
    assert.ok(lineas.includes("CONSTANCIA DE LA FIRMA ELECTRÓNICA")); // el bloque sigue ahí
  });

  it("un instante ILEGIBLE se salta igual: nunca «Fecha y hora: Invalid Date»", async () => {
    // Mismo camino que el `null` de arriba, pero por el otro lado: aquí la
    // fecha existe y no se puede leer. Es la diferencia entre una constancia
    // que calla un dato y una que imprime basura en un documento probatorio.
    // `true` no entra en la lista: `new Date(true)` es el 01/01/1970 y sí es
    // una fecha legible, aunque no tenga ningún sentido. No es este caso.
    for (const signedAt of ["no-es-fecha", "2026-13-45", {}, [], 0]) {
      const lineas = lineasDelPdf(
        await generar({ plantilla: { title: "T" }, firma: { signerName: "Ana", signedAt } })
      );
      assert.equal(
        busca(lineas, /^Fecha y hora/),
        null,
        `con signedAt=${JSON.stringify(signedAt)} salió una línea de fecha`
      );
      assert.equal(busca(lineas, /Invalid Date/), null);
      assert.ok(lineas.includes("CONSTANCIA DE LA FIRMA ELECTRÓNICA"));
    }
  });

  it("la versión manda la de la firma sobre la de la plantilla; sin versión, solo el nombre", async () => {
    const conFirma = lineasDelPdf(
      await generar({
        plantilla: { title: "T", version: 3 },
        firma: { signerName: "Ana", templateVersion: 9 },
      })
    );
    assert.ok(conFirma.includes("Documento: T (versión 9)"));

    const dePlantilla = lineasDelPdf(
      await generar({ plantilla: { title: "T", version: 3 }, firma: { signerName: "Ana" } })
    );
    assert.ok(dePlantilla.includes("Documento: T (versión 3)"));

    const sinVersion = lineasDelPdf(
      await generar({ plantilla: { title: "T" }, firma: { signerName: "Ana" } })
    );
    assert.ok(sinVersion.includes("Documento: T"));
  });
});

/* ═══ El pie ═══════════════════════════════════════════════════════════════ */

describe("el pie del centro: en todas las páginas y ni una vez de más", () => {
  it("un documento de varias páginas lleva exactamente un pie por página", async () => {
    const parrafo = "Cláusula larga que ocupa sitio y obliga a saltar de página. ".repeat(400);
    const pdf = await generar({
      plantilla: {
        title: "Largo",
        footer: "PIE-DEL-CENTRO",
        blocks: [{ id: "b", title: "C", body: parrafo }],
      },
      firma: { signerName: "Ana", acceptances: [{ id: "b", acceptedAt: ACEPTADO }] },
    });
    const paginas = paginasDe(pdf);
    assert.ok(paginas > 1, "esta prueba necesita más de una página");
    assert.equal(lineasDelPdf(pdf).filter((l) => l === "PIE-DEL-CENTRO").length, paginas);
  });

  it("un pie de varios renglones NO deja a la familia sin su copia", async () => {
    // De un fallo real, medido el 21/08/2026 con el generador de verdad: un pie
    // de OCHO líneas cortas —quince caracteres en total— acababa en
    // `RangeError: Maximum call stack size exceeded` y sin PDF ninguno. El pie
    // se pinta a mano por debajo del margen, y lo que no cabía en esa franja
    // saltaba de página; el salto volvía a pintar el pie, y así hasta agotar la
    // pila. `footer` es VARCHAR(300), o sea que un pie de cuatro renglones
    // —nombre, calle, CIF, teléfono— entra de sobra: no hacía falta nada raro.
    //
    // Y lo que lo hacía grave es dónde se nota: el archivado del contrato se
    // llama con `.catch(() => null)`, así que la familia firmaba, la firma se
    // guardaba, y se quedaba sin su copia sin que saltara nada.
    //
    // ⚠️ Si alguien deshace el arreglo, esta prueba no se pone roja: se lleva
    // por delante al runner entero con un abort nativo (la pila se agota dentro
    // del zlib de pdfkit). Que `npm test` muera de golpe ES la señal.
    const pies = {
      "cuatro renglones": "Centro de Prueba\nCalle Falsa 1, 08500 Vic\nCIF B12345678\nTel 900 000 000",
      "ocho renglones cortos": "a\nb\nc\nd\ne\nf\ng\nh",
      "veinte renglones": Array.from({ length: 20 }, (_, i) => `renglón ${i}`).join("\n"),
      "una línea larguísima": "z".repeat(5000),
      "los 300 caracteres que caben en la columna": "y".repeat(300),
    };
    for (const [que, footer] of Object.entries(pies)) {
      const pdf = await generar({ plantilla: { title: "T", footer } });
      assert.ok(esPdf(pdf), `con un pie de ${que} no salió PDF`);
    }
  });

  it("el pie que no cabe se RECORTA, y el documento sigue saliendo entero", async () => {
    // Recortar es la mitad buena del arreglo: un pie cortado se ve y se
    // corrige; un contrato que no existe, no. Lo que NO puede pasar es que el
    // recorte se lleve por delante el resto del documento.
    const pdf = await generar({
      plantilla: {
        title: "T",
        footer: "PRIMER-RENGLON\n" + Array.from({ length: 30 }, (_, i) => `sobra-${i}`).join("\n"),
        blocks: [{ id: "b", title: "C", body: "Cláusula que se tiene que leer entera." }],
      },
      firma: { signerName: "Ana", acceptances: [{ id: "b", acceptedAt: ACEPTADO }] },
    });
    const cuerpo = cuerpoDelPdf(pdf);
    assert.ok(cuerpo.includes(apelmazar("Cláusula que se tiene que leer entera.")), "se perdió el clausulado");
    assert.ok(cuerpo.includes("PRIMER-RENGLON"), "se perdió el primer renglón del pie");
    // Los últimos renglones sí se pierden: eso es el recorte, y es lo aceptado.
    assert.ok(!cuerpo.includes("sobra-29"), "no se recortó: cabían los treinta renglones");
  });

  it("sin pie declarado (o con un pie en blanco) no se pinta nada", async () => {
    for (const footer of [undefined, null, "", "   "]) {
      const lineas = lineasDelPdf(await generar({ plantilla: { title: "T", footer } }));
      assert.equal(lineas[0], "Centro Prueba");
      assert.equal(lineas[1], "T");
      assert.equal(lineas[2], "FIRMA", `con footer=${JSON.stringify(footer)} se coló un pie`);
    }
  });
});

/* ═══ Bordes ═══════════════════════════════════════════════════════════════ */

describe("bordes: nada de lo que llega del portal deja a nadie sin su copia", () => {
  it("sin argumentos, con la plantilla vacía o con la firma vacía sigue saliendo un PDF", async () => {
    for (const args of [{}, { plantilla: {}, firma: {} }, { plantilla: null, firma: null }]) {
      const pdf = await buildContratoFirmadoPdf(args);
      assert.ok(esPdf(pdf));
      assert.ok(lineasDelPdf(pdf).includes("CONSTANCIA DE LA FIRMA ELECTRÓNICA"));
    }
  });

  it("`signerData` que no es un objeto se trata como si no hubiera datos", async () => {
    // Se comparan las líneas ENTERAS y no solo que falte el DNI: con «no está
    // este valor» pasaría igual un documento que imprimiera otros datos
    // inventados, que es justo lo que hay que impedir en una copia firmada.
    const limpio = [
      "Centro Prueba",
      "Contrato de acompañamiento",
      "FIRMA",
      "—", // sin firmante, porque tampoco se le pasa nombre
      "CONSTANCIA DE LA FIRMA ELECTRÓNICA",
      "Dirección IP: no registrada",
      "Navegador: no registrado",
    ];
    // Los campos se llaman `length` y `0` a mala idea: son las propiedades que
    // SÍ tienen una cadena y un número. Si la guarda de `signerData` se cayera,
    // el documento imprimiría «LARGO: 7» como si fuera un dato declarado.
    const plantilla = {
      title: "Contrato de acompañamiento",
      fields: [
        { key: "length", label: "Largo", type: "text" },
        { key: "0", label: "Cero", type: "text" },
      ],
    };
    for (const signerData of ["pues no", 42, null, undefined, true]) {
      const pdf = await generar({ plantilla, firma: { signerData }, imagenFirma: PNG });
      assert.ok(esPdf(pdf));
      assert.deepEqual(
        lineasDelPdf(pdf).filter((l) => !l.startsWith("Documento:")),
        limpio,
        `con signerData=${JSON.stringify(signerData)} se coló algo`
      );
    }
  });

  it("SOSPECHOSO: un `signerData` que es una LISTA sí cuela `length` como dato", async () => {
    // `typeof [] === "object"`, así que la guarda de `buildContratoFirmadoPdf`
    // deja pasar las listas. Con una plantilla cuyos campos se llamen `length`
    // o `0` —raro, pero nada lo impide— el documento firmado imprime el tamaño
    // de la lista como si fuera un dato declarado por la persona. Hoy no muerde
    // porque `validarDatos` siempre devuelve un objeto plano y es lo único que
    // se guarda en `signerData`. Se fija como está.
    const lineas = lineasDelPdf(
      await generar({
        plantilla: {
          title: "T",
          fields: [
            { key: "length", label: "Largo", type: "text" },
            { key: "0", label: "Cero", type: "text" },
          ],
        },
        firma: { signerName: "Ana", signerData: ["a", "b"] },
      })
    );
    assert.ok(lineas.includes("LARGO"));
    assert.ok(lineas.includes("2")); // el tamaño de la lista, impreso como dato
    assert.ok(lineas.includes("CERO"));
    assert.ok(lineas.includes("a"));
  });

  it("un nombre con `<script>`, `&` o comillas viaja tal cual: en un PDF no hay HTML que escapar", async () => {
    const nombre = 'Ana <script>alert("x")</script> & Cía.';
    const lineas = lineasDelPdf(
      await generar({ plantilla: { title: "T" }, firma: { signerName: nombre } })
    );
    assert.ok(lineas.includes(nombre));
  });

  it("un emoji (glifo que la fuente no tiene) no revienta la generación", async () => {
    const pdf = await generar({ plantilla: { title: "T" }, firma: { signerName: "Ana 🙂 Ruiz" } });
    assert.ok(esPdf(pdf));
    // El emoji se cae (Poppins no lo tiene); el nombre de la persona no.
    const cuerpo = cuerpoDelPdf(pdf);
    assert.ok(cuerpo.includes("Ana"));
    assert.ok(cuerpo.includes("Ruiz"));
  });

  it("un pie o un título que no son texto (un número) no lo tumban", async () => {
    const pdf = await generar({ plantilla: { title: 2026, footer: 12345 } });
    assert.ok(esPdf(pdf));
    const lineas = lineasDelPdf(pdf);
    assert.ok(lineas.includes("2026"));
    assert.ok(lineas.includes("12345"));
  });

  it("una plantilla con `fields`/`blocks` que no son listas no imprime datos ni clausulado", async () => {
    const pdf = await generar({ plantilla: { title: "T", fields: "muchos", blocks: { uno: 1 } } });
    assert.ok(esPdf(pdf));
    assert.deepEqual(lineasDelPdf(pdf).slice(0, 3), ["Centro Prueba", "T", "FIRMA"]);
  });
});

/* ═══ Lo que hoy queda fijado tal como está ════════════════════════════════ */

describe("cosas que se fijan como están, no como deberían ser", () => {
  it("la fecha del recuadro de firma SÍ depende de la zona de la máquina", async () => {
    // SOSPECHOSO: `fmtFechaHora` clava `timeZone: "Europe/Madrid"` y `fmtFecha`,
    // en el mismo fichero, no clava nada. Con un instante de las 23:30 UTC la
    // constancia dice SIEMPRE 05/08/2026, pero la línea «En Barcelona, a …»
    // dice 04 de agosto con TZ=UTC y 05 de agosto en Madrid. Hoy no muerde
    // porque producción corre en Europe/Madrid desde el 19/08/2026, pero es un
    // documento firmado donde dos fechas del mismo acto pueden no coincidir.
    // Lo mismo le pasa a los campos de tipo `date`: 'AAAA-MM-DD' es un día de
    // calendario y se lee como un instante UTC, así que al oeste de Greenwich
    // se imprime el día anterior.
    const pdf = await generar({
      plantilla: { title: "T" },
      firma: {
        signerName: "Ana",
        signerData: { lugarFirma: "Barcelona" },
        signedAt: "2026-08-04T23:30:00Z",
      },
    });
    const lineas = lineasDelPdf(pdf);
    assert.ok(lineas.includes("Fecha y hora: 05/08/2026, 01:30")); // clavada
    assert.match(busca(lineas, /^En Barcelona/), /^En Barcelona, a 0[45] de agosto de 2026$/); // a la deriva
  });

  it("una aceptación sin `acceptedAt` imprime «Aceptado el » y se queda a medias", async () => {
    // SOSPECHOSO: el ternario de `seccionBloque` mira si HAY aceptación, no si
    // tiene hora, así que la rama «Aceptado al firmar este documento» está
    // muerta y en su lugar sale la frase cortada. Hoy no muerde porque
    // `validarAceptaciones` siempre pone `acceptedAt`, y el único camino que
    // llega aquí pasa por ella.
    const lineas = lineasDelPdf(
      await generar({
        plantilla: { title: "T", blocks: [{ id: "b", title: "Bloque" }] },
        firma: { signerName: "Ana", acceptances: [{ id: "b" }] },
      })
    );
    assert.ok(lineas.includes("Aceptado el "));
    assert.ok(!lineas.includes("Aceptado al firmar este documento"));
  });

  it("sin título, la cabecera y la constancia llaman al documento de forma distinta", async () => {
    // SOSPECHOSO: la cabecera cae a «Contrato firmado» y la traza cae a la
    // CLAVE de la plantilla. Con título —que es lo que hay hoy en las tres
    // plantillas cargadas— las dos dicen lo mismo, así que no se nota.
    const lineas = lineasDelPdf(
      await generar({ plantilla: { key: "parental", version: 7 }, firma: { signerName: "Ana" } })
    );
    assert.equal(lineas[1], "Contrato firmado");
    assert.ok(lineas.includes("Documento: parental (versión 7)"));
  });

  it("una versión 0 desaparece del nombre del documento", async () => {
    // SOSPECHOSO: `version ? … : …` trata el 0 como «no hay versión». Ninguna
    // plantilla empieza en 0 (`serializarPlantilla` reparte `version ?? 1`),
    // pero si alguna llegara, la constancia no diría de qué versión se firmó.
    const lineas = lineasDelPdf(
      await generar({
        plantilla: { title: "T", version: 0 },
        firma: { signerName: "Ana", templateVersion: 0 },
      })
    );
    assert.ok(lineas.includes("Documento: T"));
    assert.ok(!busca(lineas, /versión/));
  });

  /**
   * ⚠️ EL PIE QUE NO CABE — el hallazgo gordo, y AQUÍ NO SE PUEDE PROBAR.
   *
   * El truco del margen a cero de `pintarPie` protege del bucle mientras el pie
   * quepa en los 42 puntos que quedan por debajo del margen. En cuanto NO cabe
   * —CUATRO líneas cortas, o UNA sola de 334 caracteres— pasa exactamente lo
   * que el comentario de `pintarPie` dice que evita: el pie desborda, dispara
   * un salto de página, el salto dispara otro pie, y la promesa acaba en
   * `RangeError: Maximum call stack size exceeded` sin PDF ninguno. Tres líneas
   * y 333 caracteres son el último escalón que sí sale (medido, 21/08/2026).
   *
   * NO se escribe el `assert.rejects` correspondiente a propósito: bajo
   * `node --test` la pila se agota DENTRO de la inicialización del zlib de
   * pdfkit y Node se va con un abort nativo
   * («node_zlib.cc:402 Assertion failed: init_done_ && "close before init"»,
   * exit 134) que se lleva por delante al runner entero y con él a todas las
   * demás pruebas del fichero. Una prueba que puede tumbar `npm test` hace más
   * daño que el fallo que vigila. Queda escrito aquí y en el Registro.
   *
   * Hoy no muerde: `footer` es `VARCHAR(300)` —una sola línea no llega a 334— y
   * el único pie sembrado es el de tunutrilaura, de 77 caracteres en una línea
   * (`scripts/seed-contrato-tunutrilaura.js`). Pero un pie de cuatro líneas
   * (nombre, calle, CIF, teléfono) cabe de sobra en 300 caracteres.
   */

  it("un `secondSignatureLabel` que no es texto tumba la generación", async () => {
    // SOSPECHOSO: `recuadroFirma` hace `etiqueta.toUpperCase()` a pelo, sin
    // pasar por el `texto()` que sí protege al título y al pie. Es la misma
    // familia que el `it` de «un pie o un título que no son texto no lo
    // tumban», pero aquí sí tumba. La columna es `VARCHAR(200)`, así que hoy
    // solo llegaría un número por un JSON escrito a mano.
    await assert.rejects(
      () =>
        generar({
          plantilla: { title: "T", secondSignatureLabel: 99 },
          imagenSegunda: PNG,
        }),
      TypeError
    );
  });

  it("`contratoPdfFilename` REVIENTA si le dan una fecha ilegible", async () => {
    // SOSPECHOSO: `fmtFecha`, tres funciones más arriba en el mismo fichero,
    // comprueba `Number.isNaN(dt.getTime())` antes de formatear; aquí se llama
    // a `toISOString()` a pelo y una fecha inválida lanza RangeError. Hoy no
    // muerde: el único que llama pasa `firma.signedAt`, que es una columna
    // DATE recién creada, y además envuelve la llamada en un `.catch(() =>
    // null)`. Se fija el comportamiento actual; el día que alguien lo llame
    // con lo que venga del navegador, esta prueba dice dónde mirar.
    assert.throws(() => contratoPdfFilename("C", "A", "no-es-fecha"), RangeError);
  });
});
