/**
 * lib/billing/motivoDelCobro.js — de dónde sale el importe de un cobro de cuota
 * (08/09/2026, AV-0085 y AV-0086 de Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Rosa escribió TRES veces el mismo día porque un número no se explicaba solo,
 * y es la persona que cobra. En el cajón de registrar un cobro se ven, en el
 * mismo cuadro, dos cifras que no cuadran: arriba los conceptos a precio de
 * TARIFA (145 + 145 = 290) y abajo el total de los cobros pendientes de verdad
 * (260 + 115 = 375). Nada dice por qué no coinciden.
 *
 * Y la explicación estaba escrita, palabra por palabra, en el campo `notes` de
 * cada cobro: «Pendiente según Organízate: 260.00 €», «Reserva de plaza ya
 * abonada: −30 €». Medido en producción el 08/09/2026: los 159 cobros
 * pendientes de cuota de septiembre llevan nota, los 159. La información
 * estaba en la base y no en los ojos de quien cobra.
 *
 * ── LA FORMA DE LA NOTA, QUE ES NUESTRA ────────────────────────────────────
 * La escribe `notaDeCobro` (lib/billing/cuotas.js) y es una cadena de
 * segmentos separados por « — »:
 *
 *   Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota T.O. 45x1 — Reserva de
 *   plaza ya abonada: −30 € — Pendiente según Organízate: 260.00 € (Organízate
 *   #20182); el CRM tenía 145.00 €
 *
 *   [1] la cabecera        [2] los conceptos, unidos por « + »   [3…] los motivos
 *
 * Aquí solo vive el REPARTO de esa cadena. Es puro y no toca la base: lo
 * importa un componente de navegador, así que no puede arrastrar Sequelize.
 *
 * ── Y LO QUE EL CENTRO ESCRIBE A MANO DENTRO ──────────────────────────────
 * (09/09/2026, avisado por la sesión que puso los textos de factura.)
 *
 * La nota es un campo editable, y el centro escribe dentro. Medido: de los 281
 * cobros de cuota de septiembre, 278 siguen el molde y 3 no; y entre los que sí
 * lo siguen hay dos con un apunte a mano METIDO en el trozo del concepto, con
 * saltos de línea y todo:
 *
 *   «Cuota septiembre 2026 — Cuota Psicología 45x1 - Reserva … −30 €⏎⏎
 *    IMPORTANTE: SON 145€ DESCONTADO 30€ DE RESERVA. SALIAN POR DUPLICADO…»
 *
 * Sin cuidado, eso se pintaba como NOMBRE DEL CONCEPTO: trescientos caracteres
 * en mayúsculas donde va «Cuota Psicología 45x1». Y en el otro caso el apunte
 * («04/09/2026 descontar 15 euros de reserva») se perdía entero, porque el
 * nombre del catálogo ganaba y el trozo se tiraba — justo la frase que la
 * persona que cobra necesita leer.
 *
 * Así que el trozo del concepto se parte por SALTOS DE LÍNEA: la primera línea
 * es el concepto y lo demás son motivos. Y con un tope de largo: un concepto es
 * un nombre de catálogo, no un párrafo. Lo que pase de ahí baja a motivo.
 *
 * ── POR QUÉ HAY UNA LISTA DE MOTIVOS Y NO UNA HEURÍSTICA ───────────────────
 * El segundo segmento es el concepto SALVO cuando la cuota no tiene ninguno, y
 * entonces ahí va ya un motivo. Distinguirlos por «lleva dos puntos y una
 * cifra» no vale: hay un concepto del catálogo de Aumenta que se llama
 * «Terapia 1 h semanal + Grupal: 2 sesiones semanales de 1 h». Así que se mira
 * contra la lista de motivos que escribimos NOSOTROS, comprobada contra las
 * 102 formas distintas de nota que hay hoy en producción. Si algún día se
 * añade un motivo nuevo a `cuotas.js`, hay que añadirlo aquí — y la prueba de
 * `_smoke-cobro-motivos.mjs` es la que lo canta.
 */

import { esNotaAutomatica } from "./cuotas.js";

/**
 * El mismo separador con el que junta `notaDeCobro`: si se separan, esto deja de
 * leer.
 *
 * ⚠️ Y NO ES EL ÚNICO QUE LO LEE (09/09/2026). `scripts/backfill-payments-
 * invoice-text.js` parte la nota por este mismo « — » para quedarse con el
 * trozo de los conceptos y montar el texto que sale impreso en la factura de la
 * familia. O sea que el molde de `notaDeCobro` lo leen ya DOS piezas
 * independientes: cambiarlo rompe la otra. Lo cazan `_smoke-cobro-motivos.mjs`
 * (esta) y `_smoke-invoice-text.mjs` (aquella).
 */
export const SEPARADOR = " — ";

/**
 * Lo más largo que puede ser el nombre de un concepto. El más largo del
 * catálogo de Aumenta es «Terapia 1 h semanal + Grupal: 2 sesiones semanales de
 * 1 h» (56); 120 deja sitio de sobra y corta los párrafos escritos a mano.
 */
const MAX_CONCEPTO = 120;

/** Lo que devuelve `rotuloDeTramo`: «desde el 13/09/2026 (3 de 4 sesiones)». */
const ROTULO_TRAMO_RE = /^(del|desde el|hasta el)\s/i;

/**
 * Los motivos que escribe el CRM, tal cual empiezan. Comprobados contra las 102
 * formas de nota de producción (08/09/2026).
 */
const MOTIVO_RE =
  /^(reserva de plaza|\d+\s+reservas de plaza|pendiente seg[úu]n organ[íi]zate|cobrado (tambi[ée]n )?en organ[íi]zate|no se descuenta)/i;

