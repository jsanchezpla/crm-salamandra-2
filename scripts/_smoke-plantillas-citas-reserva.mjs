// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-plantillas-citas-reserva.mjs — los cinco correos del ciclo de una cita
 * (21/08/2026).
 *
 *   node --test scripts/_smoke-plantillas-citas-reserva.mjs
 *   node --test-name-pattern="bono" scripts/_smoke-plantillas-citas-reserva.mjs
 *
 * Cubre las cinco plantillas de `lib/email/templates/citas/`: la solicitud
 * recibida, la confirmación, el rechazo, la cancelación y el cambio de fecha.
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Estos cinco ficheros son lo ÚLTIMO que ve el paciente, y son también el sitio
 * del CRM donde más veces se ha arreglado algo por una llamada de teléfono:
 *
 *   · 06/08/2026 — cancelar o rechazar la sesión de un BONO mandaba un correo
 *     que solo hablaba de esa cita. Quien acababa de pagar diez sesiones lo leía
 *     como que le habían cancelado la compra. De ahí sale `esBono` y su párrafo
 *     «tu programa sigue activo». El 20/08 se decidió que salga también desde el
 *     panel de la cita (`lib/citas/notificarCancelacion.js` es hoy la única vía).
 *   · 10/08/2026 — el motivo de la cancelación, el enlace de videollamada y la
 *     dirección iban CRUDOS dentro del HTML. Los teclea una persona en el CRM y
 *     salen disparados al correo del paciente desde el dominio verificado del
 *     centro; un «<» mal puesto rompía el mensaje y un pegado de cualquier sitio
 *     podía meter marcado. La versión de texto plano NO se escapa, y no debe.
 *   · el correo de confirmación decía exactamente lo mismo se hubiera cobrado o
 *     no. Quien acababa confirmado SIN cobro se presentaba dando por hecho que
 *     estaba pagado y se enteraba en el mostrador.
 *   · 03/08/2026 — mover una cita de día no escribía a NADIE. Por eso el correo
 *     de cambio enseña LAS DOS fechas: decir solo la nueva obliga a recordar cuál
 *     era la anterior para entender qué ha pasado.
 *
 * Nada de eso tenía prueba. `_smoke-checkpoint2-emails.mjs` renderiza tres de
 * las cinco, pero solo las manda en seco y no comprueba una sola letra de lo que
 * sale: si mañana el párrafo del bono desaparece, o el motivo vuelve a salir sin
 * escapar, o el texto plano se queda atrás respecto al HTML, sigue todo verde.
 *
 * ── QUÉ FIJA ───────────────────────────────────────────────────────────────
 *
 * Lo que DEVUELVEN: el asunto, y que `html` y `text` cuenten LO MISMO. Los
 * condicionales («si es bono, di X»; «si se cobró, di cuánto») se prueban por
 * los dos lados: que aparecen cuando toca y que CALLAN cuando no toca. Y que
 * nada de lo que teclea una persona —nombre, servicio, motivo, dirección,
 * enlace— sale del HTML sin escapar.
 *
 * Los importes van EN CÉNTIMOS (así lo guarda `Booking.amount`): 3500 tiene que
 * salir «35,00 €», no «3.500,00 €». Ese factor 100 solo se ve mirando lo que
 * imprime.
 *
 * Y dos cosas que se comprueban aparte porque, mirando el correo entero, se
 * escapan: la FECHA (día de la semana, fecha larga y hora, con una cita de
 * madrugada que cae en días distintos en Madrid y en UTC — sin eso, cambiar la
 * zona horaria y citar a alguien dos horas antes pasa desapercibido) y el
 * RECUADRO DE DATOS, esa tabla de etiqueta y valor que es lo que se lee de un
 * vistazo desde el móvil; el servicio sale además en el saludo y la fecha en el
 * preheader, así que buscar el texto por el HTML da verde aunque la tabla entera
 * haya desaparecido.
 *
 * LÍMITE CONOCIDO: si a `formatDate` de la confirmación le quitan el `timeZone`
 * entero, esta prueba solo lo caza en una máquina que NO esté en Madrid (en el
 * VPS, sí). Forzar la zona del proceso pediría tocar el entorno, y eso la
 * convertiría en pesada y dejaría de lanzarse.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bookingReceivedTemplate } from "../lib/email/templates/citas/bookingReceived.js";
import { bookingConfirmedTemplate } from "../lib/email/templates/citas/bookingConfirmed.js";
import { bookingRejectedTemplate } from "../lib/email/templates/citas/bookingRejected.js";
import { bookingCancelledTemplate } from "../lib/email/templates/citas/bookingCancelled.js";
import { bookingRescheduledTemplate } from "../lib/email/templates/citas/bookingRescheduled.js";

// ── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Un espacio es un espacio: el € de `toLocaleString` viene pegado con un espacio
 * duro (U+00A0) y los saltos de línea del texto plano no son comparables con la
 * sangría del HTML. Se aplana todo antes de comparar.
 */
const norm = (s) =>
  String(s)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.:;!?])/g, "$1")
    .trim();

