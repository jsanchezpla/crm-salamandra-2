// @prueba ligera — importa `sequelize` solo por `Op` (un símbolo), no abre
// ninguna conexión: los modelos van de pega, escritos aquí abajo.
/**
 * _smoke-incidencias-filtros.mjs — los filtros del listado de incidencias
 * admiten VARIOS valores (18/09/2026, AV-198 de Aumenta).
 *
 * Aumenta, por el Registro: «en incidencias de equipo quieren que el filtro sea
 * múltiple y no solo de una opción». Lo que se comprueba aquí es lo que el
 * servidor hace con la URL, que es lo único que no se ve en pantalla:
 *
 *   · un valor suelto sigue filtrando como siempre (nada de romper la campana,
 *     el Excel o un enlace que alguien tenga guardado);
 *   · varios valores, por comas o repitiendo el parámetro, entran como O;
 *   · lo que no vale —una categoría inventada, un id que no es un uuid— se cae
 *     antes de llegar al `where`, igual que cuando el filtro era de uno;
 *   · los TIPOS (pendientes, en proceso, resueltas) se suman entre ellos y con
 *     las faltas, que viven en otra rama;
 *   · «las mías» (`mine=1`) es «la registré yo O soy responsable» —las dos cosas
 *     que pidió Rosa— y sigue siendo cosa de dirección.
 *
 * Se prueba lo que DEVUELVE `whereDeIncidencias`, con modelos de pega: sin base
 * de datos y sin servidor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { listaDeParametro, whereDeIncidencias } from "../lib/clinica/filtroIncidencias.js";

const OLGA = "11111111-1111-4111-8111-111111111111";
const ROSA = "22222222-2222-4222-8222-222222222222";
const ISABEL = "33333333-3333-4333-8333-333333333333";

/** Modelos de pega: solo lo que toca `whereDeIncidencias` sin texto buscado. */
function modelosDePega({ enlaces = {}, vistas = [], fichaDe = null } = {}) {
  const consultas = [];
  return {
    consultas,
    M: {
      Incidencia: {},
      TeamMember: {
        findOne: async ({ where }) => (fichaDe && where.userId === "u1" ? { id: fichaDe } : null),
      },
      IncidenciaAssignee: {
        findAll: async (opts) => {
          consultas.push(opts);
          // La consulta de «las que ya he dado por vistas» lleva `vistoAt`.
          if (opts.where?.vistoAt) return vistas.map((id) => ({ incidenciaId: id }));
          const pedidos = opts.where.teamMemberId?.[Op.in] ?? [opts.where.teamMemberId];
          return pedidos.flatMap((id) => (enlaces[id] ?? []).map((inc) => ({ incidenciaId: inc })));
        },
      },
    },
  };
}

const peticion = (userId = null) => ({ headers: { get: (k) => (k === "x-user-id" ? userId : null) } });
const ctxAdmin = { user: { role: "admin" } };

async function where(query, opciones = {}) {
  const { M } = modelosDePega(opciones);
  const r = await whereDeIncidencias({
    request: peticion(opciones.userId ?? null),
    sp: new URLSearchParams(query),
    M,
    ctx: opciones.ctx ?? ctxAdmin,
  });
  return r.where;
}

// ── listaDeParametro ────────────────────────────────────────────────────────

test("listaDeParametro: sin el parámetro, nada que filtrar", () => {
  assert.deepEqual(listaDeParametro(new URLSearchParams(""), "x"), []);
  assert.deepEqual(listaDeParametro(new URLSearchParams("x="), "x"), []);
  assert.deepEqual(listaDeParametro(new URLSearchParams("x=  ,  "), "x"), []);
});

test("listaDeParametro: por comas y repitiendo el parámetro dan lo mismo", () => {
  assert.deepEqual(listaDeParametro(new URLSearchParams("x=a,b"), "x"), ["a", "b"]);
  assert.deepEqual(listaDeParametro(new URLSearchParams("x=a&x=b"), "x"), ["a", "b"]);
  assert.deepEqual(listaDeParametro(new URLSearchParams("x=a,b&x=c"), "x"), ["a", "b", "c"]);
});

test("listaDeParametro: sin repetidos y sin espacios de sobra", () => {
  assert.deepEqual(listaDeParametro(new URLSearchParams("x= a , b ,a"), "x"), ["a", "b"]);
});

test("listaDeParametro: lo que no valida se cae, no envenena la lista", () => {
  const vale = (v) => v === "a" || v === "b";
  assert.deepEqual(listaDeParametro(new URLSearchParams("x=a,zzz,b"), "x", vale), ["a", "b"]);
  assert.deepEqual(listaDeParametro(new URLSearchParams("x=zzz"), "x", vale), []);
});

