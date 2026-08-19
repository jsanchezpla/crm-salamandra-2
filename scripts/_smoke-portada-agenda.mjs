/**
 * _smoke-portada-agenda.mjs — quién ve qué citas en la PORTADA (19/08/2026).
 *
 *   node scripts/_smoke-portada-agenda.mjs
 *
 * Lógica pura con modelos de mentira: sin base de datos, sin servidor, sin .env.
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rocío, que es `user` en nutri_laura, vio en SU portada la cita de supervisión
 * que Laura se había agendado para sí misma. La cita estaba bien asignada; lo que
 * estaba mal era la portada: `buildAgenda` listaba TODAS las citas próximas del
 * cliente —con el NOMBRE DEL PACIENTE— sin mirar el rol ni el interruptor de
 * agenda compartida. El listado (`/api/citas/bookings`) y el calendario sí
 * filtraban desde el 28/07; la portada se quedó fuera y nadie lo notó.
 *
 * La cabecera del propio fichero explicaba por qué: decía que Booking no tenía FK
 * a usuario. La tenía —`team_member_id`—, así que la premisa estaba caducada.
 *
 * Lo que se fija aquí es el reparto de los CUATRO casos, y sobre todo el cuarto:
 * que cuando no se puede resolver quién mira, la agenda sale VACÍA y no abierta.
 * Un fallo de resolución que abriera sería el mismo agujero con otra ropa.
 */

import { buildHomeSummary } from "../lib/home/summary.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write((ok ? "OK  " : "MAL ") + etiqueta + "\n");
  if (!ok) process.stdout.write("      esperaba " + JSON.stringify(esperado) + ", salio " + JSON.stringify(real) + "\n");
}
function h(t) { process.stdout.write("\n> " + t + "\n"); }

const NADIE = "00000000-0000-0000-0000-000000000000";
const LAURA = "tm-laura";
const ROCIO = "tm-rocio";

/**
 * Modelos de mentira que APUNTAN el where que se les pide, que es lo que se
 * quiere comprobar. Booking devuelve siempre lo mismo: no se prueba el contenido,
 * se prueba el filtro.
 */
function modelos({ fichaDe = null, teamMemberRevienta = false } = {}) {
  const vistos = [];
  return {
    vistos,
    tenantModels: {
      Booking: {
        count: async ({ where }) => { vistos.push({ q: "count", where }); return 0; },
        findAll: async ({ where }) => { vistos.push({ q: "findAll", where }); return []; },
      },
      EventType: {},
      TeamMember: {
        findOne: async ({ where }) => {
          if (teamMemberRevienta) throw new Error("la tabla no existe");
          return where.userId && fichaDe ? { id: fichaDe } : null;
        },
      },
    },
  };
}

async function agendaDe({ role, agendaCompartida = false, fichaDe = null, teamMemberRevienta = false, conTeam = true }) {
  const m = modelos({ fichaDe, teamMemberRevienta });
  const modulos = new Set(conTeam ? ["citas", "team"] : ["citas"]);
  await buildHomeSummary({
    hasModule: (k) => modulos.has(k),
    tenantModels: m.tenantModels,
    user: { id: "u1", role },
    tenant: { settings: { citas: { agendaCompartida } } },
  });
  // El filtro tiene que estar en LAS DOS consultas, no solo en la lista.
  return m.vistos.map((v) => v.where.teamMemberId ?? "(sin filtro)");
}

h("El jefe ve toda la agenda");
check("admin, sin filtro en las dos consultas", await agendaDe({ role: "admin", fichaDe: LAURA }), ["(sin filtro)", "(sin filtro)"]);
check("superadmin igual", await agendaDe({ role: "superadmin", fichaDe: LAURA }), ["(sin filtro)", "(sin filtro)"]);

h("Con agenda compartida, todo el equipo la ve");
check("user + agendaCompartida", await agendaDe({ role: "user", agendaCompartida: true, fichaDe: ROCIO }), ["(sin filtro)", "(sin filtro)"]);

h("Sin agenda compartida, cada uno lo suyo");
check("user con su ficha, solo sus citas", await agendaDe({ role: "user", fichaDe: ROCIO }), [ROCIO, ROCIO]);
check("y no las de otra", await agendaDe({ role: "user", fichaDe: ROCIO }), [ROCIO, ROCIO]);

h("Y cuando no se sabe quien mira, NO se ensena nada");
check("user sin ficha de equipo", await agendaDe({ role: "user", fichaDe: null }), [NADIE, NADIE]);
check("la consulta de la ficha revienta", await agendaDe({ role: "user", fichaDe: ROCIO, teamMemberRevienta: true }), [NADIE, NADIE]);

h("Sin modulo team no hay a quien filtrar");
check("user sin team, agenda entera", await agendaDe({ role: "user", conTeam: false, fichaDe: ROCIO }), ["(sin filtro)", "(sin filtro)"]);

process.stdout.write(fallos ? "\nX " + fallos + " fallo(s)\n\n" : "\nTodo correcto\n\n");
process.exit(fallos ? 1 : 0);