/** El HTML leído como lo lee una persona: sin etiquetas y sin entidades. */
const plano = (html) =>
  norm(
    String(html)
      .replace(/<[^>]*>/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
  );

/** La frase tiene que estar en las DOS versiones, o el texto plano se quedó atrás. */
function dicenLoMismo(tpl, frase) {
  assert.ok(plano(tpl.html).includes(frase), `el HTML no dice «${frase}»`);
  assert.ok(norm(tpl.text).includes(frase), `el TEXTO PLANO no dice «${frase}»`);
}

/** Y al revés: si el condicional no se cumple, callan los dos. */
function callanLosDos(tpl, frase) {
  assert.ok(!plano(tpl.html).includes(frase), `el HTML dice «${frase}» y no debía`);
  assert.ok(!norm(tpl.text).includes(frase), `el TEXTO PLANO dice «${frase}» y no debía`);
}

/**
 * Una fila de la TABLA DE DATOS del correo, la de etiqueta a la izquierda y
 * valor a la derecha que pinta `renderLayout` a partir de `blocks`. Es el
 * recuadro que el paciente escanea sin leer los párrafos, y hay que mirarlo
 * aparte: el servicio y la fecha también salen en el saludo y en el preheader,
 * así que buscar el texto por el HTML entero da verde aunque la tabla haya
 * desaparecido del todo.
 *
 * @returns {string|null} el valor de esa fila, o null si la fila no está.
 */
function filaDeDatos(html, etiqueta) {
  const m = String(html).match(
    new RegExp(`width:120px;">${etiqueta}</td>\\s*<td[^>]*>([^<]*)</td>`)
  );
  return m ? norm(m[1]) : null;
}

const CUANDO = "2026-08-27T10:30:00.000Z"; // jueves, 27 de agosto de 2026, 12:30 (Madrid)
const OTRA = "2026-09-03T16:00:00.000Z"; // jueves, 03 de septiembre de 2026, 18:00
const FECHA = "jueves, 27 de agosto de 2026, 12:30";
const FECHA_OTRA = "jueves, 03 de septiembre de 2026, 18:00";

// Una hora que cae en días DISTINTOS según la zona: en Madrid (verano, +02:00)
// es el viernes 28 a las 00:30; en UTC seguiría siendo el jueves 27 a las 22:30.
// Con la fecha del mediodía de más arriba las dos zonas dan el mismo día, así
// que un `timeZone` cambiado o quitado pasaría desapercibido. Aquí no.
const MEDIANOCHE = "2026-08-27T22:30:00.000Z";
const FECHA_MEDIANOCHE = "viernes, 28 de agosto de 2026, 00:30";

const BASE = {
  tenantName: "Nutri Laura",
  clientName: "Marta López García",
  eventTypeName: "Primera consulta",
  scheduledAt: CUANDO,
};

/** Lo que teclea una persona y acaba dentro de un correo del centro. */
const VENENO = '<img src=x onerror="alert(1)">Ana';

/** La confirmación pide más datos que las otras cuatro: duración y modalidad. */
const CONF = { ...BASE, tenantName: "Aumenta", duration: 50, modality: "online" };

const LAS_CINCO = [
  ["bookingReceived", (extra) => bookingReceivedTemplate({ ...BASE, ...extra })],
  ["bookingConfirmed", (extra) => bookingConfirmedTemplate({ ...BASE, modality: "phone", ...extra })],
  ["bookingRejected", (extra) => bookingRejectedTemplate({ ...BASE, ...extra })],
  ["bookingCancelled", (extra) => bookingCancelledTemplate({ ...BASE, ...extra })],
  [
    "bookingRescheduled",
    (extra) => bookingRescheduledTemplate({ ...BASE, scheduledAtAnterior: CUANDO, ...extra }),
  ],
];

// ── El contrato común ───────────────────────────────────────────────────────

describe("las cinco devuelven {subject, html, text} y un correo entero", () => {
  for (const [nombre, hacer] of LAS_CINCO) {
    it(`${nombre}: tres claves, HTML completo y con título`, () => {
      const tpl = hacer();
      assert.deepEqual(Object.keys(tpl).sort(), ["html", "subject", "text"]);
      assert.equal(typeof tpl.subject, "string");
      assert.ok(tpl.subject.length > 0, "asunto vacío");
      assert.ok(tpl.html.startsWith("<!doctype html>"), "el HTML no es un documento entero");
      assert.match(tpl.html, /<title>[^<]+<\/title>/);
      assert.ok(tpl.text.length > 0, "texto plano vacío");
    });

    it(`${nombre}: el saludo usa solo el nombre de pila, y la firma el centro`, () => {
      const tpl = hacer();
      dicenLoMismo(tpl, "Hola Marta,");
      callanLosDos(tpl, "Marta López García");
      dicenLoMismo(tpl, "Nutri Laura");
    });

    it(`${nombre}: el servicio y la fecha salen en las dos versiones`, () => {
      const tpl = hacer();
      dicenLoMismo(tpl, "Primera consulta");
      assert.ok(plano(tpl.html).includes("27 de agosto de 2026"), "falta la fecha en el HTML");
      assert.ok(norm(tpl.text).includes("27 de agosto de 2026"), "falta la fecha en el texto");
    });
  }

  it("los cinco asuntos son distintos entre sí (un copiar-pegar se ve aquí)", () => {
    const asuntos = LAS_CINCO.map(([, hacer]) => hacer().subject);
    assert.equal(new Set(asuntos).size, 5, `asuntos repetidos: ${asuntos.join(" · ")}`);
  });

  it("sin nombre de cliente el saludo queda «Hola Hola,», nunca «Hola null»", () => {
    // `clientName` no admite nulos en la base, así que esto es un borde, no el
    // día a día. Se fija el TEXTO EXACTO y no un «empieza por Hola»: sin el
    // literal el saludo sale «Hola ,» —con la coma suelta— y un aserto de
    // «empieza por Hola» lo dejaría pasar sin enterarse.
    for (const [nombre, hacer] of LAS_CINCO) {
      for (const sin of ["", null, undefined]) {
        const tpl = hacer({ clientName: sin });
        assert.equal(norm(tpl.text).split(" ").slice(0, 2).join(" "), "Hola Hola,", `${nombre} con clientName=${sin}`);
        assert.ok(plano(tpl.html).includes("Hola Hola,"), `${nombre}: el HTML saluda distinto`);
        assert.ok(!norm(tpl.text).includes("Hola null"), `${nombre} enseña «null» al paciente`);
        assert.ok(!norm(tpl.text).includes("Hola undefined"), `${nombre} enseña «undefined»`);
      }
    }
  });
});

// ── La fecha, entera y en hora de Madrid ────────────────────────────────────

describe("la fecha sale completa y en hora de Madrid, no en UTC", () => {
  // Lo que el paciente apunta en su agenda. Comprobar solo «27 de agosto de
  // 2026» deja pasar las tres formas de equivocarse que de verdad pasan: que se
  // caiga el día de la semana, que se caiga la hora, y —la peor— que la zona
  // horaria se cambie o se quite y el centro cite a alguien una o dos horas
  // antes de lo que dijo.
  for (const [nombre, hacer] of LAS_CINCO) {
    it(`${nombre}: día de la semana, fecha larga y HORA en las dos versiones`, () => {
      const tpl = hacer();
      for (const trozo of ["jueves", "27 de agosto de 2026", "12:30"]) dicenLoMismo(tpl, trozo);
    });

    it(`${nombre}: una cita de madrugada es del día de Madrid, no del de UTC`, () => {
      const tpl = hacer({ scheduledAt: MEDIANOCHE, scheduledAtAnterior: MEDIANOCHE });
      for (const trozo of ["viernes", "28 de agosto de 2026", "00:30"]) dicenLoMismo(tpl, trozo);
      // Con `timeZone` quitado o puesto en UTC saldría el 27 por la noche.
      callanLosDos(tpl, "27 de agosto");
      callanLosDos(tpl, "22:30");
    });
  }

  it("las cuatro de fecha corrida imprimen la fecha ENTERA de un tirón", () => {
    // bookingConfirmed parte día y hora en dos filas; las otras cuatro la
    // escriben seguida, y así es como se lee.
    for (const hacer of [
      (e) => bookingReceivedTemplate({ ...BASE, ...e }),
      (e) => bookingRejectedTemplate({ ...BASE, ...e }),
      (e) => bookingCancelledTemplate({ ...BASE, ...e }),
      (e) => bookingRescheduledTemplate({ ...BASE, scheduledAtAnterior: CUANDO, ...e }),
    ]) {
      dicenLoMismo(hacer(), FECHA);
      dicenLoMismo(hacer({ scheduledAt: MEDIANOCHE, scheduledAtAnterior: MEDIANOCHE }), FECHA_MEDIANOCHE);
    }
  });
});

// ── La tabla de datos ───────────────────────────────────────────────────────

describe("el recuadro de datos lleva lo que tiene que llevar", () => {
  // Estas filas son lo que se mira de un vistazo desde el móvil. Se comprueban
  // por su fila —etiqueta y valor— y no buscando el texto por el HTML entero,
  // porque el servicio sale además en el saludo y la fecha en el preheader: sin
  // esto, el recuadro entero podía desaparecer y la prueba seguía en verde.
  it("bookingReceived: servicio, fecha propuesta, y la retención solo si la hay", () => {
    const sin = bookingReceivedTemplate(BASE);
    assert.equal(filaDeDatos(sin.html, "Servicio"), "Primera consulta");
    assert.equal(filaDeDatos(sin.html, "Fecha propuesta"), FECHA);
    assert.equal(filaDeDatos(sin.html, "Reservado en tu tarjeta"), null);

    const con = bookingReceivedTemplate({ ...BASE, retenido: 3500 });
    assert.equal(filaDeDatos(con.html, "Reservado en tu tarjeta"), "35,00 € (sin cobrar)");
    // Y el cierre del párrafo tampoco se pierde en la rama de la retención.
    dicenLoMismo(con, "Cuando confirmemos");
  });

  it("bookingConfirmed: servicio, día, hora, duración, modalidad y el dinero", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, importe: 4500, cobro: "cobrada" });
    assert.equal(filaDeDatos(tpl.html, "Servicio"), "Primera consulta");
    assert.equal(filaDeDatos(tpl.html, "Día"), "jueves, 27 de agosto de 2026");
    assert.equal(filaDeDatos(tpl.html, "Hora"), "12:30");
    assert.equal(filaDeDatos(tpl.html, "Duración"), "50 min");
    assert.equal(filaDeDatos(tpl.html, "Modalidad"), "Online (videollamada)");
    assert.equal(filaDeDatos(tpl.html, "Pagado"), "45,00 €");
    assert.equal(filaDeDatos(tpl.html, "Pendiente de pago"), null);

    const deuda = bookingConfirmedTemplate({ ...CONF, importe: 4500, cobro: "sin_cobrar" });
    assert.equal(filaDeDatos(deuda.html, "Pendiente de pago"), "45,00 € · en consulta");
    assert.equal(filaDeDatos(deuda.html, "Pagado"), null);

    const mudo = bookingConfirmedTemplate({ ...CONF, duration: null, importe: 4500, cobro: null });
    assert.equal(filaDeDatos(mudo.html, "Duración"), null);
    assert.equal(filaDeDatos(mudo.html, "Pagado"), null);
    assert.equal(filaDeDatos(mudo.html, "Pendiente de pago"), null);
  });

  it("bookingRejected y bookingCancelled: servicio y fecha, con su rótulo", () => {
    const r = bookingRejectedTemplate(BASE);
    assert.equal(filaDeDatos(r.html, "Servicio"), "Primera consulta");
    assert.equal(filaDeDatos(r.html, "Fecha solicitada"), FECHA);

    const c = bookingCancelledTemplate(BASE);
    assert.equal(filaDeDatos(c.html, "Servicio"), "Primera consulta");
    assert.equal(filaDeDatos(c.html, "Fecha de la cita"), FECHA);
  });

  it("bookingRescheduled: las dos fechas, cada una en su fila", () => {
    const tpl = bookingRescheduledTemplate({ ...BASE, scheduledAtAnterior: CUANDO, scheduledAt: OTRA });
    assert.equal(filaDeDatos(tpl.html, "Servicio"), "Primera consulta");
    assert.equal(filaDeDatos(tpl.html, "Antes era"), FECHA);
    assert.equal(filaDeDatos(tpl.html, "Ahora es"), FECHA_OTRA);
  });
});

