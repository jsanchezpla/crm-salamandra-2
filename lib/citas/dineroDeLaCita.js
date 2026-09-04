/**
 * lib/citas/dineroDeLaCita.js — toda cita nace atada a un dinero, y si no se
 * cobra es porque alguien lo dijo.
 *
 * (Fichero nuevo en /lib, regla #2: la misma regla la necesitan cuatro sitios
 * que no se conocen —el alta manual, el alta desde el widget público, la ficha
 * de la cita y el cobro del mes—. Escrita en cada uno se separaría a la
 * primera, y la que se separa deja citas sin cobrar sin que nadie lo vea.)
 *
 * ── EL ENCARGO (Rodrigo, 04/09/2026, Aumenta) ──────────────────────────────
 * «Para crear una cita tiene que estar asociada a una cuota o a un cobro de
 * texto libre, así cuando se crea una cita siempre está aparejada a un dinero
 * y se puede cobrar con comodidad y nunca se crean citas gratuitas sin
 * quererlo.»
 *
 * Lo que dolía, medido en producción el 04/09/2026: 13.408 citas, **ninguna**
 * con importe; 63 tipos de cita, **ninguno** con precio; 46 conceptos en el
 * catálogo —lo que Aumenta llama «cuotas»— sin ninguna relación con la agenda.
 * El dinero de una cita solo existía en la cabeza de quien la apuntaba, y al
 * cobrar el mes había que reconstruirlo mirando la agenda a mano.
 *
 * ── DE DÓNDE SALE EL DINERO: DEL TIPO (Rodrigo, 04/09/2026) ────────────────
 * El concepto se pone UNA vez en el tipo de cita (Citas → Tipos:
 * «LOGOPEDIA 45» → «Logopedia 45x1 · 50 €») y de ahí baja solo a cada cita que
 * se cree con ese tipo. Es lo que hace que la regla no cueste un clic más en
 * las ~250 citas que Aumenta apunta al día: con 63 tipos, elegir el concepto en
 * cada cita sería elegir siempre el mismo.
 *
 * En el alta se puede cambiar, y ahí están los tres modos —y solo tres:
 *
 *   · `cuota`     — la cubre un concepto del catálogo. Es el caso normal.
 *   · `libre`     — un cobro de texto libre: lo que se escriba y su importe.
 *                   Para lo que no está en el catálogo (un informe suelto, una
 *                   sesión extra pactada).
 *   · `sin_coste` — no se cobra, y se dice por qué. La recuperación de una
 *                   falta justificada, una reunión, una cita de cortesía.
 *
 * ── POR QUÉ `sin_coste` NO ES «DEJARLO VACÍO» ──────────────────────────────
 * Es la mitad del encargo. «Nunca se crean citas gratuitas SIN QUERERLO» no
 * dice que no haya citas gratuitas: dice que una cita gratuita tiene que ser
 * una decisión, no un olvido. Por eso hay una tercera opción explícita con su
 * motivo escrito, y por eso el motivo es obligatorio: dentro de tres meses,
 * «sin coste» a secas no distingue una cortesía de un despiste.
 *
 * ── LO QUE SE GUARDA ES UNA FOTO ───────────────────────────────────────────
 * `cobroTexto` e `cobroImporte` se copian del concepto AL CREAR la cita, como
 * hace `bookings.amount` con el precio del tipo. Si en enero sube la tarifa, la
 * cita de octubre sigue diciendo lo que se cobró de verdad. `cobroConceptId`
 * se guarda además para poder agrupar por concepto al cobrar el mes.
 *
 * ── QUIÉN LO EXIGE ─────────────────────────────────────────────────────────
 * `settings.citas.cobroObligatorio` (Configuración → Citas), como el resto de
 * los interruptores de este módulo, que NO viven en `tenant_modules`. Nace
 * apagado: sin él, la cita hereda el concepto de su tipo si lo tiene y no se
 * exige nada, que es exactamente como se comportaba el CRM ayer.
 */

/** Los tres modos, y no hay más. */
export const MODOS_COBRO = Object.freeze(["cuota", "libre", "sin_coste"]);

/** Cuánto texto hace falta para que un motivo o un concepto digan algo. */
const MIN_TEXTO = 2;
const MAX_TEXTO = 200;

