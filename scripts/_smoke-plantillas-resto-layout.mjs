// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-plantillas-resto-layout.mjs — el layout de los correos y las seis
 * plantillas que no son de citas (21/08/2026).
 *
 *   node scripts/_smoke-plantillas-resto-layout.mjs
 *   node --test-name-pattern="marca" scripts/_smoke-plantillas-resto-layout.mjs
 *
 * ── QUÉ FIJA Y POR QUÉ EXISTE ───────────────────────────────────────────────
 *
 * Tras las cuatro tandas de pruebas del 17–20/08 la lógica pura de `lib/` quedó
 * cubierta salvo dos zonas: los generadores de PDF y las plantillas de correo.
 * Esta cubre la segunda mitad de las plantillas —todo lo que no es `citas/`— y,
 * sobre todo, `layout.js`, que lo usan TODAS: es el único sitio por donde entra
 * la marca del tenant (`Tenant.settings.brand`) en un correo.
 *
 * Lo que se prueba es lo que DEVUELVE cada plantilla: `{subject, html, text}`.
 * Tres cosas se miran en todas, porque son las tres que se rompen solas:
 *
 *   1. LA MARCA. Un tenant sin `settings.brand` (los recién dados de alta:
 *      `somos`, `gm_alvar_alonso`) tiene que recibir el correo entero con la
 *      paleta Salamandra, no un `style="background:undefined"`. Y un color
 *      guardado a mano que no sea un color —el endpoint de ajustes lo guarda
 *      como string sin validar— NO puede salirse del atributo `style` y
 *      convertirse en HTML: ese es el motivo de `safeColor`, y aquí se fija.
 *
 *   2. EL TEXTO PLANO. El clásico: se toca el HTML, se olvida el `text`, y el
 *      cliente que lee en texto plano recibe un correo que dice menos. Cada
 *      plantilla tiene su `it` de «esto aparece en los dos».
 *
 *   3. LOS CONDICIONALES. Los «si pasa X, di Y» son las líneas que nadie mira:
 *      la factura sin vencimiento, el ticket sin respuesta, el aviso del buzón
 *      sin pantalla, el recibo de configuración sin credenciales. Uno por uno.
 *
 * Los `it` marcados `// SOSPECHOSO` fijan lo que HOY hace el código aunque
 * huela raro, con el porqué al lado: si alguien lo cambia a propósito, la
 * prueba que falla le explica qué estaba pasando antes.
 *
 * Las plantillas de `lib/email/templates/citas/` tienen su propia prueba: aquí
 * no se tocan.
 *
 * ── TRIADAS EL 24/08/2026 ──────────────────────────────────────────────────
 * Las marcas de este fichero ya están juzgadas con el criterio del Registro:
 * DEFECTO = con una entrada que alguien puede mandar de verdad, devuelve algo
 * malo o revienta. TOLERANCIA = solo acepta basura que no tiene camino. Cada
 * una se comprobó ejecutando la función y siguiendo el dato hasta su columna
 * o su endpoint; una marca que sigue aquí NO es una marca sin mirar.
 *
 * Salieron DEFECTO y están arreglados (su `it` se volteó y perdió la marca):
 *   · el recorte del texto plano se queda sin los puntos suspensivos
 *
 * Las otras 5 son TOLERANCIA, y el porqué de cada una está junto a su `it`.
 * En una frase, por qué ninguna tiene camino de entrada:
 *    302  un valor 0 numérico se cae de la tabla, un 5 no
 *         → El filtro `blocks.filter((b) => b && b.value)` de layout.js:8…
 *    419  una fecha ilegible imprime «Invalid Date» (el catch no llega a sa…
 *         → Es cierto que el try/catch de formatDate está muerto (`new Da…
 *    556  con el asunto vacío quedan dos puntos colgando en el asunto
 *         → El asunto del correo se monta sin condicional, pero un aviso …
 *    722  `credenciales: {}` alarma en el asunto sin nada que contar
 *         → `hayCredenciales = !!credenciales` da true con un objeto vací…
 *    900  un color rgb() o un nombre CSS tiñen la barra pero NO el borde
 *         → La regex del borde solo acepta hex y el layout acepta además …
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderLayout, escapeHtml } from "../lib/email/templates/layout.js";
import { invoiceSentTemplate } from "../lib/email/templates/billing/invoiceSent.js";
import { avisoParaNosotros } from "../lib/email/templates/buzon/avisoNuevo.js";
import { cambioConfiguracionTemplate } from "../lib/email/templates/configuracion/cambioAplicado.js";
import { menuEmail } from "../lib/email/templates/nutricion/menuEmail.js";
import { ticketClientTemplate } from "../lib/email/templates/soporte/ticketClient.js";
import { ticketTeamTemplate } from "../lib/email/templates/soporte/ticketTeam.js";

// ── La paleta de fábrica, la de Salamandra ──────────────────────────────────
const VERDE = "#1B3A2D"; // primaryColor
const CREMA = "#F7F1EB"; // accent (el fondo del correo)

// ── Lupas sobre el HTML que SALE (no sobre el código fuente) ────────────────

/** La barra de 6px de arriba: es el único sitio donde se pinta `primaryColor`. */
function barraDeMarca(html) {
  const m = html.match(/height:6px;background:([^;"]+)/);
  return m ? m[1] : null;
}

/** El fondo del `<body>`: ahí entra `accent`. */
function fondoDelCorreo(html) {
  const m = html.match(/background:([^;]+);font-family/);
  return m ? m[1] : null;
}

/** El texto invisible que el buzón enseña como avance de la línea de asunto. */
function preheaderDe(html) {
  const m = html.match(/mso-hide:all;">([^<]*)</);
  return m ? m[1] : null;
}

/** El rótulo pequeño de arriba del todo: quién FIRMA el correo. */
function remitenteDe(html) {
  const m = html.match(/text-transform:uppercase;color:[^;]*;margin-bottom:8px;">([^<]*)</);
  return m ? m[1] : null;
}

const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * El HTML sin etiquetas ni entidades: lo que de verdad LEE quien abre el
 * correo. Sirve para comparar el HTML con el `text` sin pelearse con los
 * `<strong>` que hay en medio de una frase.
 *
 * El preheader se quita ANTES que nada: es texto oculto que el cuerpo del
 * correo no enseña. Sin quitarlo, un «sale en el HTML» se daba por bueno
 * porque el dato estaba en el avance invisible de la bandeja, y borrar la
 * fila visible de la tabla no ponía roja ninguna prueba (comprobado el
 * 21/08/2026 quitando `{ label: "Asunto" }` de `ticketClient`).
 */
function loQueSeLee(html) {
  return html
    .replace(/<span[^>]*mso-hide:all[^>]*>[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTIDADES[e])
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que tiene que aparecer sí o sí en LAS DOS versiones del mismo correo. */
function enLasDosVersiones({ html, text }, trozos) {
  const leido = loQueSeLee(html);
  for (const t of trozos) {
    assert.ok(leido.includes(t), `falta en el HTML: «${t}»`);
    assert.ok(text.includes(t), `falta en el texto plano: «${t}»`);
  }
}

/** Un nombre escrito por una persona que trae HTML dentro. */
const HOSTIL = '<script>alert("ups")</script>';

/** Ninguna plantilla puede dejar salir una etiqueta que venía de un dato. */
function nadaDeHtmlCrudo(html) {
  assert.ok(!html.includes("<script"), "se ha colado un <script> sin escapar");
  assert.ok(html.includes("&lt;script&gt;"), "el dato hostil ni siquiera aparece escapado");
}

// ════════════════════════════════════════════════════════════════════════════
// layout.js — el que usan TODAS
// ════════════════════════════════════════════════════════════════════════════

describe("renderLayout: un tenant SIN marca recibe el correo entero", () => {
  it("sin `brand`, la paleta es la de Salamandra y no hay ningún undefined", () => {
    const html = renderLayout({ tenantName: "Somos", title: "Hola", intro: "<p>qué tal</p>" });
    assert.equal(barraDeMarca(html), VERDE);
    assert.equal(fondoDelCorreo(html), CREMA);
    assert.ok(!html.includes("undefined"), "hay un undefined interpolado en el HTML");
    assert.ok(!html.includes("null"), "hay un null interpolado en el HTML");
  });

  it("`brand: null` y `brand: undefined` se tratan como «sin marca»", () => {
    for (const brand of [null, undefined]) {
      const html = renderLayout({ tenantName: "T", title: "T", intro: "", brand });
      assert.equal(barraDeMarca(html), VERDE);
    }
  });

  it("el correo sale entero: doctype, título y cierre", () => {
    const html = renderLayout({ tenantName: "T", title: "Mi asunto", intro: "" });
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("<title>Mi asunto</title>"));
    assert.ok(html.trimEnd().endsWith("</html>"));
  });

  it("con solo lo obligatorio, y hasta con nada, no revienta", () => {
    assert.equal(typeof renderLayout({}), "string");
    assert.equal(barraDeMarca(renderLayout({})), VERDE);
  });
});

describe("renderLayout: la marca del tenant sí llega cuando la hay", () => {
  it("el rosa de Aumenta pinta la barra", () => {
    const html = renderLayout({
      tenantName: "Aumenta",
      title: "T",
      intro: "",
      brand: { primaryColor: "#FF1F96", accent: "#FFF0F7" },
    });
    assert.equal(barraDeMarca(html), "#FF1F96");
    assert.equal(fondoDelCorreo(html), "#FFF0F7");
  });

  it("una marca a medias no arrastra a las demás: lo que falta sigue en Salamandra", () => {
    const html = renderLayout({ tenantName: "T", title: "T", intro: "", brand: { primaryColor: "#124A55" } });
    assert.equal(barraDeMarca(html), "#124A55");
    assert.equal(fondoDelCorreo(html), CREMA);
  });

  it("acepta hex de 3, 6 y 8, rgb(), rgba() y un nombre CSS; y no le molestan los espacios", () => {
    const acepta = (c) => barraDeMarca(renderLayout({ tenantName: "T", title: "T", intro: "", brand: { primaryColor: c } }));
    assert.equal(acepta("#abc"), "#abc");
    assert.equal(acepta("#FF1F96"), "#FF1F96");
    assert.equal(acepta("#FF1F96AA"), "#FF1F96AA");
    assert.equal(acepta("rgb(255, 31, 150)"), "rgb(255, 31, 150)");
    assert.equal(acepta("rgba(0,0,0,.5)"), "rgba(0,0,0,.5)");
    assert.equal(acepta("rebeccapurple"), "rebeccapurple");
    assert.equal(acepta("  #FF1F96  "), "#FF1F96");
  });
});

describe("renderLayout: un «color» que no es un color no puede salirse del style", () => {
  // Este es el motivo de `safeColor`. Los colores se interpolan CRUDOS dentro
  // de style="…" y el endpoint de ajustes los guarda como string sin validar:
  // un admin del tenant podría meter HTML que llega al paciente desde nuestro
  // dominio verificado. Todo lo que no sea un color inequívoco cae al default.
  const conColor = (c) => renderLayout({ tenantName: "T", title: "T", intro: "", brand: { primaryColor: c } });

  it("cerrar la comilla para inyectar un atributo NO cuela: cae al verde", () => {
    const html = conColor('#fff" onload="alert(1)');
    assert.equal(barraDeMarca(html), VERDE);
    assert.ok(!html.includes("onload"), "la inyección llegó al HTML");
  });

  it("cerrar la etiqueta para inyectar un enlace de phishing tampoco", () => {
    const html = conColor('red"></td></tr></table><a href="http://malo.example">Pincha aquí</a><table x="');
    assert.equal(barraDeMarca(html), VERDE);
    assert.ok(!html.includes("malo.example"), "el enlace inyectado llegó al correo");
  });

  it("basura variada cae al default, y lo que no es texto también", () => {
    for (const c of ["url(javascript:1)", "#zzz", "", "   ", "expression(x)", 123, true, null, {}, []]) {
      assert.equal(barraDeMarca(conColor(c)), VERDE, `pasó: ${JSON.stringify(c)}`);
    }
  });

  it("los SEIS colores se sanean, no solo el principal", () => {
    const html = renderLayout({
      tenantName: "T",
      title: "T",
      intro: "",
      brand: {
        primaryColor: '"x',
        secondaryColor: '"x',
        accent: '"x',
        card: '"x',
        text: '"x',
        muted: '"x',
      },
    });
    assert.ok(!html.includes('"x'), "algún color se coló sin sanear");
    assert.equal(barraDeMarca(html), VERDE);
    assert.equal(fondoDelCorreo(html), CREMA);
  });
});

describe("renderLayout: qué se escapa y qué va crudo a propósito", () => {
  it("el nombre del tenant y el título se escapan", () => {
    const html = renderLayout({ tenantName: "Centro <b>Aumenta</b> & Co", title: 'Hola "tú"', intro: "" });
    assert.ok(html.includes("Centro &lt;b&gt;Aumenta&lt;/b&gt; &amp; Co"));
    assert.ok(html.includes("<title>Hola &quot;tú&quot;</title>"));
    assert.ok(!html.includes("<b>Aumenta</b>"));
  });

  it("el footer por defecto lleva el nombre del tenant, ya escapado", () => {
    const html = renderLayout({ tenantName: "A <b> Z", title: "T", intro: "" });
    assert.ok(loQueSeLee(html).includes("Este email fue enviado por A <b> Z."));
    assert.ok(!html.includes("por A <b> Z"));
  });

  it("un footer propio sustituye al de fábrica y también se escapa", () => {
    const html = renderLayout({ tenantName: "T", title: "T", intro: "", footer: "Aviso <interno>" });
    assert.ok(html.includes("Aviso &lt;interno&gt;"));
    assert.ok(!html.includes("Este email fue enviado por"));
  });

  it("`intro` y `bodyHtml` van CRUDOS: son HTML que monta la plantilla, no datos", () => {
    const html = renderLayout({ tenantName: "T", title: "T", intro: "<em>vivo</em>", bodyHtml: "<b>también</b>" });
    assert.ok(html.includes("<em>vivo</em>"));
    assert.ok(html.includes("<b>también</b>"));
  });

  it("el preheader se escapa y sale antes que nada", () => {
    const html = renderLayout({ tenantName: "T", title: "T", intro: "", preheader: "3 cosas & <ojo>" });
    assert.equal(preheaderDe(html), "3 cosas &amp; &lt;ojo&gt;");
  });

  it("sin preheader, el hueco queda vacío (no pone «undefined» en la bandeja)", () => {
    assert.equal(preheaderDe(renderLayout({ tenantName: "T", title: "T", intro: "" })), "");
  });
});

describe("renderLayout: la tabla de datos clave", () => {
  it("pinta etiqueta y valor, los dos escapados", () => {
    const html = renderLayout({
      tenantName: "T",
      title: "T",
      intro: "",
      blocks: [{ label: "Nº <de> factura", value: "F-2026/1 & 2" }],
    });
    assert.ok(html.includes("Nº &lt;de&gt; factura"));
    assert.ok(html.includes("F-2026/1 &amp; 2"));
  });

  it("sin bloques no se dibuja la tabla interior", () => {
    const sin = renderLayout({ tenantName: "T", title: "T", intro: "" });
    const con = renderLayout({ tenantName: "T", title: "T", intro: "", blocks: [{ label: "L", value: "V" }] });
    assert.ok(!sin.includes("border-radius:10px"));
    assert.ok(con.includes("border-radius:10px"));
  });

  it("un bloque sin valor se cae, y un null en la lista no revienta", () => {
    const html = renderLayout({
      tenantName: "T",
      title: "T",
      intro: "",
      blocks: [{ label: "Vencimiento", value: null }, null, undefined, { label: "Total", value: "5 €" }],
    });
    assert.ok(!html.includes("Vencimiento"));
    assert.ok(html.includes("Total"));
  });

  // SOSPECHOSO — el filtro es `b.value` a secas, así que un valor 0 (número)
  // desaparece igual que uno vacío. Hoy nadie pasa números: los importes llegan
  // ya formateados ("0,00 €") y por eso un total de cero SÍ se ve. Se fija tal
  // cual para que se note el día que alguien pase un número.
  it("un valor 0 numérico se cae de la tabla, un 5 no // SOSPECHOSO", () => {
    const html = renderLayout({
      tenantName: "T",
      title: "T",
      intro: "",
      blocks: [{ label: "Cero", value: 0 }, { label: "Cinco", value: 5 }],
    });
    assert.ok(!html.includes("Cero"));
    assert.ok(html.includes("Cinco"));
  });
});

describe("escapeHtml: la pieza que comparten casi todas", () => {
  it("null y undefined dan cadena vacía, nunca «null»", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });
  it("los cinco caracteres, y el 0 sobrevive", () => {
    assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    assert.equal(escapeHtml(0), "0");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// billing/invoiceSent.js — la factura con el PDF adjunto
// ════════════════════════════════════════════════════════════════════════════

const FACTURA = {
  tenantName: "Aumenta",
  invoiceNumber: "F-2026-0031",
  clientName: "María López Pérez",
  issueDate: "2026-08-21",
  dueDate: "2026-09-30",
  total: "1.234,56 €",
};

describe("invoiceSentTemplate", () => {
  it("el asunto lleva número y centro", () => {
    assert.equal(invoiceSentTemplate(FACTURA).subject, "Factura F-2026-0031 · Aumenta");
  });

  it("el HTML y el texto plano dicen lo mismo: número, fechas y total", () => {
    const tpl = invoiceSentTemplate(FACTURA);
    enLasDosVersiones(tpl, [
      "F-2026-0031",
      "21 de agosto de 2026",
      "30 de septiembre de 2026",
      "1.234,56 €",
    ]);
  });

  it("saluda por el NOMBRE de pila, no por el nombre fiscal entero", () => {
    const tpl = invoiceSentTemplate(FACTURA);
    assert.ok(loQueSeLee(tpl.html).includes("Hola María,"));
    assert.equal(tpl.text.split("\n")[0], "Hola María,");
    assert.ok(!tpl.text.includes("Hola María López Pérez"));
  });

  it("sin cliente (o con un nombre en blanco) saluda igual, sin dejar un hueco", () => {
    for (const clientName of [undefined, null, "", "   "]) {
      const tpl = invoiceSentTemplate({ ...FACTURA, clientName });
      assert.equal(tpl.text.split("\n")[0], "Hola,");
      assert.ok(loQueSeLee(tpl.html).includes("Hola,"));
      assert.ok(!tpl.html.includes("Hola ,"));
    }
  });

  it("sin vencimiento, la fila de Vencimiento no aparece en ninguna de las dos", () => {
    const tpl = invoiceSentTemplate({ ...FACTURA, dueDate: null });
    assert.ok(!tpl.html.includes("Vencimiento"));
    assert.ok(!tpl.text.includes("Vencimiento"));
    assert.ok(tpl.text.includes("Total: 1.234,56 €"));
  });

  it("sin fecha de emisión pone una raya, no «Invalid Date»", () => {
    const tpl = invoiceSentTemplate({ ...FACTURA, issueDate: null });
    assert.ok(tpl.text.includes("Fecha: —"));
  });

  it("un total de cero SÍ se ve (llega formateado, no como número)", () => {
    const tpl = invoiceSentTemplate({ ...FACTURA, total: "0,00 €" });
    enLasDosVersiones(tpl, ["0,00 €"]);
  });

  it("el mensaje libre aparece en los dos, y sus saltos de línea se convierten en <br>", () => {
    const tpl = invoiceSentTemplate({ ...FACTURA, mensaje: "Primera línea\nSegunda línea" });
    assert.ok(tpl.html.includes("Primera línea<br>Segunda línea"));
    assert.ok(tpl.text.includes("Primera línea\nSegunda línea"));
  });

  it("un mensaje vacío o solo espacios no deja un párrafo huérfano", () => {
    for (const mensaje of [null, "", "   \n  "]) {
      const tpl = invoiceSentTemplate({ ...FACTURA, mensaje });
      assert.ok(!tpl.html.includes("<p style=\"margin:0 0 12px\"></p>"));
      assert.ok(!tpl.text.includes("\n\n\n\n"));
    }
  });

  it("el preheader anuncia número e importe", () => {
    assert.equal(
      preheaderDe(invoiceSentTemplate(FACTURA).html),
      "Adjuntamos la factura F-2026-0031 por 1.234,56 €."
    );
  });

  it("el número y el nombre del cliente se escapan en el HTML", () => {
    const tpl = invoiceSentTemplate({ ...FACTURA, clientName: HOSTIL, invoiceNumber: "F<1>" });
    nadaDeHtmlCrudo(tpl.html);
    assert.ok(tpl.html.includes("F&lt;1&gt;"));
  });

  // SOSPECHOSO — `formatDate` tiene un try/catch para caer al valor original si
  // la fecha no se puede formatear, pero `new Date("no-es-fecha")` no lanza:
  // devuelve una fecha inválida y `toLocaleDateString` escribe "Invalid Date".
  // O sea: el catch está muerto para el caso que quería cubrir. No se cambia
  // porque el endpoint que la llama pasa siempre columnas de fecha del modelo
  // (`invoice.issueDate` / `invoice.dueDate`), nunca texto libre.
  it("una fecha ilegible imprime «Invalid Date» (el catch no llega a saltar) // SOSPECHOSO", () => {
    const tpl = invoiceSentTemplate({ ...FACTURA, issueDate: "el martes" });
    assert.ok(tpl.text.includes("Fecha: Invalid Date"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buzon/avisoNuevo.js — el cliente nos escribe a NOSOTROS
// ════════════════════════════════════════════════════════════════════════════

const AVISO = {
  numero: 7,
  tenantSlug: "aumenta",
  tenantNombre: "Aumenta",
  usuarioNombre: "Rodrigo",
  usuarioEmail: "rodrigo@aumenta.es",
  usuarioRol: "admin",
  tipo: "error",
  pantalla: "/clientes/urgentes",
  bloquea: true,
  asunto: "No carga la ficha",
  cuerpo: "Al abrir una ficha se queda cargando para siempre.",
};

describe("avisoParaNosotros", () => {
  it("el asunto lleva referencia, cliente y el asunto que escribió", () => {
    assert.equal(
      avisoParaNosotros({ aviso: AVISO, url: "https://x/admin/buzon/7" }).subject,
      "AV-0007 · Aumenta: No carga la ficha"
    );
  });

  it("la referencia se CALCULA del número cuando la fila no trae `ref`", () => {
    // El fallo real: a veces llega la fila del ORM (sin `ref`) y a veces el
    // objeto ya serializado (con `ref`). Leerlo a secas mandó un correo con
    // «· undefined» en el asunto, visto en producción el 13/08/2026.
    const { subject } = avisoParaNosotros({ aviso: AVISO, url: "u" });
    assert.ok(!subject.includes("undefined"));
    assert.ok(subject.startsWith("AV-0007"));
  });

  it("si la fila ya trae `ref`, manda esa", () => {
    const { subject } = avisoParaNosotros({ aviso: { ...AVISO, ref: "AV-0099" }, url: "u" });
    assert.ok(subject.startsWith("AV-0099"));
  });

  it("sin número, la referencia son interrogantes (nunca «undefined»)", () => {
    const { subject, text } = avisoParaNosotros({ aviso: { ...AVISO, numero: null }, url: "u" });
    assert.ok(subject.startsWith("AV-????"));
    assert.ok(text.startsWith("AV-????"));
  });

  it("quién, tipo y pantalla salen en las dos versiones", () => {
    const tpl = avisoParaNosotros({ aviso: AVISO, url: "https://x/admin/buzon/7" });
    enLasDosVersiones(tpl, ["Aumenta", "Rodrigo", "error", "/clientes/urgentes"]);
  });

  it("si le bloquea, el texto lo grita; si no, no lo menciona", () => {
    const bloquea = avisoParaNosotros({ aviso: AVISO, url: "u" });
    assert.ok(bloquea.text.includes("LE BLOQUEA"));
    assert.ok(loQueSeLee(bloquea.html).includes("Le bloquea Sí"));

    const no = avisoParaNosotros({ aviso: { ...AVISO, bloquea: false }, url: "u" });
    assert.ok(!no.text.includes("LE BLOQUEA"));
    assert.ok(loQueSeLee(no.html).includes("Le bloquea No"));
  });

  it("sin nombre cae al email, y sin email a «alguien»", () => {
    const conEmail = avisoParaNosotros({ aviso: { ...AVISO, usuarioNombre: null }, url: "u" });
    assert.ok(conEmail.text.includes("rodrigo@aumenta.es"));

    const anonimo = avisoParaNosotros({
      aviso: { ...AVISO, usuarioNombre: null, usuarioEmail: null, usuarioRol: null },
      url: "u",
    });
    assert.ok(anonimo.text.includes("alguien"));
    assert.ok(!anonimo.text.includes("undefined"));
  });

  it("sin pantalla, lo dice con palabras", () => {
    const tpl = avisoParaNosotros({ aviso: { ...AVISO, pantalla: null }, url: "u" });
    enLasDosVersiones(tpl, ["no la dijo"]);
  });

  it("sin nombre de cliente usa el slug", () => {
    const tpl = avisoParaNosotros({ aviso: { ...AVISO, tenantNombre: null }, url: "u" });
    assert.ok(tpl.subject.includes("aumenta"));
    assert.ok(tpl.text.includes("aumenta"));
  });

  it("un cuerpo largo se recorta a 400 y se remata con puntos suspensivos", () => {
    const largo = "x".repeat(500);
    const tpl = avisoParaNosotros({ aviso: { ...AVISO, cuerpo: largo }, url: "u" });
    assert.ok(tpl.html.includes(`${"x".repeat(400)}…`));
    assert.ok(!tpl.html.includes("x".repeat(401)));
    assert.ok(tpl.text.includes(`${"x".repeat(400)}…`));
  });

  it("un asunto largo se recorta a 60 SOLO en la línea de asunto", () => {
    const asunto = "y".repeat(80);
    const tpl = avisoParaNosotros({ aviso: { ...AVISO, asunto }, url: "u" });
    assert.ok(tpl.subject.endsWith(`${"y".repeat(60)}…`));
    assert.ok(tpl.html.includes("y".repeat(80)), "el título del correo no debería ir recortado");
  });

  it("el enlace al buzón sale entero y con los & escapados", () => {
    const tpl = avisoParaNosotros({ aviso: AVISO, url: "https://admin.x/admin/buzon/7?a=1&b=2" });
    assert.ok(tpl.html.includes('href="https://admin.x/admin/buzon/7?a=1&amp;b=2"'));
    assert.ok(tpl.text.includes("https://admin.x/admin/buzon/7?a=1&b=2"));
  });

  it("va con NUESTRA marca y firmado por NOSOTROS, nunca por el cliente que escribe", () => {
    // Este correo entra en NUESTRO buzón. Si alguien cablea aquí el nombre o
    // los colores del cliente que escribe, el aviso pasa a parecer suyo y
    // deja de distinguirse de los que le mandamos a él. Por eso el aviso
    // llega CON marca y aun así el correo tiene que salir en verde: no se
    // comprueba «que haya verde», se comprueba que la del cliente no entra.
    const tpl = avisoParaNosotros({
      aviso: { ...AVISO, brand: { primaryColor: "#FF1F96" } },
      url: "u",
    });
    assert.equal(barraDeMarca(tpl.html), VERDE);
    assert.equal(remitenteDe(tpl.html), "Salamandra Solutions");
    assert.ok(tpl.html.includes("Buzón de Salamandra Solutions."));
  });

  it("un nombre o un asunto con HTML dentro se escapan", () => {
    const tpl = avisoParaNosotros({
      aviso: { ...AVISO, usuarioNombre: HOSTIL, asunto: HOSTIL, cuerpo: HOSTIL },
      url: "u",
    });
    nadaDeHtmlCrudo(tpl.html);
  });

  // SOSPECHOSO — con el asunto vacío queda «AV-0007 · Aumenta: » con los dos
  // puntos colgando. El endpoint del buzón exige asunto, así que hoy no pasa;
  // se fija para que si algún día se relaja la validación, se vea aquí.
  it("con el asunto vacío quedan dos puntos colgando en el asunto // SOSPECHOSO", () => {
    const { subject } = avisoParaNosotros({ aviso: { ...AVISO, asunto: "" }, url: "u" });
    assert.equal(subject, "AV-0007 · Aumenta: ");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// configuracion/cambioAplicado.js — el recibo de un cambio de configuración
// ════════════════════════════════════════════════════════════════════════════

const CUANDO = new Date("2026-08-21T09:30:00.000Z"); // 11:30 en Madrid
const CUANDO_TEXTO = "21 de agosto de 2026 a las 11:30";

describe("cambioConfiguracionTemplate: el asunto cambia si hay credenciales", () => {
  it("con credenciales, el asunto lo dice", () => {
    const tpl = cambioConfiguracionTemplate({
      tenantName: "T",
      after: { credenciales: { anthropicApiKey: "puesta" } },
      cuando: CUANDO,
    });
    assert.equal(tpl.subject, "Se han modificado credenciales de tu cuenta");
    assert.ok(tpl.html.includes("Credenciales modificadas"));
  });

  it("sin credenciales, el asunto es el suave", () => {
    const tpl = cambioConfiguracionTemplate({ tenantName: "T", after: { name: "Nuevo" }, cuando: CUANDO });
    assert.equal(tpl.subject, "Se ha modificado la configuración de tu cuenta");
    assert.ok(tpl.html.includes("Configuración modificada"));
  });
});

describe("cambioConfiguracionTemplate: qué cuenta y cómo lo cuenta", () => {
  const COMPLETO = {
    tenantName: "Nutri Laura",
    before: { name: "Antiguo", aiAccess: false, "brand.primaryColor": "" },
    after: {
      credenciales: { anthropicApiKey: "puesta", stripeSecretKey: "borrada", resendApiKey: "cambiada" },
      name: "Nuevo",
      aiAccess: true,
      "brand.primaryColor": "#124A55",
    },
    autor: "laura@nutri.es",
    cuando: CUANDO,
    contacto: "hola@salamandrasolutions.com",
  };

  it("traduce las claves del código a nombres que entiende un cliente", () => {
    const tpl = cambioConfiguracionTemplate(COMPLETO);
    enLasDosVersiones(tpl, [
      "Clave de IA (Anthropic)",
      "Clave secreta de Stripe (cobros)",
      "Clave de envío de correo",
      "Nombre del negocio",
      "Acceso del equipo a la IA",
      "Color principal",
    ]);
    assert.ok(!tpl.text.includes("anthropicApiKey"));
    assert.ok(!tpl.html.includes("anthropicApiKey"));
  });

  it("traduce las tres acciones sobre una credencial", () => {
    const tpl = cambioConfiguracionTemplate(COMPLETO);
    assert.ok(tpl.text.includes("Clave de IA (Anthropic): se ha configurado"));
    assert.ok(tpl.text.includes("Clave secreta de Stripe (cobros): se ha eliminado"));
    assert.ok(tpl.text.includes("Clave de envío de correo: se ha sustituido"));
  });

  it("una clave que no está en la tabla de nombres sale tal cual, no como «undefined»", () => {
    const tpl = cambioConfiguracionTemplate({
      tenantName: "T",
      after: { credenciales: { loQueSea: "inventada" }, campoNuevo: "x" },
      cuando: CUANDO,
    });
    assert.ok(tpl.text.includes("loQueSea: inventada"));
    assert.ok(tpl.text.includes("campoNuevo: (vacío) → x"));
    assert.ok(!tpl.text.includes("undefined"));
  });

  it("los booleanos y los vacíos se cuentan en cristiano, con antes → después", () => {
    const tpl = cambioConfiguracionTemplate(COMPLETO);
    assert.ok(tpl.text.includes("Acceso del equipo a la IA: desactivado → activado"));
    assert.ok(tpl.text.includes("Color principal: (vacío) → #124A55"));
    assert.ok(tpl.text.includes("Nombre del negocio: Antiguo → Nuevo"));
  });

  it("un valor que antes no existía se cuenta como (vacío)", () => {
    const tpl = cambioConfiguracionTemplate({ tenantName: "T", after: { name: "X" }, cuando: CUANDO });
    assert.ok(tpl.text.includes("Nombre del negocio: (vacío) → X"));
  });

  it("NUNCA lleva el valor de una credencial, solo qué pasó con ella", () => {
    const tpl = cambioConfiguracionTemplate({
      tenantName: "T",
      after: { credenciales: { anthropicApiKey: "puesta" } },
      cuando: CUANDO,
    });
    assert.ok(tpl.html.includes("no incluimos el valor de ninguna credencial"));
    assert.ok(tpl.text.includes("no incluimos el valor de ninguna credencial"));
  });

  it("sin credenciales, el aviso amarillo no se pinta", () => {
    const tpl = cambioConfiguracionTemplate({ tenantName: "T", after: { name: "X" }, cuando: CUANDO });
    assert.ok(!tpl.html.includes("no incluimos el valor"));
    assert.ok(!tpl.text.includes("no incluimos el valor"));
  });

  it("si se sabe quién lo hizo, se dice; si no, no queda un «Lo hizo:» a medias", () => {
    const con = cambioConfiguracionTemplate({ ...COMPLETO });
    enLasDosVersiones(con, ["laura@nutri.es"]);

    const sin = cambioConfiguracionTemplate({ ...COMPLETO, autor: null });
    assert.ok(!sin.html.includes("Lo hizo"));
    assert.ok(!sin.text.includes("Lo hizo"));
  });

  it("con contacto, manda escribir ahí; sin contacto, responder al correo", () => {
    const con = cambioConfiguracionTemplate({ ...COMPLETO });
    assert.ok(con.html.includes('href="mailto:hola@salamandrasolutions.com"'));
    assert.ok(con.text.includes("escríbenos a hola@salamandrasolutions.com cuanto antes"));

    const sin = cambioConfiguracionTemplate({ ...COMPLETO, contacto: null });
    assert.ok(!sin.html.includes("mailto:"));
    assert.ok(sin.text.includes("responde a este correo cuanto antes"));
  });

  it("la fecha va en hora de Madrid y sale en las dos versiones", () => {
    const tpl = cambioConfiguracionTemplate(COMPLETO);
    enLasDosVersiones(tpl, [CUANDO_TEXTO]);
  });

  it("el preheader cuenta los cambios, con el plural bien puesto", () => {
    const uno = cambioConfiguracionTemplate({ tenantName: "T", after: { name: "X" }, cuando: CUANDO });
    assert.equal(preheaderDe(uno.html), `1 cambio el ${CUANDO_TEXTO}.`);

    const varios = cambioConfiguracionTemplate(COMPLETO);
    assert.equal(preheaderDe(varios.html), `6 cambios el ${CUANDO_TEXTO}.`);
  });

  it("el nombre del negocio, el autor y los VALORES que cambian se escapan", () => {
    // El valor va en la columna derecha de la tabla, y lo escribe una persona:
    // el nombre del negocio, el remitente del correo, un color de marca. Sin
    // el `escapeHtml(l.detalle)` ese HTML sale crudo a la bandeja de un
    // administrador desde nuestro dominio verificado.
    const tpl = cambioConfiguracionTemplate({
      tenantName: HOSTIL,
      before: { name: "antes" },
      after: { name: HOSTIL, resendFromEmail: HOSTIL },
      autor: HOSTIL,
      contacto: HOSTIL,
      cuando: CUANDO,
    });
    nadaDeHtmlCrudo(tpl.html);
    assert.ok(tpl.html.includes("antes → &lt;script&gt;"), "el valor nuevo no salió escapado");
  });

  it("sin `before` ni `after` no revienta: sale el recibo sin líneas", () => {
    const tpl = cambioConfiguracionTemplate({ tenantName: "T", cuando: CUANDO });
    assert.equal(tpl.subject, "Se ha modificado la configuración de tu cuenta");
    assert.equal(preheaderDe(tpl.html), `0 cambios el ${CUANDO_TEXTO}.`);
    assert.ok(!tpl.text.includes("undefined"));
  });

  // SOSPECHOSO — `hayCredenciales` es `!!credenciales`, y un objeto vacío es
  // verdadero: el asunto alarma con «Se han modificado credenciales» y debajo
  // no hay ni una línea. Los dos endpoints que la llaman ya evitan mandar
  // `credenciales` si no hay ninguna, así que hoy no ocurre.
  it("`credenciales: {}` alarma en el asunto sin nada que contar // SOSPECHOSO", () => {
    const tpl = cambioConfiguracionTemplate({ tenantName: "T", after: { credenciales: {} }, cuando: CUANDO });
    assert.equal(tpl.subject, "Se han modificado credenciales de tu cuenta");
    assert.equal(preheaderDe(tpl.html), `0 cambios el ${CUANDO_TEXTO}.`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// nutricion/menuEmail.js — la pauta en PDF para la paciente
// ════════════════════════════════════════════════════════════════════════════

describe("menuEmail", () => {
  const PAUTA = { tenantName: "Nutri Laura", clientName: "Ana", planName: "Pauta de verano" };

  it("el asunto lleva el centro", () => {
    assert.equal(menuEmail(PAUTA).subject, "Tu pauta nutricional — Nutri Laura");
  });

  it("nombre y pauta salen en las dos versiones, y la pauta también en el avance", () => {
    enLasDosVersiones(menuEmail(PAUTA), ["Hola Ana,", "Pauta de verano"]);
    // El avance es la línea que la paciente ve en la bandeja sin abrir nada:
    // si se queda sin el nombre de la pauta, no distingue un correo de otro.
    assert.equal(preheaderDe(menuEmail(PAUTA).html), "Tu pauta &quot;Pauta de verano&quot; en PDF adjunto");
  });

  it("sin nombre saluda igual, sin dejar un hueco", () => {
    for (const clientName of [undefined, null, ""]) {
      const tpl = menuEmail({ ...PAUTA, clientName });
      assert.ok(tpl.text.startsWith("Hola,"));
      assert.ok(loQueSeLee(tpl.html).includes("Hola,"));
      assert.ok(!tpl.html.includes("Hola ,"));
    }
  });

  it("la pauta también sale como dato clave en su tabla", () => {
    const html = menuEmail(PAUTA).html;
    assert.ok(html.includes("Pauta"));
    assert.ok(html.includes("border-radius:10px"), "no se dibujó la tabla de datos");
  });

  it("dice que la pauta es personal e intransferible (lo lee la paciente)", () => {
    assert.ok(loQueSeLee(menuEmail(PAUTA).html).includes("personal e intransferible"));
  });

  it("la marca de Laura llega al correo; sin marca, verde Salamandra", () => {
    assert.equal(barraDeMarca(menuEmail({ ...PAUTA, brand: { primaryColor: "#7FA97B" } }).html), "#7FA97B");
    assert.equal(barraDeMarca(menuEmail(PAUTA).html), VERDE);
  });

  it("un nombre o una pauta con HTML dentro se escapan (incluido el preheader)", () => {
    const tpl = menuEmail({ ...PAUTA, clientName: HOSTIL, planName: HOSTIL });
    nadaDeHtmlCrudo(tpl.html);
    assert.ok(!preheaderDe(tpl.html).includes("<script"));
  });

  it("comillas y ampersands en el nombre de la pauta no rompen el HTML", () => {
    const tpl = menuEmail({ ...PAUTA, planName: 'Pauta "verano" & sol' });
    assert.ok(tpl.html.includes("Pauta &quot;verano&quot; &amp; sol"));
    assert.ok(tpl.text.includes('Pauta "verano" & sol'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// soporte/ticketClient.js — al cliente final del tenant
// ════════════════════════════════════════════════════════════════════════════

const TICKET = {
  tenantName: "Aumenta",
  ticketRef: "SOP-0012",
  title: "No me llega la factura",
  portalUrl: "https://soporte.x/t/abc?k=1&z=2",
};

describe("ticketClientTemplate: una variante por `kind`", () => {
  it("created / reply / resolved tienen su asunto y su titular", () => {
    const esperado = {
      created: ["SOP-0012 — Hemos recibido tu solicitud", "Hemos recibido tu solicitud"],
      reply: ["SOP-0012 — Nueva respuesta a tu solicitud", "Tienes una respuesta"],
      resolved: ["SOP-0012 — Tu solicitud está resuelta", "Solicitud resuelta"],
    };
    for (const [kind, [subject, titular]] of Object.entries(esperado)) {
      const tpl = ticketClientTemplate({ ...TICKET, kind });
      assert.equal(tpl.subject, subject);
      assert.ok(tpl.html.includes(titular), `${kind}: falta «${titular}» en el HTML`);
      assert.ok(tpl.text.startsWith(titular), `${kind}: el texto plano no empieza por «${titular}»`);
    }
  });

  it("un `kind` que no existe (o ninguno) cae en la variante genérica, no en blanco", () => {
    for (const kind of ["loquesea", undefined, null, ""]) {
      const tpl = ticketClientTemplate({ ...TICKET, kind });
      assert.equal(tpl.subject, "SOP-0012 — Actualización de tu solicitud");
      assert.ok(tpl.html.includes("Actualización de tu solicitud"));
    }
  });

  it("número y asunto salen en las dos versiones, en todas las variantes", () => {
    for (const kind of ["created", "reply", "resolved", "otro"]) {
      enLasDosVersiones(ticketClientTemplate({ ...TICKET, kind }), ["SOP-0012", "No me llega la factura"]);
    }
  });
});

describe("ticketClientTemplate: los condicionales del cuerpo", () => {
  it("la respuesta solo se pega en el `kind` reply, y respetando los saltos de línea", () => {
    const con = ticketClientTemplate({ ...TICKET, kind: "reply", replyBody: "Primera\nSegunda" });
    assert.ok(con.html.includes("white-space:pre-wrap"));
    assert.ok(con.html.includes("Primera\nSegunda"));
    assert.ok(con.text.includes("Respuesta:\nPrimera\nSegunda"));

    const otro = ticketClientTemplate({ ...TICKET, kind: "created", replyBody: "Primera" });
    assert.ok(!otro.html.includes("Primera"));
    assert.ok(!otro.text.includes("Primera"));
  });

  it("`kind` reply sin respuesta no deja la cita vacía", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "reply" });
    assert.ok(!tpl.html.includes("white-space:pre-wrap"));
    assert.ok(!tpl.text.includes("Respuesta:"));
  });

  it("con reply-to útil invita a responder al correo y el botón cambia de texto", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "created", canReplyByEmail: true });
    assert.ok(loQueSeLee(tpl.html).includes("responder directamente a este correo"));
    assert.ok(tpl.text.includes("Puedes responder directamente a este correo."));
    assert.ok(tpl.html.includes("O verla en el portal"));
  });

  it("sin reply-to útil, el único camino de vuelta es el botón del portal", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "created" });
    assert.ok(!tpl.html.includes("responder directamente"));
    assert.ok(!tpl.text.includes("responder directamente"));
    assert.ok(tpl.html.includes("Ver mi solicitud y responder"));
  });

  it("sin portalUrl no hay botón ni línea de enlace", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "created", portalUrl: null });
    assert.ok(!tpl.html.includes("Ver mi solicitud"));
    assert.ok(!tpl.text.includes("Ver en el portal"));
  });

  it("el enlace del portal sale entero, con los & escapados en el HTML", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "created" });
    assert.ok(tpl.html.includes('href="https://soporte.x/t/abc?k=1&amp;z=2"'));
    assert.ok(tpl.text.includes("https://soporte.x/t/abc?k=1&z=2"));
  });

  it("avisa de que el enlace de seguimiento es personal", () => {
    assert.ok(loQueSeLee(ticketClientTemplate({ ...TICKET, kind: "created" }).html).includes("no lo compartas"));
  });

  it("el asunto del ticket y la respuesta se escapan", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "reply", title: HOSTIL, replyBody: HOSTIL });
    nadaDeHtmlCrudo(tpl.html);
  });

  it("la marca del tenant tiñe la barra y también el borde de la respuesta citada", () => {
    const tpl = ticketClientTemplate({ ...TICKET, kind: "reply", replyBody: "x", brand: { primaryColor: "#FF1F96" } });
    assert.equal(barraDeMarca(tpl.html), "#FF1F96");
    assert.ok(tpl.html.includes("border-left:3px solid #FF1F96"));
  });

  it("una marca que no es un color no tiñe el borde: cae al verde", () => {
    const tpl = ticketClientTemplate({
      ...TICKET,
      kind: "reply",
      replyBody: "x",
      brand: { primaryColor: 'red" onclick="alert(1)' },
    });
    assert.ok(tpl.html.includes(`border-left:3px solid ${VERDE}`));
    assert.ok(!tpl.html.includes("onclick"));
  });

  // SOSPECHOSO — el borde de la respuesta valida el color con una regex propia
  // que SOLO acepta hex, mientras el layout acepta además rgb(), rgba() y los
  // nombres CSS. Un tenant con la marca escrita como nombre o como rgb() ve la
  // barra de arriba de su color y el borde en verde Salamandra. Es cosmético y
  // falla del lado seguro, así que se fija tal cual en vez de tocarlo.
  it("un color rgb() o un nombre CSS tiñen la barra pero NO el borde // SOSPECHOSO", () => {
    for (const color of ["rebeccapurple", "rgb(255, 31, 150)"]) {
      const tpl = ticketClientTemplate({ ...TICKET, kind: "reply", replyBody: "x", brand: { primaryColor: color } });
      assert.equal(barraDeMarca(tpl.html), color);
      assert.ok(tpl.html.includes(`border-left:3px solid ${VERDE}`));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// soporte/ticketTeam.js — aviso interno al equipo del tenant
// ════════════════════════════════════════════════════════════════════════════

const INTERNO = {
  tenantName: "Aumenta",
  ticketRef: "SOP-0033",
  title: "Duda con una factura",
  requester: "Marta Ruiz",
  dashboardUrl: "https://crm.x/soporte/33",
};

describe("ticketTeamTemplate", () => {
  it("las tres variantes tienen su asunto y su titular", () => {
    const esperado = {
      new_portal: ["SOP-0033 — Nuevo ticket desde el portal", "Nuevo ticket de soporte"],
      assigned: ["SOP-0033 — Ticket asignado a ti", "Te han asignado un ticket"],
      client_reply: ["SOP-0033 — El cliente ha respondido", "Respuesta del cliente"],
    };
    for (const [kind, [subject, titular]] of Object.entries(esperado)) {
      const tpl = ticketTeamTemplate({ ...INTERNO, kind });
      assert.equal(tpl.subject, subject);
      assert.ok(tpl.html.includes(titular));
      assert.ok(tpl.text.startsWith(titular));
    }
  });

  it("un `kind` desconocido cae en la variante genérica", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "zzz" });
    assert.equal(tpl.subject, "SOP-0033 — Actividad en el ticket");
    assert.ok(tpl.html.includes("Actividad en un ticket"));
  });

  it("quién escribe sale en new_portal y en client_reply", () => {
    for (const kind of ["new_portal", "client_reply"]) {
      assert.ok(ticketTeamTemplate({ ...INTERNO, kind }).html.includes("Marta Ruiz"));
    }
  });

  it("sin quién, cada variante pone su propio comodín", () => {
    assert.ok(ticketTeamTemplate({ ...INTERNO, kind: "new_portal", requester: null }).html.includes("Alguien"));
    assert.ok(ticketTeamTemplate({ ...INTERNO, kind: "client_reply", requester: null }).html.includes("El cliente"));
  });

  it("número y asunto salen en las dos versiones", () => {
    enLasDosVersiones(ticketTeamTemplate({ ...INTERNO, kind: "new_portal" }), ["SOP-0033", "Duda con una factura"]);
  });

  it("el avance del mensaje se recorta a 200: el contenido entero vive en el CRM", () => {
    const largo = "P".repeat(250);
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "new_portal", preview: largo });
    assert.ok(tpl.html.includes(`${"P".repeat(200)}…`));
    assert.ok(!tpl.html.includes("P".repeat(201)));
    assert.ok(tpl.text.includes("P".repeat(200)));
    assert.ok(!tpl.text.includes("P".repeat(201)));
  });

  it("un avance corto no lleva puntos suspensivos", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "new_portal", preview: "Buenas, una duda" });
    assert.ok(!tpl.html.includes("…"));
    enLasDosVersiones(tpl, ["Buenas, una duda"]);
  });

  it("sin avance no se dibuja la caja", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "assigned" });
    assert.ok(!tpl.html.includes("white-space:pre-wrap"));
  });

  it("sin enlace al CRM no hay botón ni línea", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "assigned", dashboardUrl: null });
    assert.ok(!tpl.html.includes("Abrir en el CRM"));
    assert.ok(!tpl.text.includes("Abrir en el CRM"));
  });

  it("el pie deja claro que es un aviso interno del CRM", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "new_portal" });
    assert.ok(loQueSeLee(tpl.html).includes("Aviso interno del CRM de Aumenta."));
    assert.ok(tpl.text.trimEnd().endsWith("— CRM Aumenta"));
  });

  it("quién, asunto y avance se escapan", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "new_portal", requester: HOSTIL, title: HOSTIL, preview: HOSTIL });
    nadaDeHtmlCrudo(tpl.html);
  });

  // Estaba fijado como borde tolerado desde el 21/08 («cosmético»); triado el
  // 24/08/2026 y arreglado, porque la entrada llega a diario: el `preview` es
  // el texto del formulario PÚBLICO de soporte, que acepta hasta 8.000
  // caracteres, así que pasar de 200 es lo normal en una incidencia. Sin el
  // remate, quien lee en texto plano ve un mensaje cortado a mitad de frase
  // creyendo que está entero — el fallo «se toca el HTML y se olvida el text»
  // que vigila la cabecera de este fichero.
  it("el recorte avisa de que ha cortado en LAS DOS versiones, no solo en el html", () => {
    const tpl = ticketTeamTemplate({ ...INTERNO, kind: "new_portal", preview: "P".repeat(250) });
    assert.ok(tpl.html.includes("…"), "el html ya remataba");
    assert.ok(tpl.text.includes("…"), "y ahora el texto plano también");
    assert.ok(tpl.text.includes(`${"P".repeat(200)}…`), "el corte sigue siendo a 200, con el remate detrás");
  });

  it("un preview que cabe entero no se remata: el «…» solo aparece si se ha cortado", () => {
    const corto = ticketTeamTemplate({ ...INTERNO, kind: "new_portal", preview: "P".repeat(200) });
    assert.ok(!corto.text.includes("…"), "200 justos caben: no hay nada que anunciar");
    assert.ok(corto.text.includes("P".repeat(200)));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Lo transversal: ninguna se cae, y ninguna deja pasar HTML de un dato
// ════════════════════════════════════════════════════════════════════════════

describe("las seis plantillas, en seco", () => {
  const TODAS = [
    ["invoiceSent", () => invoiceSentTemplate({})],
    ["avisoNuevo", () => avisoParaNosotros({ aviso: {} })],
    ["cambioAplicado", () => cambioConfiguracionTemplate({})],
    ["menuEmail", () => menuEmail({})],
    ["ticketClient", () => ticketClientTemplate({})],
    ["ticketTeam", () => ticketTeamTemplate({})],
  ];

  for (const [nombre, llamar] of TODAS) {
    it(`${nombre}: sin ningún dato devuelve {subject, html, text} y no revienta`, () => {
      const tpl = llamar();
      assert.equal(typeof tpl.subject, "string");
      assert.equal(typeof tpl.html, "string");
      assert.equal(typeof tpl.text, "string");
      assert.ok(tpl.html.startsWith("<!doctype html>"));
      // Sin marca, todas caen a la paleta Salamandra: es el caso de un tenant
      // recién dado de alta, que aún no tiene `settings.brand`.
      assert.equal(barraDeMarca(tpl.html), VERDE);
    });
  }

  const CON_MARCA = [
    ["invoiceSent", (brand) => invoiceSentTemplate({ tenantName: "T", invoiceNumber: "F-1", total: "1 €", brand })],
    ["cambioAplicado", (brand) => cambioConfiguracionTemplate({ tenantName: "T", after: { name: "X" }, brand })],
    ["menuEmail", (brand) => menuEmail({ tenantName: "T", planName: "P", brand })],
    ["ticketClient", (brand) => ticketClientTemplate({ tenantName: "T", kind: "created", ticketRef: "R", title: "T", brand })],
    ["ticketTeam", (brand) => ticketTeamTemplate({ tenantName: "T", kind: "assigned", ticketRef: "R", title: "T", brand })],
  ];

  for (const [nombre, llamar] of CON_MARCA) {
    it(`${nombre}: pasa la marca del tenant al layout, y una marca envenenada no sale`, () => {
      assert.equal(barraDeMarca(llamar({ primaryColor: "#124A55" }).html), "#124A55");
      const sucia = llamar({ primaryColor: '#fff"><a href="http://malo.example">x</a><b y="' });
      assert.equal(barraDeMarca(sucia.html), VERDE);
      assert.ok(!sucia.html.includes("malo.example"));
    });
  }
});