// ── Nada sin escapar ────────────────────────────────────────────────────────

describe("lo que teclea una persona no sale del HTML sin escapar", () => {
  for (const [nombre, hacer] of LAS_CINCO) {
    it(`${nombre}: un nombre con «<» se escapa`, () => {
      const { html } = hacer({ clientName: VENENO });
      assert.ok(!html.includes("<img"), "el <img> del nombre entró crudo en el correo");
      assert.ok(html.includes("&lt;img"), "el nombre no aparece escapado");
    });

    it(`${nombre}: un servicio con «<» se escapa`, () => {
      const { html } = hacer({ eventTypeName: "<b>Sesión</b>" });
      assert.ok(!html.includes("<b>Sesión</b>"), "el servicio entró crudo");
      assert.ok(html.includes("&lt;b&gt;Sesi"), "el servicio no aparece escapado");
    });

    it(`${nombre}: el nombre del centro se escapa (lo hace renderLayout)`, () => {
      const { html } = hacer({ tenantName: "Centro <b>X</b>" });
      assert.ok(!html.includes("<b>X</b>"), "el nombre del centro entró crudo");
      assert.ok(html.includes("&lt;b&gt;X&lt;/b&gt;"));
    });
  }

  const CON_MOTIVO = [
    ["bookingRejected", bookingRejectedTemplate, {}],
    ["bookingCancelled", bookingCancelledTemplate, {}],
    ["bookingRescheduled", bookingRescheduledTemplate, { scheduledAtAnterior: CUANDO }],
  ];

  for (const [nombre, hacer, extra] of CON_MOTIVO) {
    it(`${nombre}: el motivo se escapa en el HTML (10/08/2026)`, () => {
      const tpl = hacer({ ...BASE, ...extra, reason: "La profesional <script>alert(1)</script> no está" });
      assert.ok(!tpl.html.includes("<script>"), "el motivo metió un <script> en el correo");
      assert.ok(tpl.html.includes("&lt;script&gt;"), "el motivo no aparece escapado");
    });

    it(`${nombre}: el motivo NO se escapa en el texto plano (ahí no hay HTML que romper)`, () => {
      const tpl = hacer({ ...BASE, ...extra, reason: 'Baja médica & Cía "urgente" <hoy>' });
      assert.ok(tpl.text.includes('Baja médica & Cía "urgente" <hoy>'), "el motivo llega deformado");
      for (const entidad of ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]) {
        assert.ok(!tpl.text.includes(entidad), `el texto plano lleva la entidad ${entidad}`);
      }
    });
  }
});

