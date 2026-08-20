// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-tipos-visibilidad.mjs — qué tipos de cita ve cada uno y quién ve
 * la agenda de quién (20/08/2026).
 *
 *   node scripts/_smoke-citas-tipos-visibilidad.mjs
 *   node --test-name-pattern="agenda" scripts/_smoke-citas-tipos-visibilidad.mjs
 *
 * Prueba lo que DEVUELVEN `lib/citas/tiposVisibles.js` y `lib/citas/visibilidad.js`,
 * con objetos y modelos de mentira: sin base de datos ni servidor.
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 *
 * Las dos reglas custodian dinero y datos personales, y sus errores van en
 * direcciones opuestas y se ven tarde:
 *
 *   · TIPOS DE CITA (`tiposVisibles.js`): la decisión la comparten el listado
 *     público del widget, el `/book` que crea la reserva y el portal. Si se
 *     ENSEÑA de más, un tipo oculto pensado para quien ya pagó por
 *     transferencia queda a la vista y alguien se cuela —esas citas figuran
 *     como gratuitas: ninguna alarma hasta la quinta sesión regalada—, o una
 *     «Supervisión profesional» (una sesión entre colegas, nutri_laura, 60 €)
 *     la reserva cualquiera, que es lo que pasó hasta el 12/08/2026. Si se
 *     CIERRA de más, la paciente que sí pagó vuelve a pedir hora por WhatsApp,
 *     o encender `soloConPago` deja la valoración gratuita imposible de
 *     reservar — pasó en producción el mismo día que se encendió (05/08/2026).
 *
 *   · AGENDA (`visibilidad.js`): el listado enseña nombre, email y teléfono
 *     del paciente. Un profesional no admin solo ve LO SUYO —sus citas y las
 *     sin asignar—, salvo que el centro encienda `agendaCompartida`, como
 *     Aumenta (01/08/2026). El fallo de nutri_laura del 19/08 estaba en el
 *     `if` que envolvía el filtro, no en el filtro: eso lo vigila
 *     `_smoke-citas-visibilidad.mjs` leyendo los endpoints. AQUÍ se fija lo
 *     que devuelven las funciones — y en particular `tiposConBonoActivo`
 *     (qué ocultos se destapan, contando el bono desde sus propias citas),
 *     que no tenía prueba en ninguna de las smokes viejas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  exigePasarela,
  tiposConBonoActivo,
  filtrarTiposPara,
  slugsSoloProfesionales,
  esSoloParaProfesionales,
  soloSuPrograma,
  puedeReservar,
} from "../lib/citas/tiposVisibles.js";
import {
  agendaCompartida,
  veTodaLaAgenda,
  soloLoSuyo,
  esSuya,
  NADIE_DEL_EQUIPO,
} from "../lib/citas/visibilidad.js";

/*
 * Los operadores del ORM son símbolos del registro global (`Symbol.for`), así
 * que el trozo de `where` que devuelve `soloLoSuyo` se puede leer y comparar
 * sin importar el paquete que los define — que una prueba ligera no arrastra.
 */
const OR = Symbol.for("or");
const EQ = Symbol.for("eq");
const IS = Symbol.for("is");

/* ── Un catálogo como el de nutri_laura ──────────────────────────────────── */

const VALORACION = {
  id: "valoracion",
  slug: "valoracion-inicial",
  isHidden: false,
  isInitialAssessment: true,
};
const CONSULTA = { id: "consulta", slug: "consulta", isHidden: false };
const PROGRAMA6 = { id: "programa6", slug: "programa-6-sesiones", isHidden: true };
const PROGRAMA12 = { id: "programa12", slug: "programa-12-sesiones", isHidden: true };
const SUPERVISION = { id: "supervision", slug: "supervision-profesional", isHidden: false };
const CATALOGO = [VALORACION, CONSULTA, PROGRAMA6, PROGRAMA12, SUPERVISION];

const LAURA = { settings: { citas: { tiposSoloProfesionales: ["supervision-profesional"] } } };

const ids = (tipos) => tipos.map((t) => t.id);

/* ── Modelos de mentira para tiposConBonoActivo ──────────────────────────── */

