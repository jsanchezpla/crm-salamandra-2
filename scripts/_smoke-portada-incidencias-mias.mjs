// @prueba ligera
/**
 * _smoke-portada-incidencias-mias.mjs — la tarjeta «Incidencias abiertas» de
 * la portada avisa SOLO de las tuyas (01/09/2026, Rodrigo).
 *
 * Nació el 31/08 contando las de TODO el centro, así que a cada uno le avisaba
 * de incidencias que no le tocan. La regla de «las mías» es la de la tabla
 * pivote (lib/clinica/incidenciasDe.js), la misma que ya usaban la campana,
 * Equipo → Bandeja y Mi trabajo.
 *
 * Se comprueba el `where` con el que se cuenta, no solo el número: el bloque va
 * dentro de `safeBlock`, y una consulta rota también devolvería «sin tarjeta».
 *
 * Lógica pura con modelos de mentira: sin base de datos, sin servidor, sin .env.
 * (La marca «ligera» es obligatoria: aquí se nombra sequelize.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import { buildPortada } from "../lib/home/summary.js";

const FICHA = "tm-bea";
// Sin `billing`: sin adhesión no hay «Mi trabajo» que competir, y la mitad de
// Hoy —donde vive Pendiente— se construye igual.
const MODULOS = ["citas", "team", "clinica", "pacientes", "team_avanzado"];

/** Lo que hay abierto en TODO el centro, para distinguirlo de «las mías». */
const EN_EL_CENTRO = 7;

/** ctx de mentira. `mias` = ids de incidencias donde figura como responsable. */
function ctxDe({ mias, conFicha = true, role = "user" }) {
  const contado = [];
  const tenantModels = {
    TeamMember: {
      findOne: async () => (conFicha ? { id: FICHA } : null),
      findAll: async () => [],
    },
    ClinicalReport: { count: async () => 0 },
    Booking: { count: async () => 0, findAll: async () => [] },
    EventType: { findAll: async () => [] },
    ClinicSession: { findAll: async () => [] },
    IncidenciaAssignee: {
      findAll: async ({ where }) => {
        assert.equal(where.teamMemberId, FICHA, "se preguntan las de QUIEN MIRA");
        return mias.map((id) => ({ incidenciaId: id }));
      },
    },
    Incidencia: {
      // Cuenta de verdad sobre el `where` que reciba: sin filtro de persona
      // devuelve el centro entero, así que si alguien vuelve a contarlo todo
      // para quien no dirige, aquí se ve.
      count: async ({ where }) => {
        contado.push(where);
        return where.id?.[Op.in]?.length ?? EN_EL_CENTRO;
      },
      findAll: async () => [],
    },
    CalendarTask: { findAll: async () => [] },
  };
  const t = new Set(MODULOS);
  return {
    ctx: {
      hasModule: (k) => t.has(k),
      tenantHasModule: (k) => t.has(k),
      tenantModels,
      tenantSequelize: null,
      user: { id: "u1", role },
      tenant: { settings: {} },
    },
    contado,
  };
}

const tarjeta = (p) => p.pendiente.find((x) => x.key === "incidencias") ?? null;

test("la tarjeta cuenta MIS incidencias abiertas, no las del centro", async () => {
  const { ctx, contado } = ctxDe({ mias: ["i1", "i2"] });
  const p = await buildPortada(ctx);
  assert.equal(contado.length, 1, "la cuenta tiene que haberse hecho");
  assert.deepEqual(contado[0].id[Op.in], ["i1", "i2"], "filtrada por la pivote");
  assert.equal(contado[0].status[Op.ne], "resolved");
  assert.equal(tarjeta(p)?.count, 2);
  assert.equal(tarjeta(p)?.titulo, "Incidencias abiertas");
});

test("sin ninguna incidencia mía no sale tarjeta (aunque el centro tenga muchas)", async () => {
  const { ctx, contado } = ctxDe({ mias: [] });
  const p = await buildPortada(ctx);
  assert.deepEqual(contado[0].id[Op.in], [], "cuenta cero, no cuenta todas");
  assert.equal(tarjeta(p), null);
});

test("quien no tiene ficha de equipo no tiene incidencias propias: ni se pregunta", async () => {
  const { ctx, contado } = ctxDe({ mias: ["i1"], conFicha: false });
  const p = await buildPortada(ctx);
  assert.equal(contado.length, 0, "sin ficha no se consulta nada");
  assert.equal(tarjeta(p), null);
});

// Dirección es la excepción (01/09/2026, Rodrigo): quien dirige necesita el
// panorama, no su bandeja. Va por ROL, no por ficha: el admin de dirección de
// Aumenta no tiene ficha de equipo y es justo quien más mira esta tarjeta.
test("dirección sigue viendo el total del centro, no solo lo suyo", async () => {
  const { ctx, contado } = ctxDe({ mias: ["i1"], role: "admin" });
  const p = await buildPortada(ctx);
  assert.equal(contado[0].id, undefined, "sin filtro de persona");
  assert.equal(contado[0].status[Op.ne], "resolved");
  assert.equal(tarjeta(p)?.count, EN_EL_CENTRO);
});

test("y lo ve aunque no tenga ficha de equipo (el admin de dirección)", async () => {
  const { ctx } = ctxDe({ mias: [], conFicha: false, role: "admin" });
  const p = await buildPortada(ctx);
  assert.equal(tarjeta(p)?.count, EN_EL_CENTRO);
});

test("una incidencia sola va en singular", async () => {
  const { ctx } = ctxDe({ mias: ["i1"] });
  const p = await buildPortada(ctx);
  assert.equal(tarjeta(p)?.count, 1);
  assert.equal(tarjeta(p)?.titulo, "Incidencia abierta");
  assert.equal(tarjeta(p)?.href, "/equipo/incidencias");
});
