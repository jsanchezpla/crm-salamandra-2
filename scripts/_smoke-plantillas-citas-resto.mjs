// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-plantillas-citas-resto.mjs — los cinco correos de citas que nadie
 * probaba (21/08/2026).
 *
 *   node --test scripts/_smoke-plantillas-citas-resto.mjs
 *   node --test --test-name-pattern="pedirTarjeta" scripts/_smoke-plantillas-citas-resto.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Tras las cuatro tandas de pruebas del 17–20/08 la lógica pura de `lib/`
 * quedó cubierta salvo dos zonas: los generadores de PDF y las plantillas de
 * correo. Esta cubre cinco de las diez de `lib/email/templates/citas/`:
 * `bookingMeetLink`, `bookingReminder`, `pedirTarjeta`, `avisoCliente` y
 * `solicitudAceptada`.
 *
 * No eran cinco ficheros cualesquiera. Son correos que salen SOLOS y le llegan
 * a un paciente sin que nadie los lea antes:
 *
 *   · `bookingReminder` lo dispara el cron de recordatorios de madrugada;
 *   · `pedirTarjeta` habla de DINERO (céntimos → euros) y de una cita que la
 *     persona cree perdida;
 *   · `avisoCliente` mete dentro del HTML texto que acaba de teclear una
 *     persona en el CRM;
 *   · `solicitudAceptada` cambia de discurso entero según una bandera.
 *
 * Escribiendo esta prueba salió UN FALLO DE VERDAD, corregido junto a ella:
 * `pedirTarjeta.js` interpolaba el enlace de pago CRUDO dentro del
 * `href` del botón. Era el único `href="${…}"` sin escapar de todo `lib/email`
 * —el repaso del 10/08/2026 escapó los demás y se dejó este—, y un enlace con
 * una comilla no rompía el marcado: lo AMPLIABA (`" onmouseover="…`) dentro de
 * un correo que sale del dominio verificado del CRM. Lo fija
 * `«el href del botón va escapado»`.
 *
 * ── QUÉ SE PRUEBA Y QUÉ NO ─────────────────────────────────────────────────
 *
 * Se llama a la función y se mira lo que DEVUELVE (`{subject, html, text}`).
 * Nada de regex sobre el código fuente: aquí el texto no es la prueba, es el
 * resultado. Tres cosas se miran en todas:
 *
 *   1. el ASUNTO, que es lo único que la persona ve antes de decidir si abre;
 *   2. que el HTML y el TEXTO PLANO digan lo mismo — la plantilla en la que el
 *      texto plano se quedó atrás es el clásico de esta carpeta, y aquí hay
 *      TRES casos vivos, marcados abajo con SOSPECHOSO;
 *   3. los CONDICIONALES («si pasa X, di Y»), que son las líneas que se rompen
 *      solas cuando alguien toca la plantilla por otro motivo.
 *
 * Lo que NO se prueba: el layout (`lib/email/templates/layout.js`) tiene su
 * propia responsabilidad —saneado de colores de marca, tabla para Outlook— y
 * solo se toca aquí de refilón, para comprobar que la marca del tenant llega.
 *
 * ── SOSPECHOSO ─────────────────────────────────────────────────────────────
 *
 * Ocho comportamientos raros pero REALES se fijan tal como están (nueve `it`,
 * porque el del saludo pasa en dos plantillas), cada uno marcado
 * `// SOSPECHOSO` y con su porqué. Ninguno se ha tocado: cambiarlos es decisión
 * de producto, no de quien escribe la prueba. Si mañana se arreglan, la prueba
 * que se pone roja lleva en el nombre lo que se decidió aquí. Por orden de
 * lo que más se nota si sale mal:
 *
 *   · `pedirTarjeta` sin importe imprime «NaN €», y con importe null, «0,00 €»
 *     — en el correo que habla de dinero;
 *   · tres frases que están en el html y NO en el texto plano: la duración de
 *     `bookingMeetLink`, el «Te llamaremos» de `bookingReminder` en modalidad
 *     teléfono y el «Entra en la web» de `solicitudAceptada` sin enlace;
 *   · sin nombre, `bookingMeetLink` y `bookingReminder` saludan «Hola Hola,»
 *     (las otras dos sí dicen «Hola,» a secas), y ninguna recorta los espacios;
 *   · `bookingReminder` se despide con el nombre del centro a pelo y
 *     `bookingMeetLink` con «— Nombre».
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bookingMeetLinkTemplate } from "../lib/email/templates/citas/bookingMeetLink.js";
import { bookingReminderTemplate } from "../lib/email/templates/citas/bookingReminder.js";
import { pedirTarjetaTemplate } from "../lib/email/templates/citas/pedirTarjeta.js";
import { avisoClienteTemplate } from "../lib/email/templates/citas/avisoCliente.js";
import { solicitudAceptadaTemplate } from "../lib/email/templates/citas/solicitudAceptada.js";

// ── Datos de mentira, siempre los mismos ────────────────────────────────────