// ── bookingReceived ─────────────────────────────────────────────────────────

describe("bookingReceived: la solicitud entra en la lista de espera", () => {
  it("asunto y cuerpo dicen que está en cola, no que esté confirmada", () => {
    const tpl = bookingReceivedTemplate(BASE);
    assert.equal(tpl.subject, "Hemos recibido tu solicitud de cita");
    dicenLoMismo(tpl, "Hemos recibido tu solicitud para Primera consulta");
    dicenLoMismo(tpl, "Cuando confirmemos");
    callanLosDos(tpl, "confirmada");
  });

  it("sin retención no se menciona el dinero por ningún lado", () => {
    const tpl = bookingReceivedTemplate(BASE);
    for (const palabra of ["cobrado", "tarjeta", "€"]) callanLosDos(tpl, palabra);
  });

  it("con retención lo dicen las DOS versiones, y el importe va en céntimos", () => {
    // 3500 céntimos = 35,00 €. Si alguien quita el /100, aquí sale 3.500,00 €.
    const tpl = bookingReceivedTemplate({ ...BASE, retenido: 3500 });
    dicenLoMismo(tpl, "Hemos reservado 35,00 € en tu tarjeta para guardarte la hora.");
    assert.ok(
      plano(tpl.html).toLowerCase().includes("todavía no te hemos cobrado nada"),
      "el HTML no avisa de que no se ha cobrado"
    );
    assert.ok(
      norm(tpl.text).toLowerCase().includes("todavía no te hemos cobrado nada"),
      "el texto plano no avisa de que no se ha cobrado"
    );
    callanLosDos(tpl, "3.500,00 €");
  });

  it("con retención el banco queda explicado ANTES de que el paciente lo vea", () => {
    const tpl = bookingReceivedTemplate({ ...BASE, retenido: 3500 });
    // Es el párrafo que evita la llamada: «me han cobrado sin confirmar la cita».
    assert.ok(plano(tpl.html).includes("cargo pendiente"), "el HTML no habla del cargo pendiente");
    assert.ok(norm(tpl.text).includes("cargo pendiente"), "el texto no habla del cargo pendiente");
    dicenLoMismo(tpl, "Solo se te cobrará cuando confirmemos la cita.");
  });

  it("el preheader avisa de la retención solo cuando la hay", () => {
    const con = bookingReceivedTemplate({ ...BASE, retenido: 3500 });
    const sin = bookingReceivedTemplate(BASE);
    assert.ok(con.html.includes("Todavía no te hemos cobrado."), "el preheader no lo dice");
    assert.ok(!sin.html.includes("Todavía no te hemos cobrado."), "el preheader lo dice sin haberlo");
  });

  it("solo un entero de céntimos positivo cuenta como retención", () => {
    // El importe llega de `Booking.amount`, que es INTEGER. Cualquier otra cosa
    // (un 0, un decimal, un string) es un dato roto: mejor callarse que prometer
    // un importe inventado a alguien que mira su banco.
    for (const raro of [0, -100, 3500.5, "3500", null, undefined, NaN, true]) {
      const tpl = bookingReceivedTemplate({ ...BASE, retenido: raro });
      callanLosDos(tpl, "tarjeta");
      callanLosDos(tpl, "€");
    }
    // Y un céntimo sí es un céntimo.
    dicenLoMismo(bookingReceivedTemplate({ ...BASE, retenido: 1 }), "0,01 €");
  });
});

