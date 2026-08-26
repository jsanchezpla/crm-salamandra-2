/**
 * _smoke-portada-agenda.mjs — quién ve qué citas en la PORTADA (19/08/2026;
 * rehecha el 26/08/2026 sobre la portada nueva «Hoy y el negocio»).
 *
 *   node scripts/_smoke-portada-agenda.mjs
 *
 * Lógica pura con modelos de mentira: sin base de datos, sin servidor, sin .env.
 *
 * @prueba ligera
 *
 * (La marca es obligatoria AQUÍ: `scripts/pruebas.mjs` manda a las pesadas todo lo
 * que mencione sequelize, y más abajo se nombra en un comentario. Sin la marca, esta
 * prueba se caería de `npm test` sin que nadie se diera cuenta — pasó el 19/08/2026.)
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rocío, que es `user` en nutri_laura, vio en SU portada la cita de supervisión
 * que Laura se había agendado para sí misma. La portada listaba TODAS las citas
 * del cliente —con el NOMBRE DEL PACIENTE— sin mirar el rol ni el interruptor de
 * agenda compartida.
 *
 * La portada nueva hace MÁS consultas a `bookings` que la vieja (la lista de
 * hoy, la serie de la semana, las citas sin confirmar, la vista por
 * profesional…), así que la regla ya no se fija consulta a consulta sino como
 * invariante: **ninguna consulta a Booking puede salir sin el filtro que le
 * toca a quien mira**. Para quien no ve toda la agenda, TODAS llevan su ficha
 * (o el centinela, si no se pudo resolver: se falla CERRADO); para quien sí la
 * ve, ninguna lleva la ficha de OTRA persona.
 */

import { buildPortada } from "../lib/home/summary.js";

let fallos = 0;
function check(etiqueta, ok, detalle = "") {
  if (!ok) fallos++;
  process.stdout.write((ok ? "OK  " : "MAL ") + etiqueta + "\n");
  if (!ok && detalle) process.stdout.write("      " + detalle + "\n");
}
function h(t) { process.stdout.write("\n> " + t + "\n"); }

const NADIE = "00000000-0000-0000-0000-000000000000";
/**
 * El filtro es `{ [Op.or]: [{ [Op.eq]: id }, { [Op.is]: null }] }`. Se lee por
 * los SÍMBOLOS para no importar sequelize aquí —esta prueba es ligera— y se
 * devuelve algo legible: "tm-rocio+sin-asignar".
 */
function describeFiltro(f) {
  if (f === undefined) return "(sin filtro)";
  if (typeof f === "string") return f;
  const partes = [];
  for (const s of Object.getOwnPropertySymbols(f)) {
    if (String(s) !== "Symbol(or)") continue;
    for (const rama of f[s]) {
      for (const s2 of Object.getOwnPropertySymbols(rama)) {
        partes.push(rama[s2] === null ? "sin-asignar" : String(rama[s2]));
      }
    }
  }
  return partes.length ? partes.join("+") : "?";
}
const SIN = "+sin-asignar";

const LAURA = "tm-laura";
const ROCIO = "tm-rocio";

/**
 * Modelos de mentira que APUNTAN el where de cada consulta a Booking, que es lo
 * que se quiere comprobar. Devuelven vacío: no se prueba el contenido, se
 * prueba el filtro.
 */
function modelos({ fichaDe = null, teamMemberRevienta = false } = {}) {
  const vistos = [];
  return {
    vistos,
    tenantModels: {
      Booking: {
        count: async ({ where }) => { vistos.push(where.teamMemberId); return 0; },
        findAll: async ({ where }) => { vistos.push(where.teamMemberId); return []; },
      },
      EventType: {},
      TeamMember: {
        findOne: async ({ where }) => {
          if (teamMemberRevienta) throw new Error("la tabla no existe");
          return where.userId && fichaDe ? { id: fichaDe } : null;
        },
        findAll: async () => [],
      },
    },
  };
}