/** 27/08/2026 a las 10:30 en Madrid (CEST, +2). */
const CUANDO = "2026-08-27T08:30:00.000Z";
/** 26/08 a las 22:30 UTC = 27/08 a las 00:30 en Madrid. Distinto DÍA. */
const CUANDO_CRUZA_MEDIANOCHE = "2026-08-26T22:30:00.000Z";

const DIA_LARGO = "jueves, 27 de agosto de 2026";
const DIA_CORTO = "jueves, 27 de agosto";
const HORA = "10:30";

/** El euro de `es-ES` va detrás de un espacio DURO, no de un espacio normal. */
const EUR = " €";

/** Lo que teclea alguien que copia de un chat, o el que viene a hacer daño. */
const MARCADO = "<script>alert(1)</script>";
/** Una URL que, sin escapar, no rompe el atributo: lo amplía. */
const URL_CON_COMILLA = 'https://x/y" onmouseover="alert(1)';

// ── Herramientas ────────────────────────────────────────────────────────────

/**
 * El HTML visto como lo ve una persona: sin etiquetas y con las entidades
 * deshechas. Sirve para comparar el correo bonito con el de texto plano.
 * Ojo: para comprobar que algo va ESCAPADO hay que mirar el html crudo, no
 * esto (aquí `&lt;script&gt;` vuelve a ser `<script>`).
 */