// ── bookingConfirmed ────────────────────────────────────────────────────────

describe("bookingConfirmed: día, hora, modalidad y qué ha pasado con el dinero", () => {
  it("asunto y datos de la cita", () => {
    const tpl = bookingConfirmedTemplate(CONF);
    assert.equal(tpl.subject, "Tu cita está confirmada");
    dicenLoMismo(tpl, "jueves, 27 de agosto de 2026");
    dicenLoMismo(tpl, "12:30");
    dicenLoMismo(tpl, "50 min");
    dicenLoMismo(tpl, "Online (videollamada)");
  });

  it("las tres modalidades tienen su rótulo, y una desconocida se imprime tal cual", () => {
    dicenLoMismo(bookingConfirmedTemplate({ ...CONF, modality: "presencial" }), "Presencial");
    dicenLoMismo(bookingConfirmedTemplate({ ...CONF, modality: "phone" }), "Llamada telefónica");
    dicenLoMismo(bookingConfirmedTemplate({ ...CONF, modality: "online" }), "Online (videollamada)");
    dicenLoMismo(bookingConfirmedTemplate({ ...CONF, modality: "hipnosis" }), "hipnosis");
  });

  it("sin duración no se imprime una línea vacía", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, duration: null });
    callanLosDos(tpl, "Duración");
    callanLosDos(tpl, "null min");
  });

  it("online: el enlace sale en las dos versiones, escapado solo en el HTML", () => {
    const url = "https://meet.example.com/abc?a=1&b=2";
    const tpl = bookingConfirmedTemplate({ ...CONF, meetUrl: url });
    assert.ok(plano(tpl.html).includes(url), "el HTML no enseña el enlace");
    assert.ok(tpl.text.includes(url), "el texto plano no lleva el enlace");
    assert.ok(
      tpl.html.includes('href="https://meet.example.com/abc?a=1&amp;b=2"'),
      "el href no va escapado"
    );
    dicenLoMismo(tpl, url);
    assert.ok(plano(tpl.html).includes("Te recomendamos conectarte"), "falta el consejo del audio");
  });

  it("presencial: la dirección sale en las dos, escapada solo en el HTML", () => {
    const tpl = bookingConfirmedTemplate({
      ...CONF,
      modality: "presencial",
      location: "C/ Mayor 1 <bajo>",
    });
    dicenLoMismo(tpl, "C/ Mayor 1 <bajo>");
    assert.ok(!tpl.html.includes("<bajo>"), "la dirección entró cruda en el HTML");
    assert.ok(tpl.html.includes("&lt;bajo&gt;"));
  });

  it("teléfono: se le dice que llamamos nosotros", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, modality: "phone" });
    assert.ok(plano(tpl.html).includes("Te llamaremos"), "el HTML no lo dice");
    assert.ok(norm(tpl.text).includes("Te llamaremos"), "el texto no lo dice");
  });

  it("el enlace de la modalidad que NO es no se cuela", () => {
    const tpl = bookingConfirmedTemplate({
      ...CONF,
      modality: "presencial",
      location: "C/ Mayor 1",
      meetUrl: "https://meet.example.com/abc",
    });
    callanLosDos(tpl, "https://meet.example.com/abc");
    callanLosDos(tpl, "Enlace de videollamada");
  });

  it("«Añadir a Google Calendar» lleva la hora y la duración que se le pasaron", () => {
    const tpl = bookingConfirmedTemplate(CONF); // 12:30 Madrid = 10:30Z, 50 min
    assert.ok(
      tpl.html.includes("dates=20260827T103000Z%2F20260827T112000Z"),
      "el enlace de calendario no cuadra con la hora y la duración"
    );
    assert.ok(tpl.text.includes("Añadir a Google Calendar: https://calendar.google.com/"));
  });

  it("sin duración, el calendario reserva la hora entera (el default de googleCalendarUrl)", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, duration: null });
    assert.ok(tpl.html.includes("dates=20260827T103000Z%2F20260827T113000Z"));
  });

  it("el enlace de cancelar va en el href y en el texto, y sin él no se promete nada", () => {
    const cancelUrl = "https://crm.test/widget/c/aumenta/cancel/tok";
    const con = bookingConfirmedTemplate({ ...CONF, cancelUrl });
    assert.ok(con.html.includes(`href="${cancelUrl}"`), "el enlace de cancelar no está en el href");
    assert.ok(con.text.includes(`Cancelar: ${cancelUrl}`), "el texto plano no lleva el de cancelar");
    assert.ok(plano(con.html).includes("¿No puedes asistir?"));

    const sin = bookingConfirmedTemplate({ ...CONF, cancelUrl: null });
    callanLosDos(sin, "¿No puedes asistir?");
    callanLosDos(sin, "Cancela aquí");
  });

  it("cobrada: dice cuánto se ha cobrado, en céntimos, en las dos versiones", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, importe: 4500, cobro: "cobrada" });
    dicenLoMismo(tpl, "Hemos cobrado los 45,00 € que tenías reservados en tu tarjeta.");
    assert.ok(plano(tpl.html).includes("Pagado 45,00 €"), "falta el bloque «Pagado»");
    callanLosDos(tpl, "4.500,00 €");
    callanLosDos(tpl, "pendiente");
  });

  it("sin cobrar: avisa de que paga en consulta (el que se enteraba en el mostrador)", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, importe: 4500, cobro: "sin_cobrar" });
    dicenLoMismo(tpl, "abonarás los 45,00 € en la consulta. No se te ha cobrado nada online.");
    assert.ok(plano(tpl.html).includes("Pendiente de pago"), "falta el bloque de pendiente");
    assert.ok(norm(tpl.text).includes("PAGO PENDIENTE"), "el texto plano no lo grita");
    callanLosDos(tpl, "Hemos cobrado");
  });

  it("sin saber qué pasó con el dinero, se calla: ni promete pago ni deuda", () => {
    for (const cobro of [null, undefined, "", "pendiente", "cobrado"]) {
      const tpl = bookingConfirmedTemplate({ ...CONF, importe: 4500, cobro });
      callanLosDos(tpl, "Hemos cobrado");
      callanLosDos(tpl, "PAGO PENDIENTE");
      callanLosDos(tpl, "45,00 €");
    }
  });

  it("un importe que no es un entero de céntimos positivo no se imprime", () => {
    for (const raro of [0, -1, 4500.5, "4500", null, undefined, NaN]) {
      const tpl = bookingConfirmedTemplate({ ...CONF, importe: raro, cobro: "cobrada" });
      callanLosDos(tpl, "Hemos cobrado");
      callanLosDos(tpl, "€");
    }
  });
});