async function filtrosDe({ role, agendaCompartida = false, fichaDe = null, teamMemberRevienta = false, conTeam = true, accesoTeam = true }) {
  const m = modelos({ fichaDe, teamMemberRevienta });
  const modulos = new Set(conTeam ? ["citas", "team"] : ["citas"]);
  await buildPortada({
    // `hasModule` cruza tenant ∩ usuario; `tenantHasModule` mira solo el tenant.
    // Con `accesoTeam: false` se imita a Rocío: el centro TIENE equipo, ella no
    // tiene "team" en su moduleAccess.
    hasModule: (k) => modulos.has(k) && (k !== "team" || accesoTeam),
    tenantHasModule: (k) => modulos.has(k),
    tenantModels: m.tenantModels,
    tenantSequelize: null,
    user: { id: "u1", role },
    tenant: { settings: { citas: { agendaCompartida } } },
  });
  return m.vistos.map(describeFiltro);
}

const todosSon = (filtros, esperado) => filtros.length >= 2 && filtros.every((f) => f === esperado);
const soloEntre = (filtros, permitidos) => filtros.length >= 2 && filtros.every((f) => permitidos.includes(f));

h("Sin agenda compartida, TODAS las consultas de citas van con lo suyo");
{
  const f = await filtrosDe({ role: "user", fichaDe: ROCIO });
  check("user con su ficha: todas con su filtro (" + f.length + " consultas)", todosSon(f, ROCIO + SIN), "salio: " + JSON.stringify(f));
}

h("El caso de Rocio: quitarle el acceso a Equipo NO abre la agenda");
{
  const f = await filtrosDe({ role: "user", fichaDe: ROCIO, accesoTeam: false });
  check("user sin \"team\" en su moduleAccess: todas con su filtro", todosSon(f, ROCIO + SIN), "salio: " + JSON.stringify(f));
}

h("Cuando no se sabe quien mira, se cierra (centinela), nunca se abre");
{
  const f1 = await filtrosDe({ role: "user", fichaDe: null });
  check("user sin ficha de equipo: ninguna ajena", todosSon(f1, NADIE + SIN), "salio: " + JSON.stringify(f1));
  const f2 = await filtrosDe({ role: "user", fichaDe: ROCIO, teamMemberRevienta: true });
  check("la consulta de la ficha revienta: ninguna ajena", todosSon(f2, NADIE + SIN), "salio: " + JSON.stringify(f2));
}

h("El jefe ve toda la agenda (y su pestana Mias sigue siendo SUYA)");
{
  const f = await filtrosDe({ role: "admin", fichaDe: LAURA });
  check(
    "admin: nada filtrado por OTRA persona; lo suyo o sin filtro",
    soloEntre(f, ["(sin filtro)", LAURA + SIN]),
    "salio: " + JSON.stringify(f)
  );
  check("admin: la vista de todo el centro existe (alguna consulta sin filtro)", f.includes("(sin filtro)"), "salio: " + JSON.stringify(f));
  check("superadmin igual", soloEntre(await filtrosDe({ role: "superadmin", fichaDe: LAURA }), ["(sin filtro)", LAURA + SIN]));
}

h("Con agenda compartida, todo el equipo ve el centro");
{
  const f = await filtrosDe({ role: "user", agendaCompartida: true, fichaDe: ROCIO });
  check("user + agendaCompartida: lo suyo o sin filtro", soloEntre(f, ["(sin filtro)", ROCIO + SIN]), "salio: " + JSON.stringify(f));
  check("y el centro existe", f.includes("(sin filtro)"), "salio: " + JSON.stringify(f));
}

h("Si el CENTRO no tiene team, no hay a quien filtrar");
{
  const f = await filtrosDe({ role: "user", conTeam: false, fichaDe: ROCIO });
  check("tenant sin team: agenda entera, sin filtro", todosSon(f, "(sin filtro)"), "salio: " + JSON.stringify(f));
}

process.stdout.write(fallos ? "\nX " + fallos + " fallo(s)\n\n" : "\nTodo correcto\n\n");
process.exit(fallos ? 1 : 0);
