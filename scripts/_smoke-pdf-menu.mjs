// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-pdf-menu.mjs — el PDF de la pauta semanal de Nutrición (21/08/2026).
 *
 *   node scripts/_smoke-pdf-menu.mjs
 *   node --test-name-pattern="portada" scripts/_smoke-pdf-menu.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/nutricion/menuPdf.js` son 900 líneas sin una sola prueba, y es la ÚNICA
 * vista que recibe la paciente: no hay portal, el menú se manda por correo como
 * adjunto. Si sale torcido no lo ve nadie del centro hasta que lo dice ella.
 *
 * Escribirla encontró el fallo que se arregló el mismo día: `switchToPortrait`
 * MUTA `doc.options`, y pdfkit se queda con la referencia del objeto que se le
 * pasa al construir. Como ese objeto era la constante `LANDSCAPE` del módulo,
 * el primer menú semanal del proceso dejaba la constante puesta en vertical y
 * **todos los siguientes salían con la portada-calendario en A4 vertical**. En
 * un servidor que vive semanas eso son todos menos el primero. Lo fija la
 * prueba «la portada apaisada sigue apaisada en el segundo PDF del proceso»,
 * que genera DOS y mira los dos.
 *
 * ── POR QUÉ HAY UN LECTOR DE PDF AQUÍ DENTRO ───────────────────────────────
 *
 * Comprobar que «pesa más de 20 KB» no dice si el nombre de la paciente salió,
 * si los gramos que se imprimen son los que se pasaron o si la portada es
 * apaisada. El proyecto no tiene (ni va a añadir) una librería para leer PDF,
 * así que `abrirPdf` hace lo justo con `node:zlib`: recorre los objetos,
 * descomprime los flujos, ordena las páginas por `/Kids`, saca su `/MediaBox`
 * —de ahí sale «apaisada»— y decodifica el texto.
 *
 * El texto no se puede buscar a pelo: con Poppins embebida (una subfuente TTF)
 * cada letra viaja como su número de glifo. Se traduce con el `/ToUnicode` que
 * el propio PDF lleva para que se pueda copiar y pegar. Si los .ttf no están
 * en disco, `registerPoppins` cae a Helvetica y el texto viaja byte a byte en
 * WinAnsi; el lector entiende los dos, así que la prueba dice lo mismo se
 * ejecute desde donde se ejecute.
 *
 * Lo que se comprueba es lo que SALE en el papel: qué páginas hay y cómo son,
 * qué frases llevan y en qué página, y que las cifras impresas son las que se
 * le pasaron. Nada de mirar el código fuente.
 *
 * FECHAS: el pie «Asignado: …» se formatea en español. Los instantes van con
 * offset explícito (+02:00) para que la prueba pase igual con `TZ=UTC`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { buildMenuPdfBuffer, menuPdfFilename } from "../lib/nutricion/menuPdf.js";

/* ═══ Lector de PDF ════════════════════════════════════════════════════════ */

/**
 * Abre el buffer y devuelve { paginas, texto }. Cada página trae ancho, alto,
 * `apaisada`, el texto ya legible y `crudo` (los operadores de dibujo, para
 * comprobar cosas que no son texto, como el color de marca).
 */
function abrirPdf(buffer) {
  const s = buffer.toString("latin1");
  const objetos = new Map();
  const cabecera = /(\d+)\s+0\s+obj/g;
  let pos = 0;
  for (;;) {
    cabecera.lastIndex = pos;
    const m = cabecera.exec(s);
    if (!m) break;
    const cur = m.index + m[0].length;
    const iFlujo = s.indexOf("stream", cur);
    const iFin = s.indexOf("endobj", cur);
    let dicc;
    let datos = null;
    if (iFlujo !== -1 && (iFin === -1 || iFlujo < iFin)) {
      // Objeto con flujo: se salta EXACTAMENTE su /Length, para que los bytes
      // binarios de las fuentes no se confundan con cabeceras de objeto.
      dicc = s.slice(cur, iFlujo);
      const largo = Number(/\/Length\s+(\d+)/.exec(dicc)?.[1] ?? 0);
      let ini = iFlujo + "stream".length;
      if (s[ini] === "\r") ini += 1;
      if (s[ini] === "\n") ini += 1;
      datos = buffer.subarray(ini, ini + largo);
      if (/\/Filter\s*\/FlateDecode/.test(dicc)) {
        try {
          datos = zlib.inflateSync(datos);
        } catch {
          /* si no descomprime, se queda cruda */
        }
      }
      pos = ini + largo;
    } else {
      dicc = s.slice(cur, iFin === -1 ? undefined : iFin);
      pos = iFin === -1 ? s.length : iFin + "endobj".length;
    }
    objetos.set(Number(m[1]), { dicc, datos });
  }

  const referencia = (texto, clave) => {
    const m = new RegExp(`/${clave}\\s+(\\d+)\\s+0\\s+R`).exec(texto || "");
    return m ? objetos.get(Number(m[1])) : null;
  };

  const raiz = [...objetos.values()].find((o) => /\/Type\s*\/Pages\b/.test(o.dicc));
  const orden = raiz
    ? [...raiz.dicc.matchAll(/(\d+)\s+0\s+R/g)].map((k) => objetos.get(Number(k[1])))
    : [];

  const paginas = orden
    .filter((o) => o && /\/Type\s*\/Page\b/.test(o.dicc))
    .map((o) => {
      const caja = /\/MediaBox\s*\[([^\]]+)\]/.exec(o.dicc);
      const medidas = caja ? caja[1].trim().split(/\s+/).map(Number) : [0, 0, 0, 0];
      const recursos = referencia(o.dicc, "Resources")?.dicc || "";
      const fuentes = new Map();
      const bloque = /\/Font\s*<<([\s\S]*?)>>/.exec(recursos);
      for (const f of bloque ? bloque[1].matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g) : []) {
        const fuente = objetos.get(Number(f[2]));
        const unicode = fuente ? referencia(fuente.dicc, "ToUnicode") : null;
        fuentes.set(f[1], unicode ? mapaUnicode(unicode.datos.toString("latin1")) : null);
      }
      const crudo = referencia(o.dicc, "Contents")?.datos?.toString("latin1") || "";
      return {
        ancho: medidas[2],
        alto: medidas[3],
        apaisada: medidas[2] > medidas[3],
        crudo,
        texto: textoDe(crudo, fuentes),
      };
    });

  return { paginas, texto: paginas.map((p) => p.texto).join("\n") };
}

/** Glifos de dos bytes (fuente embebida) traducidos por el /ToUnicode. */
function glifos(hex) {
  let out = "";
  for (let i = 0; i + 3 < hex.length; i += 4)
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
}

// Los ocho huecos en que WinAnsi no coincide con latin1 y que este documento
// usa de verdad (el guion largo del apunte, el punto de las viñetas…).
const WINANSI = {
  0x85: "…",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
};

/** Bytes sueltos (Helvetica, el plan B cuando faltan los .ttf de Poppins). */
function bytesSueltos(hex) {
  let out = "";
  for (const b of Buffer.from(hex, "hex")) out += WINANSI[b] ?? String.fromCharCode(b);
  return out;
}

/** El /ToUnicode del PDF: número de glifo → letra. */
function mapaUnicode(texto) {
  const mapa = new Map();
  for (const b of texto.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const p of b.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      mapa.set(parseInt(p[1], 16), glifos(p[2]));
    }
  }
  for (const b of texto.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const p of b.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g
    )) {
      const desde = parseInt(p[1], 16);
      if (p[3].startsWith("[")) {
        [...p[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((x, i) =>
          mapa.set(desde + i, glifos(x[1]))
        );
      } else {
        const base = parseInt(p[3].slice(1, -1), 16);
        for (let c = desde; c <= parseInt(p[2], 16); c++)
          mapa.set(c, String.fromCharCode(base + (c - desde)));
      }
    }
  }
  return mapa;
}

// `/Fn tam Tf` (elige fuente) y los tres modos de pintar texto de pdfkit.
const OPERADORES = new RegExp(
  [
    "/([A-Za-z0-9]+)\\s+[\\d.]+\\s+Tf",
    "\\[((?:[^\\]\\\\]|\\\\.)*)\\]\\s*TJ",
    "(\\((?:[^)\\\\]|\\\\.)*\\))\\s*Tj",
    "(<[0-9A-Fa-f\\s]*>)\\s*Tj",
  ].join("|"),
  "g"
);

/** Una línea de texto por operación de pintado, en el orden en que se pintan. */
function textoDe(contenido, fuentes) {
  const lineas = [];
  let mapa = null;
  let m;
  OPERADORES.lastIndex = 0;
  while ((m = OPERADORES.exec(contenido))) {
    if (m[1] !== undefined) {
      mapa = fuentes.get(m[1]) ?? null;
      continue;
    }
    let linea = "";
    for (const t of (m[2] ?? m[3] ?? m[4]).matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:[^)\\]|\\.)*)\)/g)) {
      if (t[1] !== undefined) {
        const hex = t[1].replace(/\s/g, "");
        linea += mapa
          ? [...hex.matchAll(/.{4}/g)].map((h) => mapa.get(parseInt(h[0], 16)) ?? "").join("")
          : bytesSueltos(hex);
      } else {
        linea += t[2].replace(/\\([()\\])/g, "$1");
      }
    }
    if (linea) lineas.push(linea);
  }
  return lineas.join("\n");
}

/** El color que pdfkit escribe en el flujo para un #RRGGBB. */
function colorPdf(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).join(" ");
}

/* ═══ Piezas de ejemplo ════════════════════════════════════════════════════ */

const AVENA = { name: "Avena", proteinPer100: 10, carbsPer100: 60, fatPer100: 7, fiberPer100: 10 };

/** Alimento suelto en gramos. */
const gramos = (food, amount, extra = {}) => ({ unit: "g", amount, food, ...extra });

/** Una comida de un día con una sola opción por defecto. */
const comida = (name, weekday, { foods = [], recipes = [], order = 0, ...extra } = {}) => ({
  name,
  weekday,
  order,
  options: [{ name: "Opción 1", isDefault: true, foods, recipes }],
  ...extra,
});

/**
 * La pauta de referencia: dos días, un alimento suelto, una receta escalada a
 * dos raciones, comentarios de plan/día/comida y macros encendidas.
 *
 * Macros que DEBE imprimir el lunes (esto es la cuenta a mano):
 *   proteína = 150 g × 10/100  +  (50 g × 10/100) × 2 raciones = 15 + 10 = 25
 *   hidratos = 150 g × 60/100                                  = 90
 *   grasa    = 150 g ×  7/100                                  = 10,5
 *   fibra    = 150 g × 10/100                                  = 15
 * Y en el recetario, la receta va SIN escalar: 50 g × 10/100 = 5.
 */
function planSemanal(extra = {}) {
  return {
    name: "Semana de mayo",
    description: "Bebe dos litros de agua al día.",
    assignedAt: "2026-08-04T10:00:00+02:00",
    showMacros: true,
    dayComments: { 1: "El lunes cenamos pronto." },
    meals: [
      comida("Desayuno", 1, {
        description: "Sin prisa.",
        foods: [gramos(AVENA, 150)],
        recipes: [
          {
            recipeId: "r-porridge",
            nameSnapshot: "Porridge de avena",
            servings: 2,
            steps: ["Calentar la leche.", "Añadir la avena y remover."],
            ingredients: [gramos({ name: "Avena", proteinPer100: 10 }, 50)],
          },
        ],
      }),
      comida("Cena", 2, {
        foods: [
          {
            unit: "household",
            amount: 2,
            householdLabel: "taza(s)",
            householdGrams: 30,
            food: { name: "Arroz" },
          },
        ],
      }),
    ],
    ...extra,
  };
}

/** Genera el PDF y lo abre. `datos` sustituye lo que haga falta del envío. */
async function pdfDe(plan, datos = {}) {
  const buffer = await buildMenuPdfBuffer({
    plan,
    client: { name: "Ana López" },
    tenantName: "Nutri Laura",
    brand: { primaryColor: "#124A55" },
    tenantSlug: null,
    ...datos,
  });
  return { buffer, ...abrirPdf(buffer) };
}

const forma = (pdf) => pdf.paginas.map((p) => (p.apaisada ? "H" : "V")).join("");

/**
 * El margen izquierdo REAL de una página: la x más pequeña a la que se pinta
 * texto. La portada apaisada trabaja con 38 y las verticales con 46, así que
 * esto es lo único que distingue «switchToPortrait dejó los márgenes bien» de
 * «se quedaron los del apaisado» — el tamaño de la hoja no lo dice.
 */
const margenIzquierdo = (pagina) =>
  Math.min(...[...pagina.crudo.matchAll(/1 0 0 1 ([\d.]+) [\d.]+ Tm/g)].map((m) => Number(m[1])));

/**
 * El texto sin los saltos del ajuste de línea, para buscar frases largas: dónde
 * parte pdfkit un párrafo depende de la tipografía, y eso no es lo que se está
 * probando. Para lo que SÍ importa que vaya en su propia línea (las viñetas,
 * los ordinales de los pasos) se busca en el texto tal cual.
 */
const seguido = (texto) => texto.replace(/\s+/g, " ");

/* ═══ menuPdfFilename ══════════════════════════════════════════════════════ */

describe("menuPdfFilename: el nombre con el que le llega el adjunto a la paciente", () => {
  it("manda el nombre de la paciente sobre el del menú", () => {
    assert.equal(
      menuPdfFilename({ name: "Semana de mayo" }, { name: "Ana López" }),
      "pauta-ana-lopez.pdf"
    );
  });

  it("sin paciente (una plantilla) usa el nombre del menú; sin ninguno de los dos, «pauta»", () => {
    assert.equal(menuPdfFilename({ name: "Semana de mayo" }, null), "pauta-semana-de-mayo.pdf");
    assert.equal(menuPdfFilename({ name: "Semana" }, { name: "" }), "pauta-semana.pdf");
    assert.equal(menuPdfFilename({}, null), "pauta-pauta.pdf");
    assert.equal(menuPdfFilename({ name: "   " }, null), "pauta-pauta.pdf");
    assert.equal(menuPdfFilename({ name: "¡¡¡···!!!" }, null), "pauta-pauta.pdf");
  });

  it("acentos, eñes, mayúsculas y símbolos salen como un nombre de fichero sano", () => {
    assert.equal(
      menuPdfFilename({ name: "Menú de Ángela Ñíguez — 2026/08" }, null),
      "pauta-menu-de-angela-niguez-2026-08.pdf"
    );
  });

  it("la base nunca pasa de 60 caracteres", () => {
    const largo = menuPdfFilename({ name: "a".repeat(200) }, null);
    assert.equal(largo, `pauta-${"a".repeat(60)}.pdf`);
    // SOSPECHOSO: el recorte a 60 va DESPUÉS de quitar los guiones de los
    // extremos, así que si el corte cae en un separador queda un guion colgando
    // («pauta-xxx-.pdf»). Es feo, no rompe nada, y arreglarlo cambiaría el
    // nombre de ficheros que ya se han mandado por correo. Se fija tal cual.
    assert.equal(
      menuPdfFilename({ name: `${"x".repeat(59)} y` }, null),
      `pauta-${"x".repeat(59)}-.pdf`
    );
  });
});

/* ═══ La estructura de tres partes ═════════════════════════════════════════ */

describe("buildMenuPdfBuffer: portada apaisada, días en vertical y recetario", () => {
  it("un menú semanal sale como un PDF de verdad con las tres partes en su sitio", async () => {
    const pdf = await pdfDe(planSemanal());

    assert.ok(Buffer.isBuffer(pdf.buffer));
    assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(forma(pdf), "HVV");

    // 1. Portada: A4 apaisado con la cabecera del centro y el calendario.
    assert.equal(Math.round(pdf.paginas[0].ancho), 842);
    assert.equal(Math.round(pdf.paginas[0].alto), 595);
    assert.match(pdf.paginas[0].texto, /NUTRI LAURA/);
    assert.match(pdf.paginas[0].texto, /Semana de mayo/);

    // 2. Días al detalle, en vertical.
    assert.equal(Math.round(pdf.paginas[1].ancho), 595);
    assert.match(pdf.paginas[1].texto, /Porridge de avena/);

    // 3. Recetario, al final y también en vertical.
    assert.match(pdf.paginas[2].texto, /Tus recetas/);
    assert.match(pdf.paginas[2].texto, /Preparación/);
  });

  it("la portada apaisada sigue apaisada en el SEGUNDO PDF del proceso", async () => {
    // El fallo del 21/08/2026: `switchToPortrait` muta el objeto de opciones
    // que pdfkit guarda por referencia, que era la constante del módulo. El
    // primer menú del proceso salía bien y todos los demás con la portada en
    // vertical. Un servidor de Next vive semanas: eso es «todos menos uno».
    const uno = await pdfDe(planSemanal());
    const dos = await pdfDe(planSemanal());
    const tres = await pdfDe(planSemanal());
    assert.equal(forma(uno), "HVV");
    assert.equal(forma(dos), "HVV", "el segundo PDF perdió la portada apaisada");
    assert.equal(forma(tres), "HVV");
    assert.deepEqual(
      [uno, dos, tres].map((p) => p.paginas[0].ancho),
      [841.89, 841.89, 841.89]
    );
    // Y los márgenes tampoco se contagian: mirar solo el TAMAÑO de la hoja deja
    // pasar que `switchToPortrait` se olvide de reponerlos y las páginas
    // verticales salgan con los 38 pt del apaisado en vez de con sus 46.
    for (const [cual, pdf] of [uno, dos, tres].entries()) {
      assert.equal(margenIzquierdo(pdf.paginas[0]), 38, `portada del PDF ${cual + 1}`);
      assert.equal(margenIzquierdo(pdf.paginas[1]), 46, `días del PDF ${cual + 1}`);
      assert.equal(margenIzquierdo(pdf.paginas[2]), 46, `recetario del PDF ${cual + 1}`);
    }
  });

  it("un plan SIN días se imprime plano y sin portada: todo vertical", async () => {
    const pdf = await pdfDe({
      name: "Pauta antigua",
      meals: [
        {
          name: "Comida",
          options: [
            {
              name: "Opción 1",
              isDefault: true,
              foods: [gramos({ name: "Lenteja" }, 80)],
              recipes: [],
            },
          ],
        },
      ],
    });
    assert.equal(forma(pdf), "V");
    assert.doesNotMatch(pdf.texto, /LUNES/); // sin semana no hay calendario
    assert.match(pdf.texto, /Pauta antigua/);
    assert.match(pdf.texto, /Lenteja · 80 g/);
  });

  it("una pauta sin comidas lo dice, y unas comidas vacías cuentan como sin comidas", async () => {
    const vacia = await pdfDe({ meals: [] }, { client: null, tenantName: null, brand: null });
    assert.equal(vacia.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(forma(vacia), "V");
    assert.match(vacia.texto, /Esta pauta aún no tiene comidas\./);
    assert.match(vacia.texto, /Pauta nutricional/); // título de repuesto

    const huecas = await pdfDe({ meals: [comida("Desayuno", 1)] });
    assert.match(huecas.texto, /Esta pauta aún no tiene comidas\./);
    assert.equal(forma(huecas), "V"); // sin contenido no hay semana que dibujar
  });

  it("sin plan no hay PDF: rechaza en vez de devolver un buffer a medias", async () => {
    await assert.rejects(buildMenuPdfBuffer({ plan: null }), TypeError);
    await assert.rejects(buildMenuPdfBuffer({}), TypeError);
  });
});

/* ═══ Parte 1 — la portada-calendario ══════════════════════════════════════ */

describe("la portada: la hoja de la nevera", () => {
  it("lleva los siete días, la cabecera del centro y el pie con paciente y fecha", async () => {
    const pdf = await pdfDe(planSemanal());
    const portada = pdf.paginas[0].texto;
    for (const dia of ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"]) {
      assert.match(portada, new RegExp(dia), `falta ${dia} en la portada`);
    }
    assert.match(portada, /Paciente: Ana López/);
    assert.match(portada, /Asignado: 04 de agosto de 2026/);
  });

  it("cada celda resume la opción por DEFECTO, no la primera de la lista", async () => {
    const pdf = await pdfDe({
      name: "Sin default",
      meals: [
        {
          name: "Comida",
          weekday: 1,
          order: 0,
          options: [
            { name: "Primera", foods: [gramos({ name: "Merluza" }, 1)], recipes: [] },
            {
              name: "Segunda",
              isDefault: true,
              foods: [gramos({ name: "Ternera" }, 1)],
              recipes: [],
            },
          ],
        },
      ],
    });
    assert.match(pdf.paginas[0].texto, /Ternera/);
    assert.doesNotMatch(pdf.paginas[0].texto, /Merluza/);
    // Pero en el detalle del día están las dos, con su ordinal y su nombre.
    assert.match(pdf.paginas[1].texto, /Opción 1 · Primera/);
    assert.match(pdf.paginas[1].texto, /Opción 2 · Segunda/);
  });

  it("hasta tres alimentos se listan; a partir de cuatro, el recuento", async () => {
    const tres = ["Pan", "Aceite", "Tomate"].map((n) => gramos({ name: n }, 1));
    const conTres = await pdfDe({ name: "T", meals: [comida("Desayuno", 1, { foods: tres })] });
    assert.match(conTres.paginas[0].texto, /Pan[\s\S]*Aceite[\s\S]*Tomate/);

    const conCuatro = await pdfDe({
      name: "C",
      meals: [comida("Desayuno", 1, { foods: [...tres, gramos({ name: "Café" }, 1)] })],
    });
    assert.match(conCuatro.paginas[0].texto, /4 alimentos/);
    assert.doesNotMatch(conCuatro.paginas[0].texto, /Café/);
  });

  it("las filas van en el orden canónico de las cinco comidas, y las de a medida al final", async () => {
    const pdf = await pdfDe({
      name: "Orden",
      meals: [
        comida("Recena", 1, { order: 5, foods: [gramos({ name: "Kiwi" }, 1)] }),
        comida("Cena", 1, { foods: [gramos({ name: "Sopa" }, 1)] }),
        comida("Desayuno", 1, { foods: [gramos({ name: "Pan" }, 1)] }),
      ],
    });
    // En la portada (etiquetas en mayúsculas) y en el día (en su capitalización).
    assert.match(pdf.paginas[0].texto, /DESAYUNO[\s\S]*CENA[\s\S]*RECENA/);
    assert.match(pdf.paginas[1].texto, /Desayuno[\s\S]*Cena[\s\S]*Recena/);
  });
});

/* ═══ Parte 2 — los días al detalle ════════════════════════════════════════ */

describe("los días: cada uno en su tarjeta, con lo que dijo la nutricionista", () => {
  it("el comentario del día, el de la comida y el del plan van cada uno a su sitio", async () => {
    const pdf = await pdfDe(planSemanal());
    const dias = pdf.paginas[1].texto;
    assert.match(dias, /El lunes cenamos pronto\./); // dayComments["1"]
    assert.match(dias, /Sin prisa\./); // meal.description
    // Los comentarios generales van DEBAJO del último día, no en la portada.
    assert.match(dias, /Comentarios de tu nutricionista/);
    assert.match(seguido(dias), /Bebe dos litros de agua al día\./);
    assert.doesNotMatch(pdf.paginas[0].texto, /Bebe dos litros/);
  });

  it("solo salen los días que tienen algo, y el aviso del recetario se dice UNA vez", async () => {
    const pdf = await pdfDe(planSemanal());
    const dias = pdf.paginas[1].texto;
    assert.match(dias, /LUNES/);
    assert.match(dias, /MARTES/);
    assert.doesNotMatch(dias, /MIÉRCOLES/);
    assert.equal(
      (seguido(pdf.texto).match(/Cada receta está explicada al final del documento/g) || []).length,
      1
    );
  });

  it("las cantidades se escriben como en el editor: gramos, medida casera y libre", async () => {
    const pdf = await pdfDe(planSemanal());
    assert.match(pdf.texto, /• {2}Avena · 150 g/);
    assert.match(pdf.texto, /• {2}Arroz · 2 taza\(s\) \(~60 g\)/); // 2 × 30 g
  });

  it("las raciones solo se dicen cuando NO son una", async () => {
    const pdf = await pdfDe(planSemanal());
    assert.match(pdf.paginas[1].texto, /• {2}Porridge de avena {2}· {2}2 raciones/);

    const unaSola = await pdfDe({
      name: "Una",
      meals: [
        comida("Comida", 1, {
          recipes: [
            { recipeId: "r", nameSnapshot: "Tortilla", servings: 1, steps: [], ingredients: [] },
          ],
        }),
      ],
    });
    assert.match(unaSola.paginas[1].texto, /• {2}Tortilla/);
    assert.doesNotMatch(unaSola.paginas[1].texto, /1 ración/); // en el día, ruido
  });

  it("las comidas que se quedaron sin día van a «Otras comidas», en su propia hoja", async () => {
    const plan = planSemanal();
    plan.meals.push(comida("Merienda", null, { foods: [gramos({ name: "Nueces" }, 30)] }));
    const pdf = await pdfDe(plan);
    assert.equal(forma(pdf), "HVVV");
    assert.match(pdf.paginas[2].texto, /Otras comidas/);
    assert.match(pdf.paginas[2].texto, /Nueces · 30 g/);
    assert.doesNotMatch(pdf.paginas[1].texto, /Nueces/);
  });

  it("el ordinal de la opción cuenta las que SE IMPRIMEN, no las que hay guardadas", async () => {
    const pdf = await pdfDe({
      name: "Huecos",
      meals: [
        {
          name: "Comida",
          weekday: 1,
          order: 0,
          options: [
            { name: "Opción 1", foods: [], recipes: [] }, // vacía: no se imprime
            { name: "Opción 2", foods: [gramos({ name: "Merluza" }, 1)], recipes: [] },
            { name: "Opción 3", foods: [gramos({ name: "Ternera" }, 1)], recipes: [] },
          ],
        },
      ],
    });
    assert.match(pdf.paginas[1].texto, /Opción 1\n• {2}Merluza/);
    assert.match(pdf.paginas[1].texto, /Opción 2\n• {2}Ternera/);
    assert.doesNotMatch(pdf.paginas[1].texto, /Opción 3/);

    // La misma regla en el OTRO renderizador: el que fluye, que es el que pinta
    // las comidas sin día y los planes antiguos. Es código aparte, así que se
    // le pregunta aparte.
    const sinDia = await pdfDe({
      name: "Huecos sin día",
      meals: [
        {
          name: "Comida",
          options: [
            { name: "Opción 1", foods: [], recipes: [] }, // vacía: no se imprime
            { name: "Opción 2", foods: [gramos({ name: "Merluza" }, 1)], recipes: [] },
            { name: "Opción 3", foods: [gramos({ name: "Ternera" }, 1)], recipes: [] },
          ],
        },
      ],
    });
    assert.match(sinDia.texto, /Opción 1\n• {2}Merluza/);
    assert.match(sinDia.texto, /Opción 2\n• {2}Ternera/);
    assert.doesNotMatch(sinDia.texto, /Opción 3/);
  });

  it("con una sola opción de nombre autogenerado no se pone etiqueta; con nombre propio, sí", async () => {
    const generica = await pdfDe({
      name: "G",
      meals: [comida("Comida", 1, { foods: [gramos({ name: "Merluza" }, 1)] })],
    });
    assert.doesNotMatch(generica.paginas[1].texto, /Opción/);

    // El «genérico» se reconoce sin distinguir mayúsculas ni espacios de más.
    const rara = await pdfDe({
      name: "G2",
      meals: [
        {
          name: "Comida",
          weekday: 1,
          order: 0,
          options: [
            {
              name: "  OPCIÓN   1 ",
              isDefault: true,
              foods: [gramos({ name: "Merluza" }, 1)],
              recipes: [],
            },
          ],
        },
      ],
    });
    assert.doesNotMatch(rara.paginas[1].texto, /Opción/);

    const propia = await pdfDe({
      name: "P",
      meals: [
        {
          name: "Comida",
          weekday: 1,
          order: 0,
          options: [
            {
              name: "Batido verde",
              isDefault: true,
              foods: [gramos({ name: "Espinaca" }, 1)],
              recipes: [],
            },
          ],
        },
      ],
    });
    assert.match(propia.paginas[1].texto, /Opción 1 · Batido verde/);
  });
});

/* ═══ Las cifras ═══════════════════════════════════════════════════════════ */

describe("macros: solo si la nutricionista lo pide, y con las cuentas que se le pasaron", () => {
  it("con showMacros imprime la suma de la opción: alimentos sueltos + recetas por raciones", async () => {
    const pdf = await pdfDe(planSemanal());
    const dias = pdf.paginas[1].texto;
    // 150 g × 10/100 + (50 g × 10/100) × 2 raciones = 25 g de proteína.
    assert.match(dias, /P 25 g/);
    assert.match(dias, /H 90 g/);
    assert.match(dias, /G 10,5 g/); // con coma decimal, en español
    assert.match(dias, /Fibra 15 g/);
    // En el recetario la receta va SIN escalar: es la ficha de la receta.
    assert.match(pdf.paginas[2].texto, /P 5 g/);
  });

  it("por defecto NO se imprime ni una cifra de macros", async () => {
    const pdf = await pdfDe(planSemanal({ showMacros: false }));
    assert.doesNotMatch(pdf.texto, /P 25 g/);
    assert.doesNotMatch(pdf.texto, /Fibra/);
    const sinCampo = await pdfDe(planSemanal({ showMacros: undefined }));
    assert.doesNotMatch(sinCampo.texto, /Fibra/);
  });

  it("un macro que nadie aporta no se inventa: se calla esa parte de la línea", async () => {
    const pdf = await pdfDe({
      name: "Solo proteína",
      showMacros: true,
      meals: [comida("Comida", 1, { foods: [gramos({ name: "Pollo", proteinPer100: 20 }, 200)] })],
    });
    assert.match(pdf.paginas[1].texto, /P 40 g/);
    assert.doesNotMatch(pdf.paginas[1].texto, /H |G |Fibra/);
  });

  it("las raciones fraccionadas escalan de verdad: media receta, la mitad de proteína", async () => {
    const pdf = await pdfDe({
      name: "Media",
      showMacros: true,
      meals: [
        comida("Comida", 1, {
          recipes: [
            {
              recipeId: "r",
              nameSnapshot: "Arroz con verduras",
              servings: 0.5,
              steps: [],
              ingredients: [gramos({ name: "Arroz", proteinPer100: 8 }, 100)],
            },
          ],
        }),
      ],
    });
    assert.match(pdf.paginas[1].texto, /Arroz con verduras {2}· {2}0,5 raciones/);
    assert.match(pdf.paginas[1].texto, /P 4 g/); // 8 g × 0,5
    assert.match(pdf.paginas[2].texto, /P 8 g/); // la ficha, a ración entera
  });
});

/* ═══ Parte 3 — el recetario ═══════════════════════════════════════════════ */

describe("el recetario: cada receta usada, explicada una sola vez", () => {
  it("una receta usada tres veces en la semana se explica UNA vez, con sus pasos numerados", async () => {
    const receta = (servings) => ({
      recipeId: "r-pollo",
      nameSnapshot: "Pollo al horno",
      servings,
      steps: ["Precalentar el horno.", "Hornear 40 minutos."],
      ingredients: [gramos({ name: "Pollo" }, 200)],
    });
    const pdf = await pdfDe({
      name: "Repetida",
      meals: [
        comida("Comida", 1, { recipes: [receta(1)] }),
        comida("Cena", 1, { recipes: [receta(2)] }),
        comida("Comida", 2, { recipes: [receta(1)] }),
      ],
    });
    const recetario = pdf.paginas[pdf.paginas.length - 1].texto;
    assert.match(recetario, /Tus recetas/);
    assert.equal((recetario.match(/Pollo al horno/g) || []).length, 1);
    assert.match(recetario, /Ingredientes\n• {2}Pollo · 200 g/);
    assert.match(recetario, /Precalentar el horno\./);
    assert.match(recetario, /Hornear 40 minutos\./);
    // El nº del paso se pinta aparte, en la sangría de la línea.
    assert.match(recetario, /1\.\nPrecalentar/);
    assert.match(recetario, /2\.\nHornear/);
  });

  it("sin recipeId se deduplica por el nombre congelado, y el orden es el de aparición", async () => {
    const tortilla = { nameSnapshot: "Tortilla", servings: 1, steps: ["Batir."], ingredients: [] };
    const pdf = await pdfDe({
      name: "Sin id",
      meals: [
        comida("Comida", 1, { recipes: [{ ...tortilla }] }),
        comida("Cena", 1, {
          recipes: [{ nameSnapshot: "Crepe", servings: 1, steps: ["Batir."], ingredients: [] }],
        }),
        comida("Comida", 2, { recipes: [{ ...tortilla }] }),
      ],
    });
    const recetario = pdf.paginas[pdf.paginas.length - 1].texto;
    assert.equal((recetario.match(/Tortilla/g) || []).length, 1);
    assert.match(recetario, /Tortilla[\s\S]*Crepe/);
  });

  it("una receta sin ingredientes pone una raya, no un hueco", async () => {
    const pdf = await pdfDe({
      name: "Pelada",
      meals: [
        comida("Comida", 1, {
          recipes: [
            { recipeId: "r", nameSnapshot: "Caldo", servings: 1, steps: [], ingredients: [] },
          ],
        }),
      ],
    });
    assert.match(pdf.paginas[pdf.paginas.length - 1].texto, /Caldo\n1 ración\nIngredientes\n—/);
  });

  it("sin recetas no hay recetario ni aviso: el documento acaba en los días", async () => {
    const pdf = await pdfDe({
      name: "Sin recetas",
      meals: [comida("Comida", 1, { foods: [gramos({ name: "Sopa" }, 1)] })],
    });
    assert.equal(forma(pdf), "HV");
    assert.doesNotMatch(pdf.texto, /Tus recetas/);
    assert.doesNotMatch(pdf.texto, /Cada receta está explicada/);
  });

  it("una foto que no está en disco no tumba el PDF: sale sin ella", async () => {
    const pdf = await pdfDe(
      {
        name: "Con foto",
        meals: [
          comida("Comida", 1, {
            recipes: [
              {
                recipeId: "11111111-1111-4111-8111-111111111111",
                nameSnapshot: "Sopa de la abuela",
                servings: 1,
                photoPath:
                  "nutricion-recipes/nutri_laura/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg",
                steps: ["Hervir."],
                ingredients: [],
              },
            ],
          }),
        ],
      },
      { tenantSlug: "nutri_laura" }
    );
    assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(pdf.paginas[pdf.paginas.length - 1].texto, /Sopa de la abuela/);
    assert.match(pdf.texto, /Hervir\./);
  });
});

/* ═══ Bordes ═══════════════════════════════════════════════════════════════ */

describe("bordes: lo raro no puede dejar a la paciente sin su menú", () => {
  it("cantidades de todo tipo se imprimen sin romper la línea", async () => {
    const pdf = await pdfDe({
      name: "Raras",
      meals: [
        comida("Comida", 3, {
          foods: [
            gramos({ name: "Cero" }, 0),
            gramos({ name: "Nulo" }, null),
            gramos({ name: "Negativo" }, -5),
            gramos({ name: "Enorme" }, 1234567.891),
            { unit: "household", amount: 3, food: { name: "SinEtiqueta" } },
            { unit: "free", notes: "", food: {} },
            { unit: "free", notes: "lo que quieras", food: { name: "Libre" } },
            gramos({ name: "ConNota" }, 10, { notes: "sin sal" }),
          ],
        }),
      ],
    });
    const dia = pdf.paginas[1].texto;
    assert.match(dia, /Cero · 0 g/);
    assert.match(dia, /Nulo · 0 g/); // amount null cuenta como cero
    assert.match(dia, /Negativo · -5 g/);
    assert.match(dia, /Enorme · 1\.234\.567,89 g/); // miles con punto, dos decimales
    assert.match(dia, /SinEtiqueta · 3 ud\./); // sin etiqueta casera, «ud.»
    assert.match(dia, /Alimento · cantidad libre/); // sin nombre y sin notas
    assert.match(dia, /Libre · lo que quieras/); // en libre, las notas SON la cantidad
    assert.match(dia, /ConNota · 10 g — sin sal/); // fuera de libre, van como apunte
  });

  it("un comentario kilométrico sale ENTERO, nunca recortado con puntos suspensivos", async () => {
    const frases = Array.from(
      { length: 90 },
      (_, i) => `Frase ${i} de un comentario larguísimo que la nutricionista quiso dejar escrito.`
    );
    const pdf = await pdfDe(planSemanal({ description: frases.join(" ") }));
    assert.match(seguido(pdf.texto), /Frase 0 de un comentario/);
    assert.match(seguido(pdf.texto), /Frase 89 de un comentario/);
    assert.doesNotMatch(pdf.texto, /…/);
  });

  it("un día que no cabe en una hoja se imprime igual, entero y paginando", async () => {
    const pdf = await pdfDe({
      name: "Día gigante",
      meals: ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena"].map((nombre, i) =>
        comida(nombre, 1, {
          order: i,
          foods: Array.from({ length: 22 }, (_, j) =>
            gramos({ name: `Alimento ${nombre}-${j}` }, j)
          ),
        })
      ),
    });
    assert.ok(pdf.paginas.length > 2, "un día así tiene que ocupar más de una hoja");
    assert.match(pdf.texto, /Alimento Desayuno-0 · 0 g/);
    assert.match(pdf.texto, /Alimento Cena-21 · 21 g/);
    // Aunque no quepa la tarjeta, el día sigue anunciándose por su nombre.
    assert.match(pdf.paginas[1].texto, /LUNES/);
  });

  it("una receta que no cabe en una hoja se imprime igual, con todos sus pasos", async () => {
    const pdf = await pdfDe({
      name: "Receta gigante",
      meals: [
        comida("Comida", 1, {
          recipes: [
            {
              recipeId: "r",
              nameSnapshot: "Cocido interminable",
              servings: 1,
              steps: Array.from(
                { length: 60 },
                (_, i) => `Paso ${i}, explicado con todo lujo de detalles.`
              ),
              ingredients: Array.from({ length: 40 }, (_, i) =>
                gramos({ name: `Ingrediente ${i}` }, i)
              ),
            },
          ],
        }),
      ],
    });
    assert.match(seguido(pdf.texto), /Paso 0, explicado con todo lujo de detalles\./);
    assert.match(seguido(pdf.texto), /Paso 59, explicado con todo lujo de detalles\./);
    assert.match(pdf.texto, /Ingrediente 39 · 39 g/);
  });

  it("sin nombre de plan, sin centro y con una fecha que no es fecha, el PDF sale igual", async () => {
    const pdf = await pdfDe(
      {
        assignedAt: "no-es-una-fecha",
        meals: [comida("Comida", 1, { foods: [gramos({ name: "Sopa" }, 1)] })],
      },
      { tenantName: null, brand: undefined }
    );
    assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(pdf.paginas[0].texto, /Pauta semanal/); // título de repuesto
    assert.doesNotMatch(pdf.texto, /Asignado:/); // una fecha ilegible no se imprime

    const sinFecha = await pdfDe(planSemanal({ assignedAt: null }));
    assert.doesNotMatch(sinFecha.texto, /Asignado:/);
    assert.match(sinFecha.texto, /Paciente: Ana López/);
  });

  it("nombres con paréntesis, barras y símbolos salen tal cual, sin escaparse a medias", async () => {
    const pdf = await pdfDe(
      {
        name: "Piñón & Co. <b>«raro»</b> 100%",
        meals: [comida("Comida", 1, { foods: [gramos({ name: "Ali(men)to \\ raro" }, 1)] })],
      },
      { client: { name: "Ana (madre) O'Neill" } }
    );
    assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(seguido(pdf.paginas[0].texto), /Piñón & Co\. <b>«raro»<\/b> 100%/);
    assert.match(seguido(pdf.paginas[0].texto), /Paciente: Ana \(madre\) O'Neill/);
    assert.match(pdf.paginas[1].texto, /Ali\(men\)to \\ raro · 1 g/);
  });

  it("un carácter que la tipografía no tiene (un emoji) no tumba el documento", async () => {
    const pdf = await pdfDe(planSemanal({ name: "Semana 😀 de mayo" }), {
      client: { name: "Ana 😀 López" },
    });
    assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(pdf.paginas[0].texto, /Paciente: Ana/);
    assert.match(pdf.paginas[0].texto, /López/);
  });

  it("el color de marca del cliente llega al documento; sin marca, el verde de casa", async () => {
    const rosa = await pdfDe(planSemanal(), { brand: { primaryColor: "#FF1F96" } });
    assert.ok(
      rosa.paginas.some((p) => p.crudo.includes(colorPdf("#FF1F96"))),
      "el color de marca no llegó al PDF"
    );
    const casa = await pdfDe(planSemanal(), { brand: {} });
    assert.ok(casa.paginas.some((p) => p.crudo.includes(colorPdf("#1B3A2D"))));
    assert.ok(!casa.paginas.some((p) => p.crudo.includes(colorPdf("#FF1F96"))));
  });
});

/* ═══ Lo que se fija tal como está ═════════════════════════════════════════ */

describe("costuras conocidas del generador (fijadas tal cual, no arregladas)", () => {
  it("SOSPECHOSO: un plan sin días explica la receta DOS veces", async () => {
    // El camino plano (menús anteriores al rework de la semana) pinta la receta
    // entera —foto, ingredientes y pasos— dentro de la comida, y después
    // `renderRecipeBook` la vuelve a explicar en «Tus recetas». Con los menús de
    // hoy no pasa (todos llevan día), y cambiarlo tocaría cómo se ve un menú
    // antiguo que alguien puede volver a descargar. Se deja apuntado.
    const pdf = await pdfDe({
      name: "Antigua",
      meals: [
        {
          name: "Comida",
          options: [
            {
              name: "Opción 1",
              isDefault: true,
              foods: [],
              recipes: [
                {
                  recipeId: "r",
                  nameSnapshot: "Lentejas",
                  servings: 1,
                  steps: ["Cocer."],
                  ingredients: [gramos({ name: "Lenteja" }, 80)],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal((pdf.texto.match(/Lentejas/g) || []).length, 2);
    assert.equal((pdf.texto.match(/Cocer\./g) || []).length, 2);
    // De paso, lo ÚNICO que fija el camino que fluye: ahí el rótulo lleva dos
    // puntos y el número del paso va pegado al texto, mientras que en el
    // recetario el rótulo va sin ellos y el ordinal se pinta en la sangría.
    assert.match(pdf.texto, /Preparación:\n1\. Cocer\./);
    assert.match(pdf.texto, /Preparación\n1\.\nCocer\./);
  });

  it("SOSPECHOSO: un weekday que no es un número de 1 a 7 hace desaparecer la comida", async () => {
    // `mealsOfDay` compara con === contra 1..7 y «las que no tienen día» se
    // buscan con == null. Una comida con weekday "1" (texto) o 0 no entra en
    // ninguno de los dos sitios: cuenta para que haya semana, deja su fila en la
    // portada… y su contenido no se imprime en ninguna parte. Hoy no muerde
    // porque la columna es un entero de 1 a 7 con validación, pero si algún día
    // llega por otra vía, el menú perdería una comida en silencio.
    const pdf = await pdfDe({
      name: "Texto",
      meals: [comida("Comida", "1", { foods: [gramos({ name: "Merluza" }, 1)] })],
    });
    assert.equal(forma(pdf), "H"); // ni hoja de días ni «Otras comidas»
    assert.match(pdf.texto, /COMIDA/); // la fila del calendario sí sale
    assert.doesNotMatch(pdf.texto, /Merluza/); // el alimento, no
  });

  it("SOSPECHOSO: un nombre de opción vacío o nulo se pega detrás del ordinal", async () => {
    // «Genérico» solo reconoce la forma exacta «Opción N». Cualquier otra cosa
    // —incluido "" o null— se imprime tras el punto medio. La columna es NOT
    // NULL con valor por defecto, así que hoy no llega; se fija por si llegara.
    const conNulo = await pdfDe({
      name: "N",
      meals: [
        {
          name: "Comida",
          weekday: 1,
          order: 0,
          options: [
            { name: null, isDefault: true, foods: [gramos({ name: "Merluza" }, 1)], recipes: [] },
          ],
        },
      ],
    });
    assert.match(conNulo.paginas[1].texto, /Opción 1 · null/);
  });

  it("SOSPECHOSO: una cantidad que no es un número imprime «NaN g»", async () => {
    // `fmtNum` intenta protegerse con `Number(n || 0)`, que salva el null y el
    // cero pero no un texto: "abc" pasa el `||` y sale NaN. La columna es
    // decimal, así que hoy nunca llega un texto; si llegara, la paciente vería
    // «NaN g» en su menú, que es peor que «0 g».
    const pdf = await pdfDe({
      name: "NaN",
      meals: [comida("Comida", 1, { foods: [gramos({ name: "Texto" }, "hola")] })],
    });
    assert.match(pdf.paginas[1].texto, /Texto · NaN g/);
  });
});