// ── bookingRejected ─────────────────────────────────────────────────────────

describe("bookingRejected: no aceptamos la solicitud", () => {
  it("asunto neutro y disculpa; NO dice «cancelada» (nunca llegó a existir)", () => {
    const tpl = bookingRejectedTemplate(BASE);
    assert.equal(tpl.subject, "Sobre tu solicitud de cita");
    dicenLoMismo(tpl, "Lamentamos no poder confirmar tu solicitud para Primera consulta");
    callanLosDos(tpl, "ha sido cancelada");
  });

  it("bono: «tu programa sigue activo» en las DOS versiones (06/08/2026, Rodrigo)", () => {
    const tpl = bookingRejectedTemplate({ ...BASE, esBono: true });
    dicenLoMismo(
      tpl,
      "Tu programa sigue activo: esta sesión vuelve a estar disponible y te daremos otra fecha."
    );
  });

  it("sin bono, ni una palabra de programa (sería mentir a quien no compró bono)", () => {
    for (const valor of [false, null, undefined, 0]) {
      callanLosDos(bookingRejectedTemplate({ ...BASE, esBono: valor }), "programa sigue activo");
    }
  });

  it("el motivo sale cuando lo hay, y un motivo en blanco no imprime «Motivo:»", () => {
    dicenLoMismo(bookingRejectedTemplate({ ...BASE, reason: "Agenda completa" }), "Motivo: Agenda completa");
    for (const vacio of ["", "   ", "\n\t ", null, undefined]) {
      callanLosDos(bookingRejectedTemplate({ ...BASE, reason: vacio }), "Motivo:");
    }
  });

  it("el motivo se recorta por los lados", () => {
    const tpl = bookingRejectedTemplate({ ...BASE, reason: "   Agenda completa   " });
    assert.ok(tpl.text.includes("Motivo: Agenda completa\n"), "el texto plano arrastra los espacios");
    assert.equal(
      tpl.html.match(/<strong>Motivo:<\/strong>[^<]*/)[0],
      "<strong>Motivo:</strong> Agenda completa"
    );
  });

  it("con web se invita a proponer otra fecha; sin web, a responder al correo", () => {
    const web = "https://laura.test/citas?origen=cita&ref=1";
    const con = bookingRejectedTemplate({ ...BASE, websiteUrl: web });
    assert.ok(plano(con.html).includes(web), "el HTML no enseña la web");
    assert.ok(con.text.includes(web), "el texto plano no lleva la web");
    assert.ok(
      con.html.includes('href="https://laura.test/citas?origen=cita&amp;ref=1"'),
      "el href de la web no va escapado"
    );
    callanLosDos(con, "buscamos juntos una alternativa");

    const sin = bookingRejectedTemplate(BASE);
    dicenLoMismo(sin, "responde a este email y buscamos juntos una alternativa");
    callanLosDos(sin, "desde nuestra web");
  });
});