// ── Categoría ───────────────────────────────────────────────────────────────

test("una categoría filtra por igual, como siempre", async () => {
  assert.equal((await where("category=terapeutica")).category, "terapeutica");
});

test("varias categorías entran como O (Op.in)", async () => {
  const w = await where("category=terapeutica,documental");
  assert.deepEqual(w.category[Op.in], ["terapeutica", "documental"]);
});

test("una categoría inventada no filtra, y no arrastra a la buena", async () => {
  assert.equal((await where("category=inventada")).category, undefined);
  assert.equal((await where("category=terapeutica,inventada")).category, "terapeutica");
});

// ── Quién la registró ───────────────────────────────────────────────────────

test("quién la registró admite varias personas", async () => {
  assert.equal((await where(`reportedById=${OLGA}`)).reportedById, OLGA);
  const w = await where(`reportedById=${OLGA},${ROSA}`);
  assert.deepEqual(w.reportedById[Op.in], [OLGA, ROSA]);
});

test("un id que no es un uuid no filtra por quién la registró", async () => {
  assert.equal((await where("reportedById=' OR 1=1 --")).reportedById, undefined);
});

// ── Responsable (por la tabla pivote) ───────────────────────────────────────

test("varios responsables: se juntan sus incidencias, sin repetir", async () => {
  const { M, consultas } = modelosDePega({ enlaces: { [OLGA]: ["i1", "i2"], [ROSA]: ["i2", "i3"] } });
  const { where: w } = await whereDeIncidencias({
    request: peticion(),
    sp: new URLSearchParams(`assignedToId=${OLGA},${ROSA}`),
    M,
    ctx: ctxAdmin,
  });
  // O, no Y: las de una MÁS las de la otra.
  assert.deepEqual(w.id[Op.in], ["i1", "i2", "i3"]);
  // Una sola consulta a la pivote, no una por persona.
  const aLaPivote = consultas.filter((c) => !c.where?.vistoAt);
  assert.equal(aLaPivote.length, 1);
  assert.deepEqual(aLaPivote[0].where.teamMemberId[Op.in], [OLGA, ROSA]);
});

test("un responsable solo sigue yendo por la pivote (la segunda responsable cuenta)", async () => {
  const { M, consultas } = modelosDePega({ enlaces: { [ROSA]: ["i7"] } });
  const { where: w } = await whereDeIncidencias({
    request: peticion(),
    sp: new URLSearchParams(`assignedToId=${ROSA}`),
    M,
    ctx: ctxAdmin,
  });
  assert.deepEqual(w.id[Op.in], ["i7"]);
  assert.equal(w.assignedToId, undefined, "no debe caer al espejo teniendo pivote");
  assert.ok(consultas.some((c) => c.where?.teamMemberId && !c.where?.vistoAt));
});

test("un responsable que no es un uuid no filtra nada", async () => {
  const w = await where("assignedToId=nope");
  assert.equal(w.id, undefined);
  assert.equal(w.assignedToId, undefined);
});

// ── «Las mías» ──────────────────────────────────────────────────────────────

test("mine=1 son las que registré YO O tengo asignadas, no solo las asignadas", async () => {
  const { M } = modelosDePega({ fichaDe: ISABEL, enlaces: { [ISABEL]: ["i9"] } });
  const { where: w, yoSoy } = await whereDeIncidencias({
    request: peticion("u1"),
    sp: new URLSearchParams("mine=1"),
    M,
    ctx: ctxAdmin,
  });
  assert.equal(yoSoy, ISABEL);
  // No toca `where.id`: eso es del filtro de responsable, que es otra cosa.
  assert.equal(w.id, undefined);
  const ramas = w[Op.and] ?? [];
  assert.equal(ramas.length, 1, "«las mías» entra como UN and, sin pisar nada");
  const alternativas = ramas[0][Op.or] ?? [];
  assert.equal(alternativas.length, 2, "tiene que ser un O de dos: asignadas y registradas");
  assert.ok(
    alternativas.some((a) => a.reportedById === ISABEL),
    "las que registró ella tienen que entrar: eran justo las que se perdían",
  );
});

test("«las mías» y el filtro de responsable conviven (y es Y, no O)", async () => {
  const { M } = modelosDePega({ fichaDe: ISABEL, enlaces: { [OLGA]: ["i1"] } });
  const { where: w } = await whereDeIncidencias({
    request: peticion("u1"),
    sp: new URLSearchParams(`mine=1&assignedToId=${OLGA}`),
    M,
    ctx: ctxAdmin,
  });
  assert.deepEqual(w.id[Op.in], ["i1"], "el filtro de responsable sigue en pie");
  assert.equal((w[Op.and] ?? []).length, 1, "y «las mías» encima, no en su lugar");
});