/** Los packs que hay y las citas de cada uno, sin tocar ninguna base. */
function modelosCon(packs, citasPorPack = {}) {
  return {
    SessionPack: { findAll: async () => packs },
    Booking: { findAll: async ({ where }) => citasPorPack[where.packId] ?? [] },
  };
}

const pack = (id, eventTypeId, totalSessions) => ({ id, eventTypeId, totalSessions });

const REALIZADA = { status: "completed" };
const FUTURA = { status: "confirmed" };
// Instantes en UTC con Z a propósito: la prueba dice lo mismo en cualquier zona.
const canceladaCon = (horasDeAntelacion) => ({
  status: "cancelled",
  scheduledAt: "2026-09-10T10:00:00.000Z",
  cancelledAt: new Date(Date.UTC(2026, 8, 10, 10 - horasDeAntelacion)).toISOString(),
});

/** Ejecuta `fn` recogiendo lo que se escriba en stderr, y lo restaura siempre. */
async function capturandoStderr(fn) {
  const original = process.stderr.write;
  let escrito = "";
  process.stderr.write = (trozo) => {
    escrito += trozo;
    return true;
  };
  try {
    const resultado = await fn();
    return { resultado, escrito };
  } finally {
    process.stderr.write = original;
  }
}

/* ══ tiposVisibles.js ══════════════════════════════════════════════════════ */

describe("el interruptor de caja (soloConPago) nace apagado", () => {
  it("un tenant recién creado, o sin settings, no exige pasar por caja (Aumenta: 62 tipos sin precio)", () => {
    assert.equal(exigePasarela({}), false);
    assert.equal(exigePasarela(null), false);
    assert.equal(exigePasarela({ settings: { citas: {} } }), false);
  });

  it("solo un true de verdad lo enciende; «true» de texto o 1 no", () => {
    assert.equal(exigePasarela({ settings: { citas: { soloConPago: true } } }), true);
    assert.equal(exigePasarela({ settings: { citas: { soloConPago: "true" } } }), false);
    assert.equal(exigePasarela({ settings: { citas: { soloConPago: 1 } } }), false);
  });
});

describe("la lista de tipos solo-para-profesionales se lee de los ajustes", () => {
  it("sin lista, o con algo que no es una lista, no hay tipos reservados", () => {
    assert.equal(slugsSoloProfesionales(null).size, 0);
    assert.equal(slugsSoloProfesionales({}).size, 0);
    assert.equal(
      slugsSoloProfesionales({ settings: { citas: { tiposSoloProfesionales: "supervision" } } })
        .size,
      0
    );
  });

  it("se normalizan los DOS lados (espacios, mayúsculas) y se tira lo que no es un slug", () => {
    const tenant = {
      settings: {
        citas: { tiposSoloProfesionales: ["  Supervision-Profesional  ", "", 3, null] },
      },
    };
    assert.deepEqual(slugsSoloProfesionales(tenant), new Set(["supervision-profesional"]));
    assert.equal(esSoloParaProfesionales({ slug: " SUPERVISION-PROFESIONAL " }, tenant), true);
  });

  it("acepta la lista ya hecha o el tenant entero; sin slug o con otro slug, nunca es de profesionales", () => {
    assert.equal(esSoloParaProfesionales(SUPERVISION, new Set(["supervision-profesional"])), true);
    assert.equal(esSoloParaProfesionales(SUPERVISION, LAURA), true);
    assert.equal(esSoloParaProfesionales({ id: "sin-slug" }, LAURA), false);
    assert.equal(esSoloParaProfesionales({ slug: "supervision" }, LAURA), false);
    assert.equal(esSoloParaProfesionales(SUPERVISION, {}), false);
  });
});