// ── bookingCancelled ────────────────────────────────────────────────────────

describe("bookingCancelled: la cita existía y ya no", () => {
  it("asunto y cuerpo dicen cancelada, no rechazada", () => {
    const tpl = bookingCancelledTemplate(BASE);
    assert.equal(tpl.subject, "Tu cita ha sido cancelada");
    // Sin la «T»: el HTML lo mete en «…avisarte de que tu cita…» y el texto
    // plano lo arranca en mayúscula. Lo que tiene que coincidir es la frase.
    dicenLoMismo(tpl, "cita de Primera consulta ha sido cancelada");
    callanLosDos(tpl, "Lamentamos no poder confirmar");
  });

  it("bono: «tu programa sigue activo» en las DOS versiones (Jorge, 20/08/2026)", () => {
    // Esta es la frase que se decidió ayer: sale también cuando se cancela desde
    // el panel de la cita, no solo desde el rechazo de una solicitud.
    const tpl = bookingCancelledTemplate({ ...BASE, esBono: true });
    dicenLoMismo(
      tpl,
      "Tu programa sigue activo: esta sesión vuelve a estar disponible y te daremos otra fecha."
    );
    // El HTML añade además la parte del dinero; el texto plano se queda en la
    // promesa principal, que es la que importa.
    assert.ok(plano(tpl.html).includes("No pierdes ninguna sesión ni se te cobra nada de más."));
  });

  it("sin bono no se habla de programa", () => {
    for (const valor of [false, null, undefined]) {
      callanLosDos(bookingCancelledTemplate({ ...BASE, esBono: valor }), "programa sigue activo");
    }
  });

  it("el bono va ANTES del motivo: primero se le quita el susto", () => {
    const tpl = bookingCancelledTemplate({ ...BASE, esBono: true, reason: "Baja médica" });
    const h = plano(tpl.html);
    const t = norm(tpl.text);
    assert.ok(h.indexOf("programa sigue activo") < h.indexOf("Motivo:"), "en el HTML va detrás");
    assert.ok(t.indexOf("programa sigue activo") < t.indexOf("Motivo:"), "en el texto va detrás");
  });

  it("el motivo sale cuando lo hay; en blanco no imprime «Motivo:»", () => {
    dicenLoMismo(bookingCancelledTemplate({ ...BASE, reason: "Baja médica" }), "Motivo: Baja médica");
    for (const vacio of ["", "   ", null, undefined]) {
      callanLosDos(bookingCancelledTemplate({ ...BASE, reason: vacio }), "Motivo:");
    }
  });

  it("siempre se ofrece buscar otra fecha, haya motivo o no", () => {
    for (const reason of ["Baja médica", null]) {
      dicenLoMismo(
        bookingCancelledTemplate({ ...BASE, reason }),
        "Si quieres buscar una nueva fecha, responde a este email y la cuadramos."
      );
    }
  });

  it("un motivo larguísimo no se corta ni revienta", () => {
    const largo = "Ñandú ".repeat(200).trim();
    const tpl = bookingCancelledTemplate({ ...BASE, reason: largo });
    assert.ok(tpl.text.includes(largo), "el texto plano recorta el motivo");
    assert.ok(plano(tpl.html).includes(largo), "el HTML recorta el motivo");
  });
});

// ── bookingRescheduled ──────────────────────────────────────────────────────

describe("bookingRescheduled: las DOS fechas, no solo la nueva", () => {
  const MOVIDA = { ...BASE, scheduledAtAnterior: CUANDO, scheduledAt: OTRA };

  it("asunto y cuerpo", () => {
    const tpl = bookingRescheduledTemplate(MOVIDA);
    assert.equal(tpl.subject, "Han cambiado la fecha de tu cita");
    dicenLoMismo(tpl, "cita de Primera consulta ha cambiado de fecha.");
  });

  it("salen la vieja Y la nueva, en las dos versiones", () => {
    const tpl = bookingRescheduledTemplate(MOVIDA);
    dicenLoMismo(tpl, FECHA);
    dicenLoMismo(tpl, FECHA_OTRA);
    dicenLoMismo(tpl, "Antes era");
    dicenLoMismo(tpl, "Ahora es");
  });

  it("la vieja va antes que la nueva: se lee «de aquí a aquí»", () => {
    const tpl = bookingRescheduledTemplate(MOVIDA);
    const h = plano(tpl.html);
    const t = norm(tpl.text);
    assert.ok(h.indexOf("Antes era") < h.indexOf("Ahora es"), "en el HTML van al revés");
    assert.ok(t.indexOf("Antes era") < t.indexOf("Ahora es"), "en el texto van al revés");
    assert.ok(t.indexOf(FECHA) < t.indexOf(FECHA_OTRA), "las fechas van al revés en el texto");
  });

  it("el preheader del inbox adelanta la fecha NUEVA", () => {
    const tpl = bookingRescheduledTemplate(MOVIDA);
    assert.ok(
      tpl.html.includes(`Tu cita pasa a ser el ${FECHA_OTRA}.`),
      "el preheader no adelanta la fecha nueva"
    );
  });

  it("siempre pide apuntar la fecha nueva", () => {
    dicenLoMismo(bookingRescheduledTemplate(MOVIDA), "Apunta la fecha nueva.");
  });

  it("el motivo es opcional", () => {
    dicenLoMismo(
      bookingRescheduledTemplate({ ...MOVIDA, reason: "Cambio de agenda" }),
      "Motivo: Cambio de agenda"
    );
    for (const vacio of ["", "   ", null, undefined]) {
      callanLosDos(bookingRescheduledTemplate({ ...MOVIDA, reason: vacio }), "Motivo:");
    }
  });

  it("si por lo que sea las dos fechas son la misma, se imprimen las dos igual", () => {
    // No se inventa un «no ha cambiado nada»: el correo dice lo que le dieron.
    const tpl = bookingRescheduledTemplate({ ...MOVIDA, scheduledAt: CUANDO });
    assert.equal(norm(tpl.text).split(FECHA).length - 1, 2, "en el texto no salen las dos");
    assert.equal(plano(tpl.html).split(FECHA).length - 1, 3, "en el HTML faltan (preheader + 2 bloques)");
    dicenLoMismo(tpl, "Antes era");
    dicenLoMismo(tpl, "Ahora es");
  });
});

