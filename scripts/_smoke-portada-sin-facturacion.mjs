// @prueba ligera
/**
 * _smoke-portada-sin-facturacion.mjs — quién ve gráficas en la portada.
 *
 * Fija la regla del 29/08/2026 (Rodrigo): un miembro del equipo NO adherido al
 * módulo de facturación no ve gráficas de NINGÚN tipo — su mitad derecha es
 * «Mi trabajo» (bandeja, semana, tareas). Y la letra pequeña que evita una
 * regresión: en un tenant que NO ha comprado facturación no hay adhesión que
 * negar, así que sus usuarios conservan las gráficas de actividad de siempre.
 *
 * Lógica pura con modelos de mentira: sin base de datos, sin servidor, sin .env.
 * (La marca «ligera» es obligatoria: abajo se nombra sequelize en comentarios.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortada } from "../lib/home/summary.js";

const FICHA = "tm-terapeuta";

// Modelos de mentira con actividad por todas partes: si una gráfica se pinta,
// tiene datos con los que pintarse; si no se pinta, es por la regla.
function modelos() {
  const serie = [{ mes: "2026-08", v: 5 }];
  return {
    Invoice: { findAll: async () => [{ n: 2, sum: 100, billed: 100, mes: "2026-08", v: 100 }] },
    Booking: {
      count: async () => 3,
      findAll: async ({ attributes = [] } = {}) => {
        // El group-by de las series pide alias; las listas piden filas. Para la
        // prueba basta devolver algo con las dos formas a la vez.
        void attributes;
        return [{ eventTypeId: "et1", n: 4, dia: "2026-08-28", mes: "2026-08", v: 4, minutes: 300, teamMemberId: FICHA }];
      },
    },
    EventType: { findAll: async () => [{ id: "et1", name: "Sesión", price: 5000, sessionsCount: 1 }] },
    TeamMember: {
      findOne: async () => ({ id: FICHA }),
      findAll: async () => [{ id: FICHA, displayName: "Tera Peuta", weeklyDirectHours: 20 }],
    },
    Lead: { findAll: async () => [{ stage: "new", n: 2 }] },
    Client: { findAll: async () => serie },
    ClinicSession: { findAll: async () => serie },
    CourseEnrollment: { findAll: async () => serie },
    ClinicalReport: { count: async () => 2 },
    Incidencia: {
      findAll: async () => [
        { id: "i1", title: "Llamar a la familia", status: "pending", priority: "high", incidenceDate: "2026-08-28" },
      ],
      count: async () => 1,
    },
    CalendarTask: {
      findAll: async () => [{ id: "t1", title: "Preparar sesión", priority: "medium", startDate: "2026-08-30", startTime: null }],
    },
  };
}

function ctxDe({ tenantTiene, usuarioTiene, role = "user" }) {
  const t = new Set(tenantTiene);
  const u = new Set(usuarioTiene);
  return {
    hasModule: (k) => t.has(k) && u.has(k),
    tenantHasModule: (k) => t.has(k),
    tenantModels: modelos(),
    tenantSequelize: null,
    user: { id: "u1", role },
    tenant: { settings: {} },
  };
}

const TODO = ["billing", "citas", "team", "clinica", "pacientes", "team_avanzado", "calendar", "leads", "clients"];

test("sin adhesión a facturación: cero gráficas, cero finanzas, y «Mi trabajo»", async () => {
  const p = await buildPortada(
    ctxDe({ tenantTiene: TODO, usuarioTiene: TODO.filter((k) => k !== "billing") })
  );
  assert.deepEqual(p.vistas, []);
  assert.equal(p.finance, null);
  assert.ok(p.trabajo, "la mitad derecha operativa tiene que llegar");
  assert.ok(p.trabajo.bandeja, "con clínica y equipo avanzado, la bandeja sale");
  assert.equal(p.trabajo.bandeja.informes, 2);
  assert.equal(p.trabajo.bandeja.incidenciasTotal, 1);
});

test("con adhesión a facturación: hay gráficas y no hay «Mi trabajo»", async () => {
  const p = await buildPortada(ctxDe({ tenantTiene: TODO, usuarioTiene: TODO }));
  assert.ok(p.vistas.length > 0, "con actividad, alguna gráfica sale");
  assert.equal(p.trabajo, null);
});

test("tenant SIN facturación: no hay adhesión que negar, las gráficas de actividad siguen", async () => {
  const sinBilling = TODO.filter((k) => k !== "billing");
  const p = await buildPortada(ctxDe({ tenantTiene: sinBilling, usuarioTiene: sinBilling }));
  assert.equal(p.trabajo, null, "la regla no se dispara");
  assert.ok(
    p.vistas.some((v) => v.key === "citas-semana" || v.key === "altas" || v.key === "embudo-leads"),
    "las gráficas de actividad de siempre siguen: " + JSON.stringify(p.vistas.map((v) => v.key))
  );
  assert.ok(!p.vistas.some((v) => v.key === "facturacion" || v.key === "ingresos-servicio"));
});

test("la ocupación por miembro es solo para admin, y los ingresos piden facturación y citas", async () => {
  const admin = await buildPortada(ctxDe({ tenantTiene: TODO, usuarioTiene: TODO, role: "admin" }));
  assert.ok(admin.vistas.some((v) => v.key === "ocupacion"), JSON.stringify(admin.vistas.map((v) => v.key)));
  assert.ok(admin.vistas.some((v) => v.key === "ingresos-servicio"));
  const ocupacion = admin.vistas.find((v) => v.key === "ocupacion");
  assert.equal(ocupacion.unidad, "pct");
  const ingresos = admin.vistas.find((v) => v.key === "ingresos-servicio");
  assert.equal(ingresos.unidad, "eur");
  assert.equal(ingresos.datos[0].valor, 200); // 4 citas × 50 € (5000 céntimos)

  const user = await buildPortada(ctxDe({ tenantTiene: TODO, usuarioTiene: TODO, role: "user" }));
  assert.ok(!user.vistas.some((v) => v.key === "ocupacion"), "un no-admin no ve la ocupación del equipo");
});