describe("qué tipos ve cada uno en el listado (filtrarTiposPara)", () => {
  it("una visitante anónima ve los públicos y ningún oculto", () => {
    assert.deepEqual(ids(filtrarTiposPara(CATALOGO, new Set(), { tenant: LAURA })), [
      "valoracion",
      "consulta",
    ]);
  });

  it("sin lista de profesionales configurada, nada cambia para el resto de clientes: la supervisión se ve", () => {
    assert.deepEqual(ids(filtrarTiposPara(CATALOGO, new Set())), [
      "valoracion",
      "consulta",
      "supervision",
    ]);
  });

  it("el bono destapa SU tipo oculto, y solo el suyo", () => {
    assert.deepEqual(ids(filtrarTiposPara(CATALOGO, new Set(["programa6"]), { tenant: LAURA })), [
      "valoracion",
      "consulta",
      "programa6",
    ]);
  });

  it("un bono de otro tipo no destapa nada", () => {
    assert.deepEqual(ids(filtrarTiposPara(CATALOGO, new Set(["consulta"]), { tenant: LAURA })), [
      "valoracion",
      "consulta",
    ]);
  });

  it("sin conjunto de permitidos, o con algo que no es un Set, no se destapa nada", () => {
    assert.deepEqual(filtrarTiposPara([PROGRAMA6]), []);
    // Un array se ignora a propósito: la lista buena sale de tiposConBonoActivo.
    assert.deepEqual(filtrarTiposPara([PROGRAMA6], ["programa6"]), []);
  });

  it("un tipo antiguo, sin la columna isHidden, se trata como público", () => {
    assert.deepEqual(ids(filtrarTiposPara([{ id: "viejo" }], new Set())), ["viejo"]);
  });

  it("la supervisión solo la ve quien viene marcado como profesional", () => {
    const anonima = filtrarTiposPara(CATALOGO, new Set(), { esProfesional: false, tenant: LAURA });
    const colega = filtrarTiposPara(CATALOGO, new Set(), { esProfesional: true, tenant: LAURA });
    assert.equal(
      anonima.some((t) => t.id === "supervision"),
      false
    );
    assert.deepEqual(ids(colega), ["valoracion", "consulta", "supervision"]);
  });

  it("un tipo oculto Y de profesionales exige las dos cosas a la vez", () => {
    const supOculta = { id: "sup-oculta", slug: "supervision-profesional", isHidden: true };
    const conBono = new Set(["sup-oculta"]);
    assert.deepEqual(
      filtrarTiposPara([supOculta], new Set(), { esProfesional: true, tenant: LAURA }),
      []
    );
    assert.deepEqual(
      filtrarTiposPara([supOculta], conBono, { esProfesional: false, tenant: LAURA }),
      []
    );
    assert.deepEqual(
      ids(filtrarTiposPara([supOculta], conBono, { esProfesional: true, tenant: LAURA })),
      ["sup-oculta"]
    );
  });

  it("con algo que no es una lista de tipos devuelve [], no revienta", () => {
    assert.deepEqual(filtrarTiposPara(null, new Set()), []);
    assert.deepEqual(filtrarTiposPara(undefined, new Set()), []);
  });
});

describe("quien tiene un programa en marcha SOLO ve ese (soloSuPrograma)", () => {
  const publicos = filtrarTiposPara(CATALOGO, new Set(), { tenant: LAURA });

  it("sin bonos activos no estrecha nada: devuelve la MISMA lista (y es como se apaga solo al agotarse)", () => {
    assert.equal(soloSuPrograma(publicos, new Set()), publicos);
  });

  it("con bono de un oculto, solo su programa: el resto del catálogo es ruido e invita a pagar dos veces", () => {
    const suyo = new Set(["programa6"]);
    assert.deepEqual(
      ids(soloSuPrograma(filtrarTiposPara(CATALOGO, suyo, { tenant: LAURA }), suyo)),
      ["programa6"]
    );
  });

  it("también estrecha si el bono es de un tipo público", () => {
    const suyo = new Set(["consulta"]);
    assert.deepEqual(ids(soloSuPrograma(publicos, suyo)), ["consulta"]);
  });

  it("dos bonos a la vez: los dos, y nada más", () => {
    const dos = new Set(["programa6", "consulta"]);
    assert.deepEqual(ids(soloSuPrograma(filtrarTiposPara(CATALOGO, dos, { tenant: LAURA }), dos)), [
      "consulta",
      "programa6",
    ]);
  });

  it("si su tipo se desactivó con el bono vivo, catálogo entero: nunca se queda sin nada que reservar", () => {
    const fantasma = new Set(["tipo-que-ya-no-existe"]);
    assert.equal(soloSuPrograma(publicos, fantasma), publicos);
  });

  it("bono de la supervisión sin estar marcada: el filtro de profesionales gana y no la deja encerrada", () => {
    const suyo = new Set(["supervision"]);
    const visibles = filtrarTiposPara(CATALOGO, suyo, { esProfesional: false, tenant: LAURA });
    assert.deepEqual(ids(soloSuPrograma(visibles, suyo)), ["valoracion", "consulta"]);
  });

  it("un permitidos que no es un Set no estrecha", () => {
    assert.equal(soloSuPrograma(CATALOGO, null), CATALOGO);
    assert.equal(soloSuPrograma(CATALOGO, ["programa6"]), CATALOGO);
  });

  it("una lista vacía se queda vacía", () => {
    assert.deepEqual(soloSuPrograma([], new Set(["programa6"])), []);
  });
});

