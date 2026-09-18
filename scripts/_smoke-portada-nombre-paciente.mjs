/**
 * _smoke-portada-nombre-paciente.mjs — «Mi agenda» de la portada dice el
 * PACIENTE, no quien paga (18/09/2026, AV-0208 de Aumenta).
 *
 *   node scripts/_smoke-portada-nombre-paciente.mjs
 *
 * @prueba ligera
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Laura Garrido: «EN INICIO EN MI AGENDA SALEN CLIENTES NO MIS PACIENTES DEL
 * DÍA». Es el mismo fallo de AV-0088 —la rejilla de la agenda pintaba el nombre
 * de la madre— que se arregló el 08/09/2026 SOLO en el calendario: la portada
 * siguió leyendo `bookings.client_name`, que es el titular de la ficha.
 *
 * La regla es una y vive en `lib/citas/nombreEnLaAgenda.js`; aquí se comprueba
 * que la portada la usa de verdad, con modelos de mentira y sin base de datos.
 * Lo que no puede perderse: que con paciente mande el paciente, que sin él se
 * quede el nombre de siempre (un taller, un adulto) y que en un centro SIN
 * pacientes no se pida esa tabla —pedirla donde no existe dejó a nutri_laura
 * seis días con la agenda en blanco—.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPortada } from "../lib/home/summary.js";

const CITAS = [
  {
    id: "b1",
    clientName: "La madre que paga",
    scheduledAt: "2026-09-18T15:00:00.000Z",
    status: "confirmed",
    patient: { id: "p1", firstName: "El niño", lastName: "Que viene" },
    eventType: { name: "Terapia" },
  },
  {
    id: "b2",
    clientName: "Un adulto de consulta",
    scheduledAt: "2026-09-18T16:00:00.000Z",
    status: "confirmed",
    patient: null,
    eventType: { name: "Taller" },
  },
];

/** Modelos de mentira: solo la lista de citas de hoy devuelve filas. */
function modelos({ conPacientes }) {
  const includes = [];
  const Booking = {
    count: async () => CITAS.length,
    findAll: async ({ attributes, include }) => {
      // La serie de la semana pide agregados (raw): esa no lleva nombres.
      const pideNombre = Array.isArray(attributes) && attributes.includes("clientName");
      if (!pideNombre) return [];
      const pedidos = (include ?? []).map((i) => i.as);
      includes.push(...pedidos);
      // Sequelize solo trae lo que se le pide: sin el include no hay `patient`.
      if (pedidos.includes("patient")) return CITAS;
      return CITAS.map(({ patient: _p, ...resto }) => resto);
    },
  };
  return {
    includes,
    ctx: {
      hasModule: (k) => ["citas", "team", ...(conPacientes ? ["clinica", "pacientes"] : [])].includes(k),
      tenantHasModule: (k) => ["citas", "team", ...(conPacientes ? ["clinica", "pacientes"] : [])].includes(k),
      tenantModels: {
        Booking,
        EventType: {},
        Patient: conPacientes ? {} : undefined,
        TeamMember: { findOne: async () => ({ id: "tm-laura" }), findAll: async () => [] },
      },
      tenantSequelize: null,
      user: { id: "u1", role: "user" },
      tenant: { settings: { citas: { agendaCompartida: false } } },
    },
  };
}

describe("«Mi agenda» de la portada, en un centro con pacientes", () => {
  it("pinta el paciente cuando la cita tiene uno", async () => {
    const m = modelos({ conPacientes: true });
    const portada = await buildPortada(m.ctx);
    const citas = portada.agenda?.mias?.citas ?? [];
    assert.equal(citas.length, 2);
    assert.equal(citas[0].clientName, "El niño Que viene");
  });

  it("y deja el nombre de siempre cuando no lo tiene (taller, adulto)", async () => {
    const m = modelos({ conPacientes: true });
    const portada = await buildPortada(m.ctx);
    assert.equal(portada.agenda.mias.citas[1].clientName, "Un adulto de consulta");
  });

  it("para lo cual pide el paciente en la consulta", async () => {
    const m = modelos({ conPacientes: true });
    await buildPortada(m.ctx);
    assert.ok(m.includes.includes("patient"), "la portada no trae el paciente: " + JSON.stringify(m.includes));
  });
});

describe("y en un centro SIN pacientes no se toca esa tabla", () => {
  it("ni se pide el include ni cambia el nombre", async () => {
    const m = modelos({ conPacientes: false });
    const portada = await buildPortada(m.ctx);
    assert.ok(!m.includes.includes("patient"), "pide `patients` donde no existe: " + JSON.stringify(m.includes));
    assert.equal(portada.agenda.mias.citas[0].clientName, "La madre que paga");
  });
});
