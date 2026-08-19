// @prueba ligera — funciones de /lib con una tabla de cobros de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-portal-meses.mjs — qué meses de documentos ve la familia en su
 * área privada, y la excepción que el centro abre a mano (19/08/2026).
 *
 *   node scripts/_smoke-citas-portal-meses.mjs
 *   node --test-name-pattern="a mano" scripts/_smoke-citas-portal-meses.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/citas/portalMeses.js` (sprint Aumenta 2026-07, punto 2.3) es la ÚNICA
 * regla del bloqueo mensual por impago del portal de la familia
 * (`/widget/c/[slug]/mi-perfil`). La aplican TRES sitios: el listado «Mis
 * documentos» (`GET /api/public/c/[slug]/citas-portal/documents`), la descarga
 * de uno (`…/documents/[id]`, para que un enlace guardado no se salte el
 * cerrojo) y la pantalla del CRM que abre meses a mano
 * (`GET/PUT /api/clients/[id]/portal-months`). Si la regla se tuerce, una
 * familia ve un informe que no le toca, o deja de ver el suyo; al estar escrita
 * en un sitio y aplicada en tres, una prueba aquí vale por las tres.
 *
 * La cabecera del fichero dice cinco cosas y ninguna tenía prueba:
 *
 *   1. APAGADO POR DEFECTO: solo un `true` de verdad en
 *      `settings.citas.portalBloqueoImpago` lo enciende. Encenderlo sin querer
 *      en un centro que no registra cobros por mes esconde de golpe TODA la
 *      documentación de TODAS las familias;
 *   2. el mes M está abierto si hay un cobro COMPLETADO con `periodMonth` = M
 *      para esa familia, o si el centro lo abrió a mano
 *      (`Client.portalUnlockedMonths`: becas, acuerdos, cobros de fuera);
 *   3. lo que subió la propia familia NUNCA se retiene: es suyo;
 *   4. si el schema no tiene tabla de cobros (tenant sin facturación), solo
 *      cuentan los manuales y no revienta; cualquier OTRO error sí sube;
 *   5. al retener se dicen los meses y cuántos documentos hay en cada uno,
 *      nunca los títulos (el nombre de un informe clínico ya es sensible).
 *
 * `mesesAbiertos` recibe los modelos por parámetro, así que se prueba con un
 * `Payment` de mentira que filtra por el `where` que le piden —como haría la
 * tabla— y apunta qué le han pedido. `mesesAbiertos` NO mira el interruptor:
 * la puerta es `bloqueoImpagoActivo` en los tres llamadores, y por eso aquí se
 * prueba aparte y a conciencia.
 *
 * Fechas: siempre FIJAS, y construidas en hora local (`new Date(a, m, d, h)`) o
 * con ISO a mediodía. El mes de un instante depende de la zona horaria del
 * proceso, y una prueba que pase en Madrid y falle en el contenedor (UTC) no
 * sirve de nada.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bloqueoImpagoActivo,
  mesDe,
  mesesManuales,
  mesesAbiertos,
  filtrarPorMes,
} from "../lib/citas/portalMeses.js";

// ── Fechas fijas (hora local: el mes no depende de la zona horaria) ─────────
const AGO_19 = new Date(2026, 7, 19, 10, 30);
const FIN_AGO = new Date(2026, 7, 31, 23, 59, 59);
const INICIO_SEP = new Date(2026, 8, 1, 0, 0, 0);
const FIN_DIC = new Date(2026, 11, 31, 23, 59);
const INICIO_ENE = new Date(2027, 0, 1, 0, 0);
const JUL_10 = new Date(2026, 6, 10, 9, 0);
const JUN_03 = new Date(2026, 5, 3, 17, 15);
const MAY_20 = new Date(2026, 4, 20, 12, 0);

/** Un tenant con el interruptor como se le diga (o sin él). */
const tenantCon = (portalBloqueoImpago) => ({
  settings: { citas: { portalBloqueoImpago } },
});

/** Un documento como lo devuelve el archivo: del equipo salvo que se diga. */
function doc(id, createdAt, extra = {}) {
  return { id, fileName: `informe-${id}.pdf`, createdAt, uploadedByClient: false, ...extra };
}

/**
 * Una tabla de cobros de mentira: filtra por `where` como lo haría la base
 * (familia y estado), devuelve solo `periodMonth` y apunta qué le han pedido.
 * Con `revienta`, lanza ese error en vez de contestar.
 */
function pagosFalsos(filas = [], { revienta = null } = {}) {
  const llamadas = [];
  return {
    llamadas,
    Payment: {
      async findAll({ where, attributes }) {
        llamadas.push({ where, attributes });
        if (revienta) throw revienta;
        return filas
          .filter((f) => f.clientId === where.clientId && f.status === where.status)
          .map((f) => ({ periodMonth: f.periodMonth }));
      },
    },
  };
}

/** Un cobro de la familia `c-1`, completado salvo que se diga, del mes que sea. */
const cobro = (periodMonth, status = "completed", clientId = "c-1") => ({
  clientId,
  status,
  periodMonth,
});

/** El error que da la base cuando la tabla no existe (código 42P01), por una u otra rama. */
const sinTabla = (rama) =>
  Object.assign(new Error('relation "payments" does not exist'), { [rama]: { code: "42P01" } });

describe("bloqueoImpagoActivo: apagado por defecto, solo lo enciende un true de verdad", () => {
  it("sin tenant, sin settings o sin la rama citas: apagado", () => {
    assert.equal(bloqueoImpagoActivo(null), false);
    assert.equal(bloqueoImpagoActivo(undefined), false);
    assert.equal(bloqueoImpagoActivo({}), false);
    assert.equal(bloqueoImpagoActivo({ settings: null }), false);
    assert.equal(bloqueoImpagoActivo({ settings: {} }), false);
    assert.equal(bloqueoImpagoActivo({ settings: { citas: {} } }), false);
  });
  it("con el interruptor en true, encendido", () => {
    assert.equal(bloqueoImpagoActivo(tenantCon(true)), true);
  });
  it("con el interruptor en false, apagado", () => {
    assert.equal(bloqueoImpagoActivo(tenantCon(false)), false);
  });
  it("un texto, un número o cualquier cosa que no sea el booleano true cuenta como apagado", () => {
    assert.equal(bloqueoImpagoActivo(tenantCon("true")), false);
    assert.equal(bloqueoImpagoActivo(tenantCon("sí")), false);
    assert.equal(bloqueoImpagoActivo(tenantCon(1)), false);
    assert.equal(bloqueoImpagoActivo(tenantCon("on")), false);
    assert.equal(bloqueoImpagoActivo(tenantCon({})), false);
    assert.equal(bloqueoImpagoActivo(tenantCon(null)), false);
  });
  it("no lo enciende ningún otro interruptor: ni el portal SSO ni el resto de citas", () => {
    const tenant = {
      settings: {
        widget: { sso: { enabled: true } },
        citas: { soloConPago: true, contratoObligatorio: true },
      },
    };
    assert.equal(bloqueoImpagoActivo(tenant), false);
  });
});

describe("mesDe: el mes 'AAAA-MM' de una fecha", () => {
  it("una fecha Date da su año y su mes con dos cifras", () => {
    assert.equal(mesDe(AGO_19), "2026-08");
    assert.equal(mesDe(new Date(2026, 0, 5)), "2026-01");
    assert.equal(mesDe(new Date(2026, 10, 5)), "2026-11");
  });
  it("una cadena ISO con hora, también", () => {
    assert.equal(mesDe("2026-08-19T12:00:00.000Z"), "2026-08");
    assert.equal(mesDe("2026-03-05T12:00:00.000Z"), "2026-03");
  });
  it("una cadena solo fecha ('AAAA-MM-DD'), también", () => {
    assert.equal(mesDe("2026-08-19"), "2026-08");
  });
  it("la misma fecha como Date y como texto dan el mismo mes", () => {
    assert.equal(mesDe(new Date("2026-08-19T12:00:00.000Z")), mesDe("2026-08-19T12:00:00.000Z"));
  });
  it("el último instante del mes sigue siendo ese mes; el primero del siguiente, el siguiente", () => {
    assert.equal(mesDe(FIN_AGO), "2026-08");
    assert.equal(mesDe(INICIO_SEP), "2026-09");
  });
  it("el cambio de año: diciembre es del año viejo y enero del nuevo", () => {
    assert.equal(mesDe(FIN_DIC), "2026-12");
    assert.equal(mesDe(INICIO_ENE), "2027-01");
    assert.equal(mesDe("2027-01-01T12:00:00.000Z"), "2027-01");
  });
  it("sin fecha (null, undefined, cadena vacía), null", () => {
    assert.equal(mesDe(null), null);
    assert.equal(mesDe(undefined), null);
    assert.equal(mesDe(""), null);
  });
  it("una fecha que no se puede leer, null: texto, objeto, NaN o un Date inválido", () => {
    assert.equal(mesDe("basura"), null);
    assert.equal(mesDe({}), null);
    assert.equal(mesDe(NaN), null);
    assert.equal(mesDe(new Date("no es fecha")), null);
  });
});

describe("mesesManuales: los meses que el centro abrió a mano en la ficha", () => {
  it("sin ficha, sin campo o con el campo a null: ninguno", () => {
    assert.deepEqual(mesesManuales(null), []);
    assert.deepEqual(mesesManuales(undefined), []);
    assert.deepEqual(mesesManuales({}), []);
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: null }), []);
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: [] }), []);
  });
  it("devuelve los 'AAAA-MM' tal cual y en el orden de la ficha", () => {
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: ["2026-08", "2026-05", "2026-07"] }), [
      "2026-08",
      "2026-05",
      "2026-07",
    ]);
  });
  it("normaliza un día del mes a su mes (la forma 'AAAA-MM-DD' con que se guarda un día)", () => {
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: ["2026-08-01", "2026-07-15"] }), [
      "2026-08",
      "2026-07",
    ]);
  });
  it("descarta lo que no tiene forma de mes: textos, números, nulos, meses sin cero delante", () => {
    assert.deepEqual(
      mesesManuales({
        portalUnlockedMonths: ["agosto", 202608, null, undefined, "2026-8", "", "2026", AGO_19],
      }),
      []
    );
  });
  it("entre basura y meses buenos, se queda solo con los buenos", () => {
    assert.deepEqual(
      mesesManuales({ portalUnlockedMonths: ["x", "2026-08", null, "2026-06-01", "2026-7"] }),
      ["2026-08", "2026-06"]
    );
  });
  it("si el campo no es una lista, ninguno (y no revienta)", () => {
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: "2026-08" }), []);
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: { "2026-08": true } }), []);
    assert.deepEqual(mesesManuales({ portalUnlockedMonths: 42 }), []);
  });
  it("no toca la ficha: devuelve una lista nueva", () => {
    const ficha = { portalUnlockedMonths: ["2026-08-01", "basura"] };
    const meses = mesesManuales(ficha);
    assert.deepEqual(ficha.portalUnlockedMonths, ["2026-08-01", "basura"]);
    assert.notEqual(meses, ficha.portalUnlockedMonths);
  });
});

describe("mesesAbiertos: cobrados + abiertos a mano, con una tabla de cobros de mentira", () => {
  it("un cobro completado abre su mes, y solo el suyo", async () => {
    const { Payment } = pagosFalsos([cobro("2026-08-01")]);
    const abiertos = await mesesAbiertos({ Payment }, { id: "c-1" });
    assert.ok(abiertos instanceof Set);
    assert.deepEqual([...abiertos], ["2026-08"]);
  });
  it("pregunta por los cobros COMPLETADOS de ESA familia, y solo pide el mes", async () => {
    const { Payment, llamadas } = pagosFalsos([cobro("2026-08-01")]);
    await mesesAbiertos({ Payment }, { id: "c-1" });
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0].where, { clientId: "c-1", status: "completed" });
    assert.deepEqual(llamadas[0].attributes, ["periodMonth"]);
  });
  it("pendientes, fallidos y devueltos no abren nada: solo cuentan los completados", async () => {
    const { Payment } = pagosFalsos([
      cobro("2026-07-01", "pending"),
      cobro("2026-06-01", "failed"),
      cobro("2026-05-01", "refunded"),
      cobro("2026-08-01", "completed"),
    ]);
    assert.deepEqual([...(await mesesAbiertos({ Payment }, { id: "c-1" }))], ["2026-08"]);
  });
  it("los cobros de OTRA familia no abren nada a esta", async () => {
    const { Payment } = pagosFalsos([cobro("2026-06-01", "completed", "c-2")]);
    assert.equal((await mesesAbiertos({ Payment }, { id: "c-1" })).size, 0);
  });
  it("un cobro sin mes (periodMonth vacío) no abre nada", async () => {
    const { Payment } = pagosFalsos([cobro(null), cobro(undefined), cobro("")]);
    assert.equal((await mesesAbiertos({ Payment }, { id: "c-1" })).size, 0);
  });
  it("cualquier día del mes vale para ese mes: periodMonth es un día ('AAAA-MM-DD')", async () => {
    const { Payment } = pagosFalsos([cobro("2026-08-15"), cobro("2026-07-31")]);
    assert.deepEqual([...(await mesesAbiertos({ Payment }, { id: "c-1" }))].sort(), [
      "2026-07",
      "2026-08",
    ]);
  });
  it("varios cobros del mismo mes lo abren una sola vez", async () => {
    const { Payment } = pagosFalsos([
      cobro("2026-08-01"),
      cobro("2026-08-01"),
      cobro("2026-08-20"),
    ]);
    assert.deepEqual([...(await mesesAbiertos({ Payment }, { id: "c-1" }))], ["2026-08"]);
  });
  it("los meses abiertos a mano se suman a los cobrados", async () => {
    const { Payment } = pagosFalsos([cobro("2026-08-01")]);
    const ficha = { id: "c-1", portalUnlockedMonths: ["2026-05", "2026-03-01"] };
    assert.deepEqual([...(await mesesAbiertos({ Payment }, ficha))].sort(), [
      "2026-03",
      "2026-05",
      "2026-08",
    ]);
  });
  it("un mes cobrado Y abierto a mano sale una sola vez", async () => {
    const { Payment } = pagosFalsos([cobro("2026-08-01")]);
    const ficha = { id: "c-1", portalUnlockedMonths: ["2026-08"] };
    assert.deepEqual([...(await mesesAbiertos({ Payment }, ficha))], ["2026-08"]);
  });
  it("sin modelo de cobros (tenant sin facturación): solo los manuales, sin consultar nada", async () => {
    const ficha = { id: "c-1", portalUnlockedMonths: ["2026-05"] };
    assert.deepEqual([...(await mesesAbiertos({}, ficha))], ["2026-05"]);
    assert.deepEqual([...(await mesesAbiertos({ Payment: null }, ficha))], ["2026-05"]);
  });
  it("si la tabla no existe en el schema (42P01), solo los manuales y no revienta", async () => {
    const ficha = { id: "c-1", portalUnlockedMonths: ["2026-05"] };
    const porParent = pagosFalsos([], { revienta: sinTabla("parent") });
    assert.deepEqual(
      [...(await mesesAbiertos({ Payment: porParent.Payment }, ficha))],
      ["2026-05"]
    );
    const porOriginal = pagosFalsos([], { revienta: sinTabla("original") });
    assert.deepEqual(
      [...(await mesesAbiertos({ Payment: porOriginal.Payment }, ficha))],
      ["2026-05"]
    );
  });
  it("cualquier OTRO error de la base SÍ sube: no se abre ni se cierra nada a ciegas", async () => {
    const ficha = { id: "c-1", portalUnlockedMonths: ["2026-05"] };
    const caida = pagosFalsos([], { revienta: new Error("la base no contesta") });
    await assert.rejects(() => mesesAbiertos({ Payment: caida.Payment }, ficha), /no contesta/);
    const columna = pagosFalsos([], {
      revienta: Object.assign(new Error("column does not exist"), { parent: { code: "42703" } }),
    });
    await assert.rejects(() => mesesAbiertos({ Payment: columna.Payment }, ficha), /column/);
  });
  it("sin ficha, o ficha sin id, no consulta la tabla: solo los manuales", async () => {
    const { Payment, llamadas } = pagosFalsos([cobro("2026-08-01")]);
    assert.equal((await mesesAbiertos({ Payment }, null)).size, 0);
    assert.equal((await mesesAbiertos({ Payment }, undefined)).size, 0);
    const sinId = { portalUnlockedMonths: ["2026-05"] };
    assert.deepEqual([...(await mesesAbiertos({ Payment }, sinId))], ["2026-05"]);
    assert.deepEqual(llamadas, []);
  });
  it("sin cobros ni meses manuales, el conjunto vacío: todo cerrado", async () => {
    const { Payment } = pagosFalsos([]);
    assert.equal((await mesesAbiertos({ Payment }, { id: "c-1" })).size, 0);
  });
});

describe("filtrarPorMes: qué ve la familia y qué meses le quedan cerrados", () => {
  it("un documento del equipo en un mes abierto se ve; en un mes cerrado, no", () => {
    const abierto = doc("a", AGO_19);
    const cerrado = doc("b", JUL_10);
    const r = filtrarPorMes([abierto, cerrado], new Set(["2026-08"]));
    assert.deepEqual(r.visibles, [abierto]);
    assert.deepEqual(r.mesesBloqueados, [{ mes: "2026-07", documentos: 1 }]);
  });
  it("lo que subió la propia familia se ve SIEMPRE, aunque su mes esté cerrado, y no cuenta como retenido", () => {
    const propio = doc("mio", JUL_10, { uploadedByClient: true });
    const delEquipo = doc("suyo", JUL_10);
    const r = filtrarPorMes([propio, delEquipo], new Set());
    assert.deepEqual(r.visibles, [propio]);
    assert.deepEqual(r.mesesBloqueados, [{ mes: "2026-07", documentos: 1 }]);
  });
  it("también con los nombres en snake_case (uploaded_by_client, created_at), como llegan las filas crudas", () => {
    const propio = { id: "mio", created_at: JUL_10, uploaded_by_client: true };
    const delEquipo = { id: "suyo", created_at: JUL_10, uploaded_by_client: false };
    const enAbierto = { id: "ago", created_at: AGO_19, uploaded_by_client: false };
    const r = filtrarPorMes([propio, delEquipo, enAbierto], new Set(["2026-08"]));
    assert.deepEqual(r.visibles, [propio, enAbierto]);
    assert.deepEqual(r.mesesBloqueados, [{ mes: "2026-07", documentos: 1 }]);
  });
  it("los meses cerrados salen con cuántos documentos hay en cada uno, del más reciente al más antiguo", () => {
    const docs = [
      doc("1", JUN_03),
      doc("2", AGO_19),
      doc("3", JUN_03),
      doc("4", JUL_10),
      doc("5", MAY_20),
    ];
    const r = filtrarPorMes(docs, new Set(["2026-05"]));
    assert.deepEqual(r.visibles, [docs[4]]);
    assert.deepEqual(r.mesesBloqueados, [
      { mes: "2026-08", documentos: 1 },
      { mes: "2026-07", documentos: 1 },
      { mes: "2026-06", documentos: 2 },
    ]);
  });
  it("de los meses cerrados no sale ningún título ni id: solo el mes y el recuento", () => {
    const r = filtrarPorMes([doc("secreto", JUL_10)], new Set());
    assert.equal(r.mesesBloqueados.length, 1);
    assert.deepEqual(Object.keys(r.mesesBloqueados[0]), ["mes", "documentos"]);
    assert.equal(JSON.stringify(r.mesesBloqueados).includes("secreto"), false);
  });
  it("sin fecha, o con una fecha ilegible, no se retiene: no hay mes que cobrar", () => {
    const sinFecha = doc("s", null);
    const ilegible = doc("i", "basura");
    const r = filtrarPorMes([sinFecha, ilegible], new Set());
    assert.deepEqual(r.visibles, [sinFecha, ilegible]);
    assert.deepEqual(r.mesesBloqueados, []);
  });
  it("con todos los meses cerrados (conjunto vacío), solo se ve lo que subió la familia", () => {
    const propio = doc("mio", AGO_19, { uploadedByClient: true });
    const r = filtrarPorMes([doc("a", AGO_19), propio, doc("b", JUL_10)], new Set());
    assert.deepEqual(r.visibles, [propio]);
    assert.deepEqual(r.mesesBloqueados, [
      { mes: "2026-08", documentos: 1 },
      { mes: "2026-07", documentos: 1 },
    ]);
  });
  it("con todos los meses abiertos, se ve todo y no hay meses bloqueados", () => {
    const docs = [doc("a", AGO_19), doc("b", JUL_10)];
    const r = filtrarPorMes(docs, new Set(["2026-08", "2026-07"]));
    assert.deepEqual(r.visibles, docs);
    assert.deepEqual(r.mesesBloqueados, []);
  });
  it("con una lista vacía, nada visible y ningún mes bloqueado", () => {
    assert.deepEqual(filtrarPorMes([], new Set(["2026-08"])), {
      visibles: [],
      mesesBloqueados: [],
    });
    assert.deepEqual(filtrarPorMes([], new Set()), { visibles: [], mesesBloqueados: [] });
  });
  it("no toca la lista ni los documentos: los visibles son los mismos objetos, en el mismo orden", () => {
    const a = doc("a", AGO_19);
    const b = doc("b", JUL_10);
    const c = doc("c", AGO_19, { uploadedByClient: true });
    const docs = [a, b, c];
    const r = filtrarPorMes(docs, new Set(["2026-08"]));
    assert.equal(docs.length, 3);
    assert.deepEqual(docs, [a, b, c]);
    assert.equal(r.visibles[0], a);
    assert.equal(r.visibles[1], c);
    assert.equal(r.visibles.length, 2);
    assert.deepEqual(Object.keys(a), ["id", "fileName", "createdAt", "uploadedByClient"]);
  });
  it("el orden de las fechas en la lista no cambia el recuento ni el orden de los meses", () => {
    const r1 = filtrarPorMes([doc("1", JUN_03), doc("2", AGO_19)], new Set());
    const r2 = filtrarPorMes([doc("2", AGO_19), doc("1", JUN_03)], new Set());
    assert.deepEqual(r1.mesesBloqueados, r2.mesesBloqueados);
    assert.deepEqual(
      r1.mesesBloqueados.map((m) => m.mes),
      ["2026-08", "2026-06"]
    );
  });
});

describe("las piezas juntas, como las usa el listado del portal", () => {
  it("agosto cobrado, mayo abierto a mano, julio cerrado: se ven agosto, mayo y lo propio; julio se dice", async () => {
    const { Payment } = pagosFalsos([cobro("2026-08-01"), cobro("2026-07-01", "pending")]);
    const ficha = { id: "c-1", portalUnlockedMonths: ["2026-05-01"] };
    const informeAgosto = doc("ago", AGO_19);
    const informeMayo = doc("may", MAY_20);
    const informeJulio = doc("jul", JUL_10);
    const analiticaPropia = doc("mia", JUL_10, { uploadedByClient: true });

    const abiertos = await mesesAbiertos({ Payment }, ficha);
    const r = filtrarPorMes([informeAgosto, informeJulio, analiticaPropia, informeMayo], abiertos);

    assert.deepEqual(r.visibles, [informeAgosto, analiticaPropia, informeMayo]);
    assert.deepEqual(r.mesesBloqueados, [{ mes: "2026-07", documentos: 1 }]);
  });
});