describe("la puerta de verdad: puedeReservar, la que aplica /book con el id del cuerpo", () => {
  const NO_DISPONIBLE = "Este tipo de cita no está disponible para reservar online.";

  it("un tipo público sin puertas encendidas se reserva: {ok: true} y nada más", () => {
    assert.deepEqual(puedeReservar(CONSULTA, {}), { ok: true });
    assert.deepEqual(puedeReservar(CONSULTA, { seCobra: true }), { ok: true });
  });

  it("oculto sin bono NO pasa aunque el id se mande a mano: el filtro del listado no es la seguridad", () => {
    assert.deepEqual(puedeReservar(PROGRAMA6, { tieneBono: false, seCobra: true }), {
      ok: false,
      motivo: NO_DISPONIBLE,
    });
  });

  it("oculto con bono pasa, y sin cobrar: ya lo pagó", () => {
    assert.deepEqual(puedeReservar(PROGRAMA6, { tieneBono: true, seCobra: false }), { ok: true });
  });

  it("la supervisión: sin marcar no; marcado sí; y un BONO NO la abre (esa puerta va antes a propósito)", () => {
    assert.equal(puedeReservar(SUPERVISION, { tenant: LAURA, esProfesional: false }).ok, false);
    assert.equal(puedeReservar(SUPERVISION, { tenant: LAURA, esProfesional: true }).ok, true);
    assert.equal(
      puedeReservar(SUPERVISION, { tenant: LAURA, esProfesional: false, tieneBono: true }).ok,
      false
    );
  });

  it("con la caja encendida: gratuita sin bono no; de pago sí; cubierta por un bono ya pagado, sí", () => {
    assert.equal(puedeReservar(CONSULTA, { exigePago: true, seCobra: false }).ok, false);
    assert.equal(puedeReservar(CONSULTA, { exigePago: true, seCobra: true }).ok, true);
    assert.equal(
      puedeReservar(CONSULTA, { exigePago: true, seCobra: false, tieneBono: true }).ok,
      true
    );
  });

  it("la valoración inicial se salta la caja: es la puerta de entrada del embudo y es gratuita", () => {
    assert.deepEqual(puedeReservar(VALORACION, { exigePago: true, seCobra: false }), { ok: true });
  });

  it("pero una valoración OCULTA sigue exigiendo bono: el punto 1 va antes", () => {
    assert.equal(
      puedeReservar({ ...VALORACION, isHidden: true }, { exigePago: true, seCobra: false }).ok,
      false
    );
  });

  it("con la caja apagada, lo de siempre: la gratuita de un centro que cobra por fuera (Aumenta) pasa", () => {
    assert.equal(puedeReservar(CONSULTA, { exigePago: false, seCobra: false }).ok, true);
  });

  it("TODOS los rechazos dicen lo mismo: el endpoint no chiva qué existe en el catálogo", () => {
    const motivos = [
      puedeReservar(PROGRAMA6, {}).motivo,
      puedeReservar(CONSULTA, { exigePago: true }).motivo,
      puedeReservar(SUPERVISION, { tenant: LAURA }).motivo,
    ];
    for (const m of motivos) assert.equal(m, NO_DISPONIBLE);
  });

  it("un tipo que no llega (null) no es asunto suyo: /book hace findOne y corta con 404 ANTES de preguntar aquí", () => {
    assert.deepEqual(puedeReservar(null, {}), { ok: true });
    assert.deepEqual(puedeReservar(undefined, {}), { ok: true });
  });
});