/** ¿Este segmento es un motivo y no el nombre de los conceptos? */
function esMotivo(segmento) {
  const s = String(segmento ?? "").trim();
  return ROTULO_TRAMO_RE.test(s) || MOTIVO_RE.test(s);
}

/**
 * Los importes de un texto, en castellano y con céntimos.
 *
 * Las notas guardadas llevan el punto decimal de `toFixed` («260.00 €») y
 * alguna sin céntimos («−30 €»), mientras que la pantalla pinta el dinero con
 * `fmtMoney` («375,00 €»). Mezclar los dos formatos en el mismo cuadro —el que
 * se hizo justamente para que no haya dudas— es peor que no explicar nada.
 *
 * Solo toca lo que va pegado a un €: una fecha como «3/9/2026» o un rótulo
 * como «45x1» se quedan como están.
 */
export function importesEnEspanol(texto) {
  return String(texto ?? "").replace(/(-|−)?(\d+)(?:[.,](\d{1,2}))?(\s*)€/g, (_, signo, ent, dec, sep) => {
    const centimos = (dec ?? "").padEnd(2, "0");
    return `${signo ?? ""}${ent},${centimos}${sep || " "}€`;
  });
}

/**
 * Un motivo, dicho corto y sin el rastro técnico del volcado.
 *
 * «Pendiente según Organízate: 260.00 € (Organízate #20182, Organízate #20392);
 * el CRM tenía 145.00 €» → «Pendiente según Organízate: 260,00 €».
 *
 * El paréntesis se QUITA en su sitio en vez de cortar por él, porque en
 * «Cobrado también en Organízate (Organízate #123): el CRM ya lo tenía cobrado
 * a mano» lo que explica algo está detrás del paréntesis, no delante. Y un
 * rótulo de tramo —«desde el 13/09/2026 (3 de 4 sesiones)»— se queda ENTERO:
 * ahí el paréntesis ES la explicación.
 */
export function acortaMotivo(motivo) {
  let m = String(motivo ?? "").trim();
  if (!m) return "";
  if (!ROTULO_TRAMO_RE.test(m)) {
    m = m.replace(/\s*\([^()]*\)/, "").trim();
    const puntoYComa = m.indexOf("; ");
    if (puntoYComa > 0) m = m.slice(0, puntoYComa);
  }
  m = importesEnEspanol(m).replace(/\s+/g, " ").trim();
  return m.length > 90 ? `${m.slice(0, 89).trimEnd()}…` : m;
}

/**
 * Qué se cobra y por qué es esa cifra.
 *
 * @param {object} args
 * @param {?string} args.notes     el campo `notes` del cobro, tal cual.
 * @param {?string} args.concepto  el nombre del catálogo, si se ha podido
 *                                 resolver por `conceptId`. MANDA sobre lo que
 *                                 diga la nota: es el nombre de verdad.
 * @returns {{ concepto: string|null, motivos: string[] }}
 *
 * Nunca lanza. Sin nota devuelve `{ concepto, motivos: [] }`, y una nota
 * escrita a mano por alguien del centro sale entera como un motivo: es el único
 * sitio donde vive esa explicación y no se puede tirar.
 */
export function explicaCobro({ notes, concepto = null } = {}) {
  const delCatalogo = String(concepto ?? "").trim() || null;
  const texto = String(notes ?? "").trim();
  if (!texto) return { concepto: delCatalogo, motivos: [] };

  const trozos = texto.split(SEPARADOR).map((t) => t.trim()).filter(Boolean);

  // Nota escrita a mano: no lleva cabecera nuestra, así que no hay reparto que
  // hacer. Se enseña tal cual, que es justo lo que quiso decir quien la puso.
  if (!esNotaAutomatica(texto)) {
    return { concepto: delCatalogo, motivos: trozos.map(acortaMotivo).filter(Boolean) };
  }

  trozos.shift(); // la cabecera «Cuota septiembre 2026»
  let deLaNota = null;
  const aMano = [];
  if (trozos.length && !esMotivo(trozos[0])) {
    // El trozo del concepto, partido por saltos de línea: lo que el centro haya
    // escrito debajo es suyo y baja a motivo, no se pierde ni se pinta de
    // nombre. Y una primera línea desmedida tampoco es un concepto.
    const lineas = trozos.shift().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let cabeza = lineas.shift() ?? "";
    /*
     * Y si en esa primera línea el centro pegó un motivo con un guion normal
     * en vez de con el separador —«Cuota Psicología 45x1 - Reserva de plaza ya
     * abonada: −30 €», literal de producción—, se separa: el concepto es el
     * nombre y la reserva es un motivo, que es donde se lee.
     */
    const guion = cabeza.search(/\s[-–]\s/);
    if (guion > 0) {
      const cola = cabeza.slice(guion + 3).trim();
      if (esMotivo(cola)) {
        aMano.push(cola);
        cabeza = cabeza.slice(0, guion).trim();
      }
    }
    if (cabeza.length <= MAX_CONCEPTO) deLaNota = cabeza.replace(/[,;]+$/, "").trim();
    else aMano.push(cabeza);
    aMano.push(...lineas);
  }

  const motivos = [...trozos, ...aMano].map(acortaMotivo).filter(Boolean);
  // Si el nombre del catálogo manda y la nota decía otra cosa, esa otra cosa
  // también se enseña: puede ser el apunte de por qué ese mes es distinto.
  if (delCatalogo && deLaNota && deLaNota.toLowerCase() !== delCatalogo.toLowerCase()) {
    motivos.unshift(acortaMotivo(deLaNota));
  }

  return { concepto: delCatalogo ?? deLaNota, motivos: motivos.filter(Boolean) };
}