/** ¿Este centro exige que toda cita nazca con su dinero? */
export function cobroObligatorio(tenant) {
  const t = tenant?.toJSON ? tenant.toJSON() : tenant;
  return t?.settings?.citas?.cobroObligatorio === true;
}

/**
 * Euros (lo que guarda `billing_concepts.unit_price`, un DECIMAL que Sequelize
 * devuelve como texto) → céntimos enteros, que es como guarda el dinero la
 * agenda (`bookings.amount`). Devuelve null si no hay un número detrás.
 */
export function centimosDeEuros(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Céntimos → «50,00 €», para lo que se lee en pantalla. */
export function euros(centimos) {
  if (centimos == null || !Number.isFinite(Number(centimos))) return "—";
  return `${(Number(centimos) / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function texto(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * El cobro que le toca por defecto a una cita de este tipo: el concepto que
 * lleva el tipo, con su nombre y su precio copiados. Null si el tipo no tiene
 * concepto puesto — que es como nacen todos hasta que alguien los rellena.
 *
 * `concepto` es la fila de `billing_concepts` ya cargada (o su JSON): esta
 * función es pura y no va a la base.
 */
export function cobroDelTipo(concepto) {
  const c = concepto?.toJSON ? concepto.toJSON() : concepto;
  if (!c?.id) return null;
  return {
    modo: "cuota",
    conceptId: c.id,
    texto: texto(c.name).slice(0, MAX_TEXTO) || "Cuota",
    importe: centimosDeEuros(c.unitPrice ?? c.unit_price) ?? 0,
  };
}

/**
 * Valida y normaliza lo que llega del navegador (o de otro endpoint) a las
 * cuatro columnas que se guardan.
 *
 * Devuelve `{ cobro }` con `{ modo, conceptId, texto, importe }`, o
 * `{ error }` con una frase que se le puede enseñar a quien apunta la cita.
 *
 * @param bruto        lo que manda el cliente: { modo, conceptId, texto, importe }
 * @param concepto     la fila del concepto elegido, si el modo es `cuota`
 * @param exigido      si el centro obliga a que toda cita lleve dinero
 * @param porDefecto   el cobro heredado del tipo, cuando no se manda nada
 */
export function normalizarCobro(bruto, { concepto = null, exigido = false, porDefecto = null } = {}) {
  const modo = texto(bruto?.modo);

  // Nada dicho: se hereda lo del tipo. Si el centro lo exige y el tipo tampoco
  // lo tiene, no se puede crear la cita — que es justo el freno que se pidió.
  if (!modo) {
    if (porDefecto) return { cobro: porDefecto };
    if (exigido) {
      return {
        error:
          "Esta cita no lleva dinero asociado: elige la cuota que la cubre, escribe un cobro, " +
          "o márcala como sin coste diciendo por qué.",
      };
    }
    return { cobro: null };
  }

  if (!MODOS_COBRO.includes(modo)) return { error: `Modo de cobro desconocido: ${modo}` };

  if (modo === "cuota") {
    const c = concepto?.toJSON ? concepto.toJSON() : concepto;
    if (!c?.id) return { error: "Elige la cuota (concepto) que cubre la cita" };
    const desdeConcepto = cobroDelTipo(c);
    // El importe se puede pisar (una cuota pactada distinta para esa familia);
    // si no viene, manda el precio del catálogo.
    const importe = bruto?.importe === "" || bruto?.importe == null ? desdeConcepto.importe : Number(bruto.importe);
    if (!Number.isFinite(importe) || importe < 0) return { error: "El importe de la cuota no es un número válido" };
    return { cobro: { ...desdeConcepto, importe: Math.round(importe) } };
  }

  if (modo === "libre") {
    const t = texto(bruto?.texto);
    if (t.length < MIN_TEXTO) return { error: "Escribe qué se cobra en esta cita" };
    const importe = Number(bruto?.importe);
    if (!Number.isFinite(importe) || importe <= 0) return { error: "Escribe cuánto se cobra por esta cita" };
    return { cobro: { modo: "libre", conceptId: null, texto: t.slice(0, MAX_TEXTO), importe: Math.round(importe) } };
  }

  // sin_coste
  const motivo = texto(bruto?.texto);
  if (motivo.length < MIN_TEXTO) {
    return { error: "Di por qué esta cita no se cobra (recuperación, reunión, cortesía…)" };
  }
  return { cobro: { modo: "sin_coste", conceptId: null, texto: motivo.slice(0, MAX_TEXTO), importe: 0 } };
}

/** ¿Esta cita se cobra? `false` en las de sin coste y en las que no lo dicen. */
export function seCobra(booking) {
  const b = booking?.toJSON ? booking.toJSON() : booking;
  return (b?.cobroModo === "cuota" || b?.cobroModo === "libre") && Number(b?.cobroImporte) > 0;
}

/**
 * Cómo se lee el dinero de una cita en pantalla: «Logopedia 45x1 · 50,00 €»,
 * «Sin coste · recuperación de falta», o null en las citas de antes de esto
 * (que son 13.408 en Aumenta y no llevan nada).
 */
export function resumenCobro(booking) {
  const b = booking?.toJSON ? booking.toJSON() : booking;
  if (!b?.cobroModo) return null;
  const t = texto(b.cobroTexto);
  if (b.cobroModo === "sin_coste") return t ? `Sin coste · ${t}` : "Sin coste";
  return [t, euros(b.cobroImporte)].filter(Boolean).join(" · ");
}

/**
 * Lo que hay que cobrarle a una familia en un mes, sacado de sus citas de ese
 * mes. Es lo que rellena el cobro sin tener que reconstruirlo mirando la
 * agenda.
 *
 * ── UNA CUOTA NO SE MULTIPLICA POR LAS CITAS ───────────────────────────────
 * Esta es la parte que hay que leer despacio, porque equivocarla es cobrarle
 * de más a una familia. Un concepto del catálogo de Aumenta es la cuota
 * MENSUAL —«Logopedia 60x2 · 190 €» son dos sesiones a la semana durante un
 * mes, no 190 € por sesión—. Así que las citas cubiertas por la misma cuota
 * suman UNA vez: ocho sesiones de logopedia en octubre son 190 €, no 1.520.
 * Lo que dicen las ocho citas es que esa cuota está viva ese mes, y cuántas
 * veces vino.
 *
 * Un cobro de texto libre es lo contrario: es de ESA cita («informe para el
 * colegio, 40 €»), así que dos citas con cobro libre son dos cobros y sí se
 * suman.
 *
 * Las de `sin_coste` no aparecen: no hay nada que cobrar.
 *
 * Devuelve `{ cuotas, sueltos, total }`, cada línea con `{ conceptId, texto,
 * importe, citas }` y ordenadas de más a menos dinero.
 */
export function loQueSeCobraDe(bookings) {
  const cuotas = new Map();
  const sueltos = new Map();
  for (const b of Array.isArray(bookings) ? bookings : []) {
    if (!seCobra(b)) continue;
    const j = b?.toJSON ? b.toJSON() : b;
    const importe = Number(j.cobroImporte) || 0;
    if (j.cobroModo === "cuota") {
      const clave = j.cobroConceptId ?? `sin-id:${texto(j.cobroTexto)}`;
      const previo = cuotas.get(clave);
      // La cuota NO se suma: se cuenta cuántas citas la usaron y se queda con
      // el importe mayor de las que la traen (si alguien pactó otro precio con
      // esa familia, es el que vale).
      if (previo) {
        previo.citas += 1;
        previo.importe = Math.max(previo.importe, importe);
      } else {
        cuotas.set(clave, { conceptId: j.cobroConceptId ?? null, texto: texto(j.cobroTexto), importe, citas: 1 });
      }
    } else {
      const clave = `libre:${texto(j.cobroTexto)}`;
      const previo = sueltos.get(clave);
      if (previo) {
        previo.importe += importe;
        previo.citas += 1;
      } else {
        sueltos.set(clave, { conceptId: null, texto: texto(j.cobroTexto), importe, citas: 1 });
      }
    }
  }
  const porDinero = (a, b) => b.importe - a.importe;
  const lineasCuota = [...cuotas.values()].sort(porDinero);
  const lineasSueltas = [...sueltos.values()].sort(porDinero);
  const suma = (ls) => ls.reduce((s, l) => s + l.importe, 0);
  return { cuotas: lineasCuota, sueltos: lineasSueltas, total: suma(lineasCuota) + suma(lineasSueltas) };
}