describe("los bonos que destapan ocultos (tiposConBonoActivo, con modelos falsos)", () => {
  it("sin correo no hay bonos y NI SE CONSULTA: es la visitante anónima", async () => {
    let llamadas = 0;
    const modelos = {
      SessionPack: {
        findAll: async () => {
          llamadas += 1;
          return [];
        },
      },
      Booking: { findAll: async () => [] },
    };
    assert.deepEqual(await tiposConBonoActivo(modelos, null), new Set());
    assert.deepEqual(await tiposConBonoActivo(modelos, ""), new Set());
    assert.equal(llamadas, 0);
  });

  it("sin los modelos (schema sin la tabla montada) devuelve vacío, no revienta", async () => {
    assert.deepEqual(await tiposConBonoActivo({}, "ana@example.com"), new Set());
    assert.deepEqual(await tiposConBonoActivo({ Booking: {} }, "ana@example.com"), new Set());
  });

  it("sin ningún bono comprado, vacío", async () => {
    assert.deepEqual(await tiposConBonoActivo(modelosCon([]), "ana@example.com"), new Set());
  });

  it("un bono con sesiones libres destapa su tipo", async () => {
    const modelos = modelosCon([pack("p1", "programa6", 6)], { p1: [REALIZADA, REALIZADA] });
    assert.deepEqual(await tiposConBonoActivo(modelos, "ana@example.com"), new Set(["programa6"]));
  });

  it("un bono agotado ya no da derecho a nada: quien gastó sus sesiones deja de ver el oculto", async () => {
    const modelos = modelosCon([pack("p1", "programa6", 2)], { p1: [REALIZADA, REALIZADA] });
    assert.deepEqual(await tiposConBonoActivo(modelos, "ana@example.com"), new Set());
  });

  it("las citas futuras también descuentan: con la última sesión ya reservada, el bono cuenta como agotado", async () => {
    const modelos = modelosCon([pack("p1", "programa6", 2)], { p1: [REALIZADA, FUTURA] });
    assert.deepEqual(await tiposConBonoActivo(modelos, "ana@example.com"), new Set());
  });

  it("cancelar con 24 h o más devuelve la sesión al bono: sigue vivo y sigue destapando", async () => {
    const modelos = modelosCon([pack("p1", "programa6", 1)], { p1: [canceladaCon(48)] });
    assert.deepEqual(await tiposConBonoActivo(modelos, "ana@example.com"), new Set(["programa6"]));
  });

  it("cancelar tarde (menos de 24 h) la gasta: el bono de una sesión queda agotado", async () => {
    const modelos = modelosCon([pack("p1", "programa6", 1)], { p1: [canceladaCon(10)] });
    assert.deepEqual(await tiposConBonoActivo(modelos, "ana@example.com"), new Set());
  });

  it("una falta justificada no gasta; sin justificar (o sin clasificar), sí", async () => {
    const justificada = modelosCon([pack("p1", "programa6", 1)], {
      p1: [{ status: "no_show", noShowJustified: true }],
    });
    assert.deepEqual(await tiposConBonoActivo(justificada, "a@b.com"), new Set(["programa6"]));

    const sinClasificar = modelosCon([pack("p1", "programa6", 1)], {
      p1: [{ status: "no_show", noShowJustified: null }],
    });
    assert.deepEqual(await tiposConBonoActivo(sinClasificar, "a@b.com"), new Set());
  });

  it("varios bonos: cada tipo se destapa si ALGÚN bono suyo sigue vivo, aunque otro esté agotado", async () => {
    const modelos = modelosCon(
      [pack("p1", "programa6", 2), pack("p2", "programa12", 6), pack("p3", "programa6", 6)],
      { p1: [REALIZADA, REALIZADA], p2: [REALIZADA], p3: [] }
    );
    assert.deepEqual(
      await tiposConBonoActivo(modelos, "ana@example.com"),
      new Set(["programa12", "programa6"])
    );
  });

  it("la tabla que no existe (42P01, pasó de verdad con healim) da vacío y sin ruido", async () => {
    const err = Object.assign(new Error("relation session_packs does not exist"), {
      parent: { code: "42P01" },
    });
    const modelos = {
      SessionPack: {
        findAll: async () => {
          throw err;
        },
      },
      Booking: { findAll: async () => [] },
    };
    const { resultado, escrito } = await capturandoStderr(() =>
      tiposConBonoActivo(modelos, "ana@example.com")
    );
    assert.deepEqual(resultado, new Set());
    assert.equal(escrito, "");
  });

  it("el mismo código en `original` (el otro envoltorio del error), y en la SEGUNDA consulta, también calla", async () => {
    const err = Object.assign(new Error("relation bookings does not exist"), {
      original: { code: "42P01" },
    });
    const modelos = {
      SessionPack: { findAll: async () => [pack("p1", "programa6", 6)] },
      Booking: {
        findAll: async () => {
          throw err;
        },
      },
    };
    const { resultado, escrito } = await capturandoStderr(() =>
      tiposConBonoActivo(modelos, "ana@example.com")
    );
    assert.deepEqual(resultado, new Set());
    assert.equal(escrito, "");
  });

  it("cualquier otro tropiezo también cierra —se enseñan MENOS tipos, nunca más— y deja su aviso", async () => {
    const modelos = {
      SessionPack: {
        findAll: async () => {
          throw new Error("la base tiene hipo");
        },
      },
      Booking: { findAll: async () => [] },
    };
    const { resultado, escrito } = await capturandoStderr(() =>
      tiposConBonoActivo(modelos, "ana@example.com")
    );
    assert.deepEqual(resultado, new Set());
    assert.match(escrito, /no se pudieron leer los bonos/);
  });
});