// ── Bordes que hoy se comportan así ─────────────────────────────────────────

describe("bordes conocidos: se fijan tal como están hoy", () => {
  // SOSPECHOSO — una fecha ilegible llega ENTERA al paciente como «Invalid Date».
  // El `try/catch` de `formatDateTime` no salta nunca: `toLocaleString()` sobre
  // una fecha inválida no lanza, devuelve el literal «Invalid Date». O sea que el
  // fallback del catch es código muerto. Hoy los llamadores siempre pasan un
  // `scheduledAt` de la base, así que no se toca; queda escrito para que, si
  // alguien ve ese texto en un correo real, sepa de dónde sale.
  it("una fecha inválida sale como «Invalid Date» en el correo", () => {
    for (const [nombre, hacer] of LAS_CINCO) {
      const tpl = hacer({ scheduledAt: undefined });
      assert.ok(norm(tpl.text).includes("Invalid Date"), `${nombre} no lo enseña`);
    }
  });

  // SOSPECHOSO — `new Date(null)` es el 1 de enero de 1970, no una fecha vacía.
  // Un `scheduledAt: null` no se detecta: sale una cita en 1970.
  it("scheduledAt null no se detecta: sale 1970", () => {
    const tpl = bookingCancelledTemplate({ ...BASE, scheduledAt: null });
    assert.ok(norm(tpl.text).includes("de 1970"), "ya no sale 1970: alguien lo arregló, quita este it");
  });

  // SOSPECHOSO — con una fecha inválida, `googleCalendarUrl` devuelve null y el
  // correo de confirmación se queda SIN «Añadir a Google Calendar», callando.
  // Es lo correcto (mejor sin enlace que con uno roto), pero conviene que conste.
  it("con fecha inválida no hay enlace de Google Calendar", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, scheduledAt: "no-es-fecha" });
    assert.ok(!tpl.html.includes("calendar.google.com"));
    assert.ok(!tpl.text.includes("calendar.google.com"));
  });

  // SOSPECHOSO — una cita ONLINE sin `meetUrl` se confirma diciendo «Online
  // (videollamada)» y NO menciona el enlace ni por qué falta. El paciente se
  // queda con una videollamada sin sitio al que ir. Hoy el enlace se pega a mano
  // en la ficha de la cita, así que este caso es real. No se arregla aquí porque
  // decidir qué decirle («te lo mandamos luego»...) es de producto, no técnico.
  it("online sin enlace: el correo no dice nada del enlace que falta", () => {
    const tpl = bookingConfirmedTemplate({ ...CONF, meetUrl: null });
    assert.ok(plano(tpl.html).includes("Online (videollamada)"));
    callanLosDos(tpl, "Enlace de videollamada");
    callanLosDos(tpl, "Te recomendamos conectarte");
  });

  // SOSPECHOSO — sin `tenantName` la firma queda «— undefined». Los llamadores
  // pasan siempre `tenant.name`, así que no se toca; si algún día aparece en un
  // correo real, el sitio es este.
  it("sin nombre de centro la firma queda «— undefined»", () => {
    for (const [nombre, hacer] of LAS_CINCO) {
      const tpl = hacer({ tenantName: undefined });
      assert.ok(norm(tpl.text).endsWith("— undefined"), `${nombre} firma distinto`);
    }
  });

  // SOSPECHOSO — un `reason` que no sea texto revienta (`.trim is not a
  // function`) y tumbaría el envío entero. Hoy los tres llamadores lo normalizan
  // antes (`normalizeString`, `typeof … === "string"`, o la columna de la base),
  // así que la plantilla se queda como está: el contrato es texto o nada.
  it("un motivo que no es texto revienta la plantilla", () => {
    for (const raro of [123, {}, [], true]) {
      assert.throws(
        () => bookingCancelledTemplate({ ...BASE, reason: raro }),
        /trim is not a function/,
        `con reason=${JSON.stringify(raro)} ya no revienta: alguien lo arregló`
      );
    }
  });
});