test("mine=1 sin ficha de equipo NO deja la pantalla vacía", async () => {
  const w = await where("mine=1", { userId: "u1" }); // sin `fichaDe`: no hay ficha
  assert.equal(w.id, undefined, "sin ficha no se filtra: antes devolvía cero y parecía que no había ninguna");
});

test("mine=1 lo ignora quien no es dirección: su alcance ya es «las mías»", async () => {
  const { M } = modelosDePega({ fichaDe: ISABEL, enlaces: { [ISABEL]: ["i9"] } });
  const { where: w, esAdmin } = await whereDeIncidencias({
    request: peticion("u1"),
    sp: new URLSearchParams("mine=1"),
    M,
    ctx: { user: { role: "user" } },
  });
  assert.equal(esAdmin, false);
  assert.equal(w.id, undefined);
  assert.ok(w[Op.and]?.length, "el alcance de quien no es dirección tiene que seguir entrando");
});

// ── Los tipos (pendientes / en proceso / resueltas / faltas) ────────────────

test("sin tipo marcado: todas las de siempre, y las faltas fuera", async () => {
  const w = await where("");
  assert.equal(w.falta, null, "las faltas viven en su propia lista");
  assert.equal(w.status, undefined);
});

test("un tipo solo filtra igual que siempre", async () => {
  const w = await where("status=pending");
  assert.equal(w.status, "pending");
  assert.equal(w.falta, null);
});

test("varios tipos se suman", async () => {
  const w = await where("status=pending&status=in_progress");
  assert.deepEqual(w.status[Op.in], ["pending", "in_progress"]);
  assert.equal(w.falta, null);
});

test("solo faltas: como estaba, su lista aparte", async () => {
  const w = await where("faltas=1");
  assert.deepEqual(Object.getOwnPropertySymbols(w.falta), [Op.ne]);
  assert.equal(w.falta[Op.ne], null);
  assert.equal(w.status, undefined);
});

test("faltas MÁS pendientes: dos ramas unidas por O, no una condición imposible", async () => {
  // Es el ejemplo literal de Rosa: «faltas, pendientes y en proceso».
  const w = await where("status=pending&status=in_progress&faltas=1");
  const ramas = w[Op.or];
  assert.ok(Array.isArray(ramas) && ramas.length === 2);
  const [deSiempre, deFaltas] = ramas;
  assert.equal(deSiempre.falta, null);
  assert.deepEqual(deSiempre.status[Op.in], ["pending", "in_progress"]);
  assert.equal(deFaltas.falta[Op.ne], null);
  // Y NO puede quedar un `falta` suelto arriba: sería «falta null Y falta no null».
  assert.equal(w.falta, undefined);
  assert.equal(w.status, undefined);
});

test("un estado inventado no filtra", async () => {
  assert.equal((await where("status=inventado")).status, undefined);
});

test("los recuentos se cuentan sin el tipo, pero con el resto de filtros", async () => {
  const { M } = modelosDePega();
  const { whereSinPestana } = await whereDeIncidencias({
    request: peticion(),
    sp: new URLSearchParams("status=pending&faltas=1&category=terapeutica"),
    M,
    ctx: ctxAdmin,
  });
  assert.equal(whereSinPestana.category, "terapeutica", "lo demás se queda");
  assert.equal(whereSinPestana.status, undefined);
  assert.equal(whereSinPestana.falta, undefined);
  assert.equal(whereSinPestana[Op.or], undefined, "la rama de la pestaña también se va");
});

// ── Lo que la pantalla manda ────────────────────────────────────────────────

test("la pantalla manda un parámetro por valor, no uno con comas sin validar", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/(dashboard)/equipo/incidencias/page.jsx", import.meta.url), "utf8");
  for (const clave of ["status", "category", "reportedById", "assignedToId"]) {
    assert.ok(
      new RegExp(`params\\.append\\("${clave}"`).test(src),
      `${clave} tiene que mandarse con append (uno por valor), no con set`,
    );
  }
  // «Solo las mías» es un interruptor aparte del filtro de responsable, y la
  // pantalla se abre con él puesto: si esto se pierde, dirección se encuentra de
  // golpe las 222 incidencias del centro.
  assert.ok(/if \(soloMias\) params\.set\("mine", "1"\)/.test(src));
  assert.ok(/useState\(true\); *$/m.test(src.split("const [soloMias, setSoloMias] = ")[1]?.split("\n")[0] ?? ""),
    "«Solo las mías» tiene que venir puesto de fábrica");
  // Y «Faltas» sigue siendo un parámetro suyo, no un estado más.
  assert.ok(/params\.set\("faltas", "1"\)/.test(src));
});