/* ══ visibilidad.js ════════════════════════════════════════════════════════ */

describe("quién ve toda la agenda: dirección siempre; el equipo, solo si el centro la comparte", () => {
  const centro = (comparte) => ({ settings: { citas: { agendaCompartida: comparte } } });

  it("admin y superadmin ven toda la agenda, la comparta el centro o no", () => {
    assert.equal(veTodaLaAgenda({ tenant: centro(false), role: "admin" }), true);
    assert.equal(veTodaLaAgenda({ tenant: centro(false), role: "superadmin" }), true);
    assert.equal(veTodaLaAgenda({ tenant: null, role: "admin" }), true);
  });

  it("un user por defecto NO: el listado enseña nombre, email y teléfono del paciente", () => {
    assert.equal(veTodaLaAgenda({ tenant: centro(false), role: "user" }), false);
    assert.equal(veTodaLaAgenda({ tenant: {}, role: "user" }), false);
  });

  it("con la agenda compartida (Aumenta, 28/07) el equipo entero la ve", () => {
    assert.equal(veTodaLaAgenda({ tenant: centro(true), role: "user" }), true);
    assert.equal(agendaCompartida(centro(true)), true);
  });

  it("compartir exige un true de verdad: «si», «true» o 1 no encienden nada", () => {
    assert.equal(agendaCompartida(centro("si")), false);
    assert.equal(agendaCompartida(centro("true")), false);
    assert.equal(agendaCompartida(centro(1)), false);
    assert.equal(veTodaLaAgenda({ tenant: centro("si"), role: "user" }), false);
  });

  it("sin tenant o sin settings, cerrado", () => {
    assert.equal(agendaCompartida(null), false);
    assert.equal(agendaCompartida({}), false);
    assert.equal(veTodaLaAgenda({ tenant: null, role: "user" }), false);
  });

  it("un rol desconocido o mal escrito no es dirección: se le trata como equipo", () => {
    assert.equal(veTodaLaAgenda({ tenant: centro(false), role: "ADMIN" }), false);
    assert.equal(veTodaLaAgenda({ tenant: centro(false), role: "recepcion" }), false);
    assert.equal(veTodaLaAgenda({ tenant: centro(false), role: null }), false);
    // …y como equipo, la agenda compartida sí le abre (es una decisión del centro).
    assert.equal(veTodaLaAgenda({ tenant: centro(true), role: "recepcion" }), true);
  });
});