function comoSeLee(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Estos datos tienen que salir en las DOS versiones del correo. */
function dicenLoMismo(tpl, hechos) {
  const visible = comoSeLee(tpl.html);
  for (const hecho of hechos) {
    assert.ok(visible.includes(hecho), `el html no dice «${hecho}»`);
    assert.ok(tpl.text.includes(hecho), `el texto plano no dice «${hecho}»`);
  }
}

/**
 * Un enlace es otra cosa que un texto: vive en el `href`, donde `comoSeLee` no
 * llega (quita los atributos enteros). Se comprueba que el html enlaza de
 * verdad —no que lo mencione— y que el texto plano lo lleva crudo, que es la
 * única forma que tiene de repartirlo.
 */
function repartenElMismoEnlace(tpl, url) {
  assert.ok(tpl.html.includes(`href="${url}"`), `el html no enlaza a «${url}»`);
  assert.ok(tpl.text.includes(url), `el texto plano no lleva «${url}»`);
}

/** Y este enlace no aparece por ningún lado, ni en un atributo. */
function noRepartenEseEnlace(tpl, url) {
  assert.equal(tpl.html.includes(url), false, `el html sigue llevando «${url}»`);
  assert.equal(tpl.text.includes(url), false, `el texto plano sigue llevando «${url}»`);
}

/** Y estos no salen en ninguna de las dos. */
function noDiceNinguna(tpl, cosas) {
  const visible = comoSeLee(tpl.html);
  for (const cosa of cosas) {
    assert.ok(!visible.includes(cosa), `el html dice «${cosa}» y no debería`);
    assert.ok(!tpl.text.includes(cosa), `el texto plano dice «${cosa}» y no debería`);
  }
}

/** Ni el marcado ni la comilla del atributo se han colado en el HTML. */
function nadaSeCuela(tpl) {
  assert.ok(!tpl.html.includes("<script>"), "se ha colado un <script> en el html");
  assert.ok(!tpl.html.includes('onmouseover="'), "se ha ampliado un atributo del html");
}

/** Un correo servible: las tres claves, las tres con contenido. */
function esUnCorreo(tpl) {
  assert.deepEqual(Object.keys(tpl).sort(), ["html", "subject", "text"]);
  for (const clave of ["subject", "html", "text"]) {
    assert.equal(typeof tpl[clave], "string", `${clave} no es texto`);
    assert.ok(tpl[clave].length > 0, `${clave} viene vacío`);
  }
  assert.ok(tpl.html.startsWith("<!doctype html>"), "el html no trae documento");
}

// ── Contextos de partida (cada `it` clona y retoca lo suyo) ─────────────────

const meetLink = (extra) =>
  bookingMeetLinkTemplate({
    tenantName: "Aumenta",
    clientName: "Marta Ruiz Pérez",
    eventTypeName: "Terapia individual",
    scheduledAt: CUANDO,
    duration: 60,
    meetUrl: "https://meet.example.com/abc-def",
    ...extra,
  });

const recordatorio = (extra) =>
  bookingReminderTemplate({
    tenantName: "Aumenta",
    clientName: "Marta Ruiz Pérez",
    eventTypeName: "Terapia individual",
    scheduledAt: CUANDO,
    duration: 45,
    modality: "presencial",
    ...extra,
  });

const tarjeta = (extra) =>
  pedirTarjetaTemplate({
    tenantName: "Aumenta",
    clientName: "Marta Ruiz Pérez",
    eventTypeName: "Primera consulta",
    scheduledAt: CUANDO,
    importe: 13000,
    enlace: "https://crm.example.com/widget/c/aumenta/pagar/tok",
    ...extra,
  });

const aviso = (extra) =>
  avisoClienteTemplate({
    tenantName: "Aumenta",
    clientName: "Marta Ruiz Pérez",
    title: "Cerramos en agosto",
    body: "Hola.\nCerramos del 1 al 15.\n\nUn saludo.",
    ...extra,
  });

const aceptada = (extra) =>
  solicitudAceptadaTemplate({
    tenantName: "Aumenta",
    clientName: "Marta Ruiz Pérez",
    urlReserva: "https://aumenta.example.com/reservar",
    ...extra,
  });

// ═══════════════════════════════════════════════════════════════════════════
// bookingMeetLink — «ya tienes el enlace de tu videollamada»
// ═══════════════════════════════════════════════════════════════════════════

describe("bookingMeetLink: el enlace de la videollamada", () => {
  it("devuelve un correo servible", () => {
    esUnCorreo(meetLink());
  });

  it("el asunto es fijo y no lleva ni marca ni nombre (es un correo de servicio)", () => {
    assert.equal(meetLink().subject, "Enlace para tu videollamada");
    assert.equal(meetLink({ tenantName: "Nutri Laura" }).subject, "Enlace para tu videollamada");
  });

  it("el enlace de la videollamada sale en el html Y en el texto plano", () => {
    // Es LO ÚNICO que este correo viene a dar: si se cae de una de las dos
    // versiones, la persona no puede entrar a su cita. En el html sale dos
    // veces a propósito: enlazado y a la vista, para quien copia y pega.
    const tpl = meetLink();
    repartenElMismoEnlace(tpl, "https://meet.example.com/abc-def");
    assert.ok(comoSeLee(tpl.html).includes("https://meet.example.com/abc-def"));
  });

  it("saluda por el nombre de pila, no por el nombre entero", () => {
    assert.ok(meetLink().text.startsWith("Hola Marta,"));
    assert.ok(comoSeLee(meetLink().html).includes("Hola Marta,"));
    assert.ok(!meetLink().text.includes("Hola Marta Ruiz Pérez"));
  });

  it("día, hora y servicio salen en las dos versiones", () => {
    dicenLoMismo(meetLink(), [DIA_LARGO, HORA, "Terapia individual"]);
  });

  it("la hora es la de Madrid, no la del servidor", () => {
    // 22:30 UTC del día 26 son las 00:30 del 27 en Madrid: aquí se fija el día
    // que ve el paciente, no el del reloj.
    //
    // OJO CON LO QUE ESTA LÍNEA NO CAZA (comprobado a mano el 21/08/2026,
    // quitando el `timeZone` de las plantillas y viendo que seguía verde): en
    // una máquina cuyo reloj YA está en Europe/Madrid —la de casa— quitar
    // `timeZone: "Europe/Madrid"` no cambia ni un carácter, así que esta prueba
    // no se entera. Solo se pone roja donde el reloj es otro (un contenedor en
    // UTC), que es justo donde el fallo haría daño. No se puede arreglar desde
    // aquí sin tocar la zona horaria del proceso, y eso no cabe en una prueba
    // ligera de este repositorio; queda dicho para que nadie la lea como una
    // garantía que no da.
    const tpl = meetLink({ scheduledAt: CUANDO_CRUZA_MEDIANOCHE });
    assert.ok(tpl.text.includes("jueves, 27 de agosto de 2026"), tpl.text);
    assert.ok(tpl.text.includes("00:30"), tpl.text);
  });

  it("con enlace de cancelación lo ofrece; sin él, no promete nada", () => {
    const con = meetLink({ cancelUrl: "https://c.example.com/cancelar/tok" });
    repartenElMismoEnlace(con, "https://c.example.com/cancelar/tok");
    assert.ok(comoSeLee(con.html).includes("Cancela aquí"));

    const sin = meetLink({ cancelUrl: null });
    noRepartenEseEnlace(sin, "https://c.example.com/cancelar/tok");
    noDiceNinguna(sin, ["Cancela aquí", "Cancelar:"]);
  });

  it("sin duración no inventa una fila vacía", () => {
    for (const duration of [undefined, null, 0]) {
      noDiceNinguna(meetLink({ duration }), ["Duración"]);
    }
  });

  it("un nombre o un enlace con marcado no se cuelan en el html", () => {
    const tpl = meetLink({
      clientName: `${MARCADO} Ruiz`,
      eventTypeName: MARCADO,
      meetUrl: URL_CON_COMILLA,
      cancelUrl: URL_CON_COMILLA,
      tenantName: "Centro <b>A &amp; B</b>",
    });
    nadaSeCuela(tpl);
    // Y no es que se haya perdido por el camino: está, escapado.
    assert.ok(tpl.html.includes("&lt;script&gt;"));
    assert.ok(tpl.html.includes("&quot; onmouseover=&quot;"));
  });

  it("la marca del tenant llega al html", () => {
    assert.ok(meetLink({ brand: { primaryColor: "#FF1F96" } }).html.includes("#FF1F96"));
  });

  it("una fecha ilegible no lo revienta: sale «Invalid Date» y el correo se genera", () => {
    const tpl = meetLink({ scheduledAt: "no-soy-una-fecha" });
    esUnCorreo(tpl);
    assert.ok(tpl.text.includes("Invalid Date"));
  });

  // SOSPECHOSO — la duración sale en la tarjeta del html («Duración 60 min») y
  // NO en el texto plano, que solo lleva día, hora y enlace. Es la deriva
  // clásica entre las dos versiones. Se deja como está porque la duración es
  // información secundaria en este correo, pero `bookingReminder` SÍ la pone en
  // su texto plano: si algún día se unifican, esta prueba dice cuál se movió.
  it("SOSPECHOSO: la duración solo sale en el html, no en el texto plano", () => {
    const tpl = meetLink({ duration: 60 });
    assert.ok(comoSeLee(tpl.html).includes("60 min"));
    assert.equal(tpl.text.includes("60 min"), false);
  });

  // SOSPECHOSO — el encadenado `(clientName || "").split(" ")[0] || clientName
  // || "Hola"` no tiene salida limpia para el nombre vacío: la última rama es
  // la palabra «Hola», que se pega al «Hola » del saludo. `avisoCliente` y
  // `solicitudAceptada` sí lo resuelven (dicen solo «Hola,»).
  it("SOSPECHOSO: sin nombre saluda «Hola Hola,»", () => {
    for (const clientName of ["", null, undefined]) {
      assert.ok(meetLink({ clientName }).text.startsWith("Hola Hola,"));
    }
  });

  // SOSPECHOSO — el nombre no se recorta antes de partirlo, así que los
  // espacios de más del CRM salen tal cual en el saludo.
  it("SOSPECHOSO: un nombre con espacios de sobra sale sin recortar", () => {
    assert.ok(meetLink({ clientName: "  Ana  " }).text.startsWith("Hola   Ana  ,"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// bookingReminder — el recordatorio de la víspera, disparado por el cron
// ═══════════════════════════════════════════════════════════════════════════

describe("bookingReminder: el recordatorio de la víspera", () => {
  it("devuelve un correo servible", () => {
    esUnCorreo(recordatorio());
  });

  it("el asunto lleva la hora, que es lo que se mira en la bandeja", () => {
    assert.equal(recordatorio().subject, `Recordatorio: tu cita es mañana a las ${HORA}`);
    assert.equal(
      recordatorio({ scheduledAt: CUANDO_CRUZA_MEDIANOCHE }).subject,
      "Recordatorio: tu cita es mañana a las 00:30"
    );
  });

  it("el día sale SIN año (es mañana; el año sobra)", () => {
    dicenLoMismo(recordatorio(), [DIA_CORTO]);
    noDiceNinguna(recordatorio(), ["de agosto de 2026"]);
  });

  it("día, hora, servicio y duración salen en las dos versiones", () => {
    dicenLoMismo(recordatorio(), [DIA_CORTO, HORA, "Terapia individual", "45 min"]);
  });

  it("SIEMPRE ofrece cancelar cuando el centro deja anular", () => {
    // La cabecera del fichero dice que este correo no busca solo que la persona
    // venga, sino que avise a tiempo si no puede. Sin condición ninguna sobre la
    // modalidad: en las tres tiene que salir.
    for (const modality of ["presencial", "phone", "online"]) {
      const tpl = recordatorio({ modality, cancelUrl: "https://c/cancelar/tok", meetUrl: "https://m/x" });
      repartenElMismoEnlace(tpl, "https://c/cancelar/tok");
      assert.ok(comoSeLee(tpl.html).includes("Avísanos aquí"), modality);
    }
  });

  it("y no promete cancelación cuando el centro no la da (cancelUrl null)", () => {
    // `cancelUrl()` de lib/citas/recordatorios.js devuelve null si el centro no
    // deja anular: entonces el correo no puede repartir un enlace muerto.
    const tpl = recordatorio({ cancelUrl: null });
    noRepartenEseEnlace(tpl, "https://c/cancelar/tok");
    noDiceNinguna(tpl, ["Avísanos aquí", "avísanos:"]);
  });

  it("online con enlace: reparte el enlace en las dos versiones", () => {
    const tpl = recordatorio({ modality: "online", meetUrl: "https://meet.example.com/xyz" });
    repartenElMismoEnlace(tpl, "https://meet.example.com/xyz");
    dicenLoMismo(tpl, ["Online (videollamada)"]);
  });

  it("online SIN enlace: no promete una videollamada que no tiene", () => {
    const tpl = recordatorio({ modality: "online", meetUrl: null });
    noRepartenEseEnlace(tpl, "https://meet.example.com/xyz");
    noDiceNinguna(tpl, ["Enlace de videollamada", "Enlace:"]);
    // Pero la modalidad se sigue diciendo: la persona tiene que saber que no va al centro.
    dicenLoMismo(tpl, ["Online (videollamada)"]);
  });

  it("presencial con dirección: dice dónde; sin dirección, se calla", () => {
    dicenLoMismo(recordatorio({ modality: "presencial", location: "C/ Mayor 3, Madrid" }), [
      "C/ Mayor 3, Madrid",
    ]);
    noDiceNinguna(recordatorio({ modality: "presencial", location: null }), ["Dónde"]);
  });

  it("una modalidad que no conocemos se imprime tal cual y no añade nada", () => {
    const tpl = recordatorio({ modality: "carta", location: "C/ Mayor 3", meetUrl: "https://m/x" });
    dicenLoMismo(tpl, ["carta"]);
    noDiceNinguna(tpl, ["Enlace de videollamada", "Dónde", "Te llamaremos"]);
  });

  it("sin duración no sale la fila ni en el html ni en el texto", () => {
    for (const duration of [undefined, null, 0]) {
      noDiceNinguna(recordatorio({ duration }), ["Duración", " min"]);
    }
  });

  it("nombre, servicio y dirección con marcado no se cuelan en el html", () => {
    const tpl = recordatorio({
      clientName: MARCADO,
      eventTypeName: MARCADO,
      modality: "presencial",
      location: MARCADO,
      cancelUrl: URL_CON_COMILLA,
    });
    nadaSeCuela(tpl);
    assert.ok(tpl.html.includes("&lt;script&gt;"));
  });

  it("una fecha ilegible no lo revienta (lo dispara un cron, sin nadie delante)", () => {
    const tpl = recordatorio({ scheduledAt: "vete-a-saber" });
    esUnCorreo(tpl);
    assert.ok(tpl.subject.includes("Invalid Date"));
  });

  // SOSPECHOSO — el html del caso `phone` añade «Te llamaremos al teléfono que
  // nos facilitaste a la hora indicada»; el texto plano NO tiene esa rama y se
  // queda solo con «Modalidad: Llamada telefónica». Quien lea el correo en
  // texto plano no sabe que la llamada la hacen ellos.
  it("SOSPECHOSO: en modalidad teléfono, «Te llamaremos» solo sale en el html", () => {
    const tpl = recordatorio({ modality: "phone" });
    assert.ok(comoSeLee(tpl.html).includes("Te llamaremos"));
    assert.equal(tpl.text.includes("Te llamaremos"), false);
    assert.ok(tpl.text.includes("Modalidad: Llamada telefónica"));
  });

  // SOSPECHOSO — mismo encadenado que en `bookingMeetLink`.
  it("SOSPECHOSO: sin nombre saluda «Hola Hola,»", () => {
    assert.ok(recordatorio({ clientName: "" }).text.startsWith("Hola Hola,"));
  });

  // SOSPECHOSO — este cierra con el nombre a secas y `bookingMeetLink` con
  // «— Nombre». Dos despedidas distintas en la misma carpeta.
  it("SOSPECHOSO: se despide con el nombre del centro a pelo, sin la raya", () => {
    assert.ok(recordatorio().text.endsWith("\nAumenta"));
    assert.equal(recordatorio().text.endsWith("— Aumenta"), false);
    assert.ok(meetLink().text.endsWith("— Aumenta"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// pedirTarjeta — «tu cita sigue en pie, vuelve a poner la tarjeta»
// ═══════════════════════════════════════════════════════════════════════════

describe("pedirTarjeta: el correo que habla de dinero", () => {
  it("devuelve un correo servible", () => {
    esUnCorreo(tarjeta());
  });

  it("el asunto es fijo y dice para qué es", () => {
    assert.equal(tarjeta().subject, "Necesitamos tu tarjeta otra vez para tu cita");
  });

  it("el importe se recibe en CÉNTIMOS y se imprime en euros", () => {
    // `Booking.amount` son céntimos (INTEGER). Si alguien le pasara euros, el
    // paciente vería «1,30 €» en vez de «130,00 €» y no lo reconocería.
    assert.ok(tarjeta({ importe: 13000 }).text.includes(`130,00${EUR}`));
    assert.ok(tarjeta({ importe: 100 }).text.includes(`1,00${EUR}`));
    assert.ok(tarjeta({ importe: 1 }).text.includes(`0,01${EUR}`));
    assert.ok(tarjeta({ importe: 1234567 }).text.includes(`12.345,67${EUR}`));
  });

  it("el euro va detrás de un espacio DURO (así lo escribe es-ES)", () => {
    // Si alguien compara con un espacio normal, la comparación falla en
    // silencio. Se fija aquí para que quien la escriba lo sepa.
    assert.ok(tarjeta().text.includes("130,00 €"));
    assert.equal(tarjeta().text.includes("130,00 €"), false);
  });

  it("el importe se dice DOS veces y las dos son el mismo (bloque y «se reservan…»)", () => {
    const tpl = tarjeta({ importe: 4550 });
    const veces = tpl.text.split(`45,50${EUR}`).length - 1;
    assert.equal(veces, 2, "el texto plano no repite el importe dos veces");
    assert.equal(comoSeLee(tpl.html).split(`45,50${EUR}`).length - 1, 2);
    // Y ningún otro importe se ha colado por el camino.
    assert.equal(/\d+,\d\d €/.test(tpl.text.replace(/45,50 €/g, "")), false);
  });

  it("importe 0 no lo revienta: dice 0,00 €", () => {
    const tpl = tarjeta({ importe: 0 });
    esUnCorreo(tpl);
    assert.ok(tpl.text.includes(`0,00${EUR}`));
  });

  it("un importe negativo se imprime tal cual, no se disfraza", () => {
    assert.ok(tarjeta({ importe: -500 }).text.includes(`-5,00${EUR}`));
  });

  it("motivo «rechazada» dice que no se pudo cobrar; cualquier otro, que caducó", () => {
    const rechazada = tarjeta({ motivo: "rechazada" });
    dicenLoMismo(rechazada, ["No hemos podido completar el cobro con la tarjeta que nos diste."]);
    noDiceNinguna(rechazada, ["ha caducado"]);

    // null, undefined y un valor que no conocemos caen todos en «caducada»:
    // decirle «tu banco lo rechazó» a quien no le pasó eso es peor que callarlo.
    for (const motivo of ["caducada", null, undefined, "otra-cosa"]) {
      const tpl = tarjeta({ motivo });
      dicenLoMismo(tpl, ["ha caducado"]);
      noDiceNinguna(tpl, ["No hemos podido completar el cobro"]);
    }
  });

  it("lo primero que dice es que la cita NO se ha perdido y que no se ha cobrado nada", () => {
    // Es el porqué del fichero: para el paciente esto es «algo ha fallado con
    // mi pago». Si se cae esta frase, el correo pasa a dar miedo.
    const tpl = tarjeta();
    assert.ok(comoSeLee(tpl.html).includes("Tu cita sigue en pie"));
    assert.ok(tpl.text.includes("TU CITA SIGUE EN PIE"));
    dicenLoMismo(tpl, ["no se te cobrará nada todavía"]);
  });

  it("el enlace de la tarjeta sale en el html Y en el texto plano", () => {
    // En el html va dentro del botón «Introducir mi tarjeta» (solo en el
    // `href`); en el texto plano, a la vista, que es la única forma de darlo.
    const tpl = tarjeta();
    repartenElMismoEnlace(tpl, "https://crm.example.com/widget/c/aumenta/pagar/tok");
    assert.ok(comoSeLee(tpl.html).includes("Introducir mi tarjeta"));
  });

  it("el href del botón va escapado (era el único crudo de todo lib/email)", () => {
    // Éste es el fallo que encontró esta prueba, 21/08/2026. Sin escapar, el
    // html salía como `href="https://x/y" onmouseover="alert(1)" style=…`: el
    // atributo no se rompía, se ampliaba.
    const tpl = tarjeta({ enlace: URL_CON_COMILLA });
    nadaSeCuela(tpl);
    assert.ok(tpl.html.includes("&quot; onmouseover=&quot;"), "el enlace no está escapado en el href");
    // En el texto plano, en cambio, va crudo: allí no hay atributos que romper.
    assert.ok(tpl.text.includes(URL_CON_COMILLA));
  });

  it("nombre y servicio con marcado tampoco se cuelan", () => {
    const tpl = tarjeta({ clientName: MARCADO, eventTypeName: MARCADO, tenantName: MARCADO });
    nadaSeCuela(tpl);
    assert.ok(tpl.html.includes("&lt;script&gt;"));
  });

  it("la fecha se dice entera, con año y hora (la cita puede ser dentro de días)", () => {
    dicenLoMismo(tarjeta(), [`${DIA_LARGO}, ${HORA}`]);
  });

  // SOSPECHOSO — `Booking.amount` admite null, y `null / 100` es 0: una cita
  // sin importe le dice al paciente «se reservan 0,00 € en tu tarjeta». Hoy no
  // pasa porque el endpoint solo manda este correo si hubo un intento de cobro,
  // pero la plantilla no se defiende sola.
  it("SOSPECHOSO: importe null se imprime como 0,00 €", () => {
    assert.ok(tarjeta({ importe: null }).text.includes(`0,00${EUR}`));
  });

  // SOSPECHOSO — y sin la clave siquiera, sale «NaN €» en un correo de dinero.
  it("SOSPECHOSO: sin importe imprime «NaN €»", () => {
    const tpl = tarjeta({ importe: undefined });
    assert.ok(tpl.text.includes(`NaN${EUR}`), tpl.text);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// avisoCliente — el correo que escribe una persona a mano
// ═══════════════════════════════════════════════════════════════════════════

describe("avisoCliente: texto tecleado por una persona dentro de un html", () => {
  it("devuelve un correo servible", () => {
    esUnCorreo(aviso());
  });

  it("el asunto es el título, tal cual lo escribió quien lo manda", () => {
    assert.equal(aviso({ title: "Cerramos en agosto" }).subject, "Cerramos en agosto");
  });

  it("el asunto NO se escapa (es una cabecera, no html) pero el título del cuerpo SÍ", () => {
    const tpl = aviso({ title: "Aviso <b>importante</b>" });
    assert.equal(tpl.subject, "Aviso <b>importante</b>");
    assert.ok(tpl.html.includes("&lt;b&gt;importante"));
    assert.equal(tpl.html.includes("<b>importante"), false);
  });

  it("el cuerpo sale en las dos versiones", () => {
    dicenLoMismo(aviso({ body: "Cerramos del 1 al 15." }), ["Cerramos del 1 al 15."]);
  });

  it("un salto suelto es un <br> y dos saltos abren párrafo nuevo", () => {
    // Quien escribe en el CRM da a Intro esperando ver el mismo hueco en el
    // correo. Sin esto, el aviso le llega al paciente como un ladrillo.
    const tpl = aviso({ body: "uno\ndos\n\ntres" });
    const parrafos = tpl.html.match(/<p style="margin:0 0 12px;">/g) || [];
    assert.equal(parrafos.length, 2, "los dos saltos no han abierto párrafo nuevo");
    assert.ok(tpl.html.includes("uno<br>dos"), "el salto suelto no es un <br>");
  });

  it("el marcado que teclee una persona se escapa en el html y va crudo en el texto", () => {
    const tpl = aviso({ body: MARCADO, clientName: `Ana ${MARCADO}` });
    nadaSeCuela(tpl);
    assert.ok(tpl.html.includes("&lt;script&gt;"));
    // El texto plano no es html: ahí las comillas y los signos no hacen daño.
    assert.ok(tpl.text.includes(MARCADO));
  });

  it("los signos de todos los días (comilla, ampersand) llegan enteros a las dos", () => {
    dicenLoMismo(aviso({ body: "Ana's & Bob" }), ["Ana's & Bob"]);
  });

  it("con nombre saluda por el de pila; sin nombre, «Hola,» a secas", () => {
    assert.ok(aviso({ clientName: "Marta Ruiz" }).text.startsWith("Hola Marta,"));
    for (const clientName of ["", null, undefined]) {
      assert.ok(aviso({ clientName }).text.startsWith("Hola,\n"));
    }
  });

  it("con enlace al área privada lo dice; sin él, no lo menciona", () => {
    dicenLoMismo(aviso({ portalUrl: "https://portal.example.com/aumenta" }), [
      "https://portal.example.com/aumenta",
    ]);
    noDiceNinguna(aviso({ portalUrl: null }), ["área privada"]);
  });

  it("un enlace de portal con comilla tampoco amplía el atributo", () => {
    nadaSeCuela(aviso({ portalUrl: URL_CON_COMILLA }));
  });

  it("un cuerpo vacío, en blanco o ausente no lo revienta", () => {
    for (const body of ["", "   ", null, undefined]) {
      const tpl = aviso({ body });
      esUnCorreo(tpl);
      assert.ok(tpl.text.includes("— Aumenta"));
    }
  });

  it("la vista previa del buzón son los primeros 120 caracteres del cuerpo", () => {
    // Es lo que se lee en la bandeja al lado del asunto: si se va entera, el
    // correo llega con un ladrillo de preview.
    const tpl = aviso({ body: "A".repeat(300) });
    const preview = tpl.html.match(/mso-hide:all;">([^<]*)</);
    assert.ok(preview, "no hay vista previa en el html");
    assert.equal(preview[1].length, 120);
    // Pero el cuerpo entero sigue estando en el correo, no truncado.
    assert.ok(comoSeLee(tpl.html).includes("A".repeat(300)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// solicitudAceptada — «ya puedes pedir cita», salvo si el centro no da agenda
// ═══════════════════════════════════════════════════════════════════════════

describe("solicitudAceptada: el condicional de la agenda cerrada", () => {
  it("devuelve un correo servible en los dos caminos", () => {
    esUnCorreo(aceptada());
    esUnCorreo(aceptada({ reservaCerrada: true }));
  });

  it("con agenda abierta, el asunto invita a pedir cita y lleva la marca", () => {
    assert.equal(aceptada().subject, "Ya puedes pedir tu cita — Aumenta");
    assert.equal(aceptada({ tenantName: "Nutri Laura" }).subject, "Ya puedes pedir tu cita — Nutri Laura");
  });

  it("con agenda cerrada, el asunto cambia entero: no promete agenda", () => {
    // 08/08/2026: hay centros que gestionan la hora en recepción. A esas
    // familias el asunto de arriba les prometía una agenda que no existe.
    assert.equal(aceptada({ reservaCerrada: true }).subject, "Hemos aceptado tu solicitud — Aumenta");
  });

  it("con agenda cerrada NO reparte el enlace de reserva, ni en html ni en texto", () => {
    // Aunque se lo pasen: el enlace lleva a una agenda que ese centro no abre.
    const tpl = aceptada({ reservaCerrada: true, urlReserva: "https://aumenta.example.com/reservar" });
    noRepartenEseEnlace(tpl, "https://aumenta.example.com/reservar");
    noDiceNinguna(tpl, ["Pedir cita", "Entra en la web"]);
    dicenLoMismo(tpl, ["Nos pondremos en contacto contigo"]);
  });

  it("con agenda cerrada tampoco se calla: dice que ya tiene ficha", () => {
    // El fichero es explícito: callarse es volver a dejar a la persona a
    // ciegas, que es justo lo que este correo vino a arreglar.
    dicenLoMismo(aceptada({ reservaCerrada: true }), ["ya tienes tu ficha en el centro"]);
  });

  it("con agenda abierta y enlace, pone el botón y el enlace en las dos versiones", () => {
    const tpl = aceptada();
    repartenElMismoEnlace(tpl, "https://aumenta.example.com/reservar");
    assert.ok(comoSeLee(tpl.html).includes("Pedir cita"));
    dicenLoMismo(tpl, ["ya puedes reservar tu cita"]);
  });

  it("con agenda abierta y SIN enlace no promete un botón que no lleva a ningún sitio", () => {
    const tpl = aceptada({ urlReserva: null });
    assert.equal(tpl.html.includes(">Pedir cita<"), false, "hay un botón sin destino");
    assert.equal(tpl.html.includes('href="null"'), false);
    assert.equal(tpl.html.includes('href=""'), false);
    noDiceNinguna(tpl, ["Pedir cita:"]);
  });

  it("la bandera exige el booleano true: un «sí» de texto o un 1 no cierran la agenda", () => {
    // El fichero compara con `=== true` a propósito. Lo que llega de un JSONB
    // de configuración puede ser cualquier cosa, y abrir la agenda por error es
    // menos malo que cerrarla por error (el enlace se sigue dando).
    for (const reservaCerrada of [false, null, undefined, "si", 1, 0, ""]) {
      assert.equal(
        aceptada({ reservaCerrada }).subject,
        "Ya puedes pedir tu cita — Aumenta",
        `${JSON.stringify(reservaCerrada)} no debería cerrar la agenda`
      );
    }
    assert.equal(aceptada({ reservaCerrada: true }).subject, "Hemos aceptado tu solicitud — Aumenta");
  });

  it("con nombre saluda por el de pila; sin nombre, «Hola,» a secas", () => {
    assert.ok(aceptada({ clientName: "Marta Ruiz" }).text.startsWith("Hola Marta,"));
    for (const clientName of ["", null, undefined]) {
      assert.ok(aceptada({ clientName }).text.startsWith("Hola,\n"));
    }
  });

  it("nombre y enlace con marcado no se cuelan en el html", () => {
    const tpl = aceptada({ clientName: MARCADO, urlReserva: URL_CON_COMILLA, tenantName: MARCADO });
    nadaSeCuela(tpl);
    assert.ok(tpl.html.includes("&lt;script&gt;"));
    assert.ok(tpl.html.includes("&quot; onmouseover=&quot;"));
  });

  it("los dos caminos cierran invitando a responder al correo", () => {
    dicenLoMismo(aceptada(), ["responde a este correo"]);
    dicenLoMismo(aceptada({ reservaCerrada: true }), ["responde a este correo"]);
  });

  // SOSPECHOSO — con agenda abierta y sin enlace, el html dice «Entra en la web
  // y elige el hueco que mejor te venga» y el texto plano NO tiene esa rama: se
  // queda en «ya puedes reservar tu cita» sin decir dónde.
  it("SOSPECHOSO: sin enlace, «Entra en la web» solo sale en el html", () => {
    const tpl = aceptada({ urlReserva: null });
    assert.ok(comoSeLee(tpl.html).includes("Entra en la web"));
    assert.equal(tpl.text.includes("Entra en la web"), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lo que vale para las cinco
// ═══════════════════════════════════════════════════════════════════════════

describe("las cinco plantillas, con lo mínimo que les pasa el CRM", () => {
  const minimas = [
    ["bookingMeetLink", meetLink()],
    ["bookingReminder", recordatorio()],
    ["pedirTarjeta", tarjeta()],
    ["avisoCliente", aviso()],
    ["solicitudAceptada", aceptada()],
  ];

  for (const [nombre, tpl] of minimas) {
    it(`${nombre} devuelve {subject, html, text} con contenido`, () => {
      esUnCorreo(tpl);
    });

    it(`${nombre} no deja escapar un «undefined» ni un «[object Object]»`, () => {
      // El clásico de las plantillas: un `${ctx.loQueSea}` con la clave sin
      // pasar imprime la palabra «undefined» en mitad del correo del paciente.
      for (const fea of ["undefined", "[object Object]", "NaN"]) {
        assert.equal(tpl.html.includes(fea), false, `el html de ${nombre} dice «${fea}»`);
        assert.equal(tpl.text.includes(fea), false, `el texto de ${nombre} dice «${fea}»`);
      }
    });

    it(`${nombre} firma con el nombre del centro`, () => {
      assert.ok(tpl.text.includes("Aumenta"), `el texto de ${nombre} no firma`);
      assert.ok(comoSeLee(tpl.html).includes("Aumenta"), `el html de ${nombre} no firma`);
    });
  }

  it("ninguna manda un asunto con salto de línea (rompería la cabecera del correo)", () => {
    for (const [nombre, tpl] of minimas) {
      assert.equal(/[\r\n]/.test(tpl.subject), false, `el asunto de ${nombre} lleva salto de línea`);
    }
  });

  it("un color de marca inventado no entra en el html: cae al verde de casa", () => {
    // Lo sanea el layout, pero se comprueba desde aquí porque es el camino por
    // el que un admin podría meter marcado en un correo ya firmado por el CRM.
    const sucio = { primaryColor: 'red;"><a href="https://phishing.example">pincha</a>' };
    for (const tpl of [meetLink({ brand: sucio }), tarjeta({ brand: sucio }), aviso({ brand: sucio })]) {
      assert.equal(tpl.html.includes("phishing.example"), false);
      assert.ok(tpl.html.includes("#1B3A2D"));
    }
  });
});