describe("el trozo de where de quien solo ve lo suyo (soloLoSuyo)", () => {
  it("sus citas Y las que no son de nadie: una cita sin asignar es trabajo por repartir, no de otra persona", () => {
    assert.deepEqual(soloLoSuyo("tm-1"), { [OR]: [{ [EQ]: "tm-1" }, { [IS]: null }] });
  });

  it("sin ficha resuelta (null o undefined) entra el centinela: ve las sin asignar y NINGUNA ajena", () => {
    assert.deepEqual(soloLoSuyo(null), { [OR]: [{ [EQ]: NADIE_DEL_EQUIPO }, { [IS]: null }] });
    assert.deepEqual(soloLoSuyo(undefined), { [OR]: [{ [EQ]: NADIE_DEL_EQUIPO }, { [IS]: null }] });
  });

  it("el centinela es un uuid de ceros, que no es de nadie", () => {
    assert.match(NADIE_DEL_EQUIPO, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  });

  it("con una ficha en blanco («») HOY compara con «», no con el centinela", () => {
    // SOSPECHOSO: "" no es null ni undefined, así que el `??` no lo cubre y el
    // fragmento queda comparando la columna uuid con una cadena vacía. En la
    // dirección segura (no casa con ninguna ajena), pero en la columna uuid de
    // producción ese literal no es un uuid válido y la consulta entera puede
    // reventar en vez de filtrar. Lo esperable sería el centinela, como con null.
    assert.deepEqual(soloLoSuyo(""), { [OR]: [{ [EQ]: "" }, { [IS]: null }] });
  });
});

describe("la misma regla de una en una (esSuya): el detalle y la puerta de editar, mover y cancelar", () => {
  it("la suya sí; la de otra, no", () => {
    assert.equal(esSuya({ teamMemberId: "tm-1" }, "tm-1"), true);
    assert.equal(esSuya({ teamMemberId: "tm-2" }, "tm-1"), false);
  });

  it("la que no es de nadie es de todas, con ficha o sin ella", () => {
    assert.equal(esSuya({ teamMemberId: null }, "tm-1"), true);
    assert.equal(esSuya({ teamMemberId: null }, null), true);
    assert.equal(esSuya({}, "tm-1"), true);
  });

  it("una ajena sin ficha resuelta, o con ficha en blanco, NO: falla en cerrado", () => {
    assert.equal(esSuya({ teamMemberId: "tm-2" }, null), false);
    assert.equal(esSuya({ teamMemberId: "tm-2" }, undefined), false);
    assert.equal(esSuya({ teamMemberId: "tm-2" }, ""), false);
  });

  it("el id puede llegar como número o como texto: cuenta igual", () => {
    assert.equal(esSuya({ teamMemberId: 7 }, "7"), true);
    assert.equal(esSuya({ teamMemberId: "7" }, 7), true);
  });

  it("esSuya y soloLoSuyo cuentan EXACTAMENTE lo mismo: si no, la cita se ve en el calendario y al abrirla «no existe»", () => {
    // Mini-evaluador del fragmento con la semántica de SQL: `=` nunca casa con
    // null (para eso está la rama IS NULL).
    const pasaElFiltro = (fragmento, teamMemberId) =>
      fragmento[OR].some((rama) =>
        EQ in rama ? teamMemberId !== null && teamMemberId === rama[EQ] : teamMemberId === null
      );
    for (const mi of ["tm-1", null]) {
      for (const de of ["tm-1", "tm-2", null]) {
        assert.equal(
          esSuya({ teamMemberId: de }, mi),
          pasaElFiltro(soloLoSuyo(mi), de),
          `de=${de} mi=${mi}: el listado y el detalle se contradicen`
        );
      }
    }
  });
});
