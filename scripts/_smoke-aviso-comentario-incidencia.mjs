// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-aviso-comentario-incidencia.mjs — que un comentario en una incidencia
 * llegue a los compañeros (02/09/2026, Rodrigo: «pongo un comentario para mis
 * compañeros, no se actualiza y no les llega ningún aviso»).
 *
 *   node scripts/_smoke-aviso-comentario-incidencia.mjs
 *
 * La regla vive en `lib/clinica/avisoComentarioIncidencia.js`. Si se rompe no
 * da error: el comentario se guarda igual y nadie se entera, que es justo lo
 * que pasaba antes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import {
  TIPO_AVISO,
  fichasQueSeEnteran,
  avisoDeComentario,
  avisarComentarioIncidencia,
} from "../lib/clinica/avisoComentarioIncidencia.js";
import { AUTO_TYPES, notificationLink } from "../lib/notifications/alerts.js";

const INC = {
  id: "i-1",
  title: "Se solapan dos citas",
  reportedById: "tm-r",
  assignedToId: "tm-a",
  comments: [
    { authorId: "tm-c", authorName: "Carla", text: "Visto" },
    { authorId: "tm-r", authorName: "Rosa", text: "¿Cómo lo vemos?" },
  ],
};

describe("a quién le toca enterarse", () => {
  it("quien la registró, los responsables y quien ya comentó; quien escribe, no", () => {
    const f = fichasQueSeEnteran({ incidencia: INC, responsables: ["tm-a", "tm-b"], autorTeamMemberId: "tm-r" });
    assert.deepEqual([...f].sort(), ["tm-a", "tm-b", "tm-c"]);
  });

  it("sin pivote cae al espejo assignedToId, y no repite a nadie", () => {
    const f = fichasQueSeEnteran({ incidencia: INC, autorTeamMemberId: "tm-c" });
    assert.deepEqual([...f].sort(), ["tm-a", "tm-r"]);
  });

  it("nadie más en la conversación: lista vacía (de ahí se avisa a dirección)", () => {
    const sola = { id: "i-2", title: "x", reportedById: "tm-r", assignedToId: null, comments: [{ authorId: "tm-r" }] };
    assert.deepEqual(fichasQueSeEnteran({ incidencia: sola, responsables: [], autorTeamMemberId: "tm-r" }), []);
  });

  it("un admin sin ficha (autor null) no quita a nadie", () => {
    const f = fichasQueSeEnteran({ incidencia: INC, responsables: ["tm-a"], autorTeamMemberId: null });
    assert.deepEqual([...f].sort(), ["tm-a", "tm-c", "tm-r"]);
  });
});

describe("el aviso", () => {
  it("dice quién, en qué incidencia y un anticipo del texto; enlaza a ESA ficha", () => {
    const a = avisoDeComentario({ incidencia: INC, comentario: { authorName: "Marta", text: "Lo   muevo\nal jueves" } });
    assert.equal(a.type, TIPO_AVISO);
    assert.equal(a.title, "Marta ha comentado una incidencia");
    assert.equal(a.body, "«Se solapan dos citas» · Lo muevo al jueves");
    assert.equal(a.entityType, "Incidencia");
    assert.equal(a.entityId, "i-1");
    assert.equal(notificationLink(a.entityType, a.entityId), "/equipo/incidencias?incidencia=i-1");
  });

  it("recorta un comentario largo: la conversación se lee en la ficha", () => {
    const a = avisoDeComentario({ incidencia: INC, comentario: { authorName: "Marta", text: "x".repeat(300) } });
    assert.ok(a.body.endsWith("…"));
    assert.ok(a.body.length < 150, String(a.body.length));
  });

  it("sin id la campana sigue llevando a la lista, como antes", () => {
    assert.equal(notificationLink("Incidencia"), "/equipo/incidencias");
    assert.equal(notificationLink("Incidencia", null), "/equipo/incidencias");
  });

  it("es un hecho, no un estado: fuera de AUTO_TYPES (nadie lo borra al sincronizar)", () => {
    assert.ok(!AUTO_TYPES.includes(TIPO_AVISO));
  });
});

// Un tenant de mentira: fichas con o sin cuenta, la pivote y la campana.
function tenant({ fichas, enlaces = [], rompeCampana = false, rompeFichas = false } = {}) {
  const creadas = [];
  const models = {
    Notification: {
      create: async (v) => {
        if (rompeCampana) throw new Error("campana caída");
        creadas.push(v);
      },
    },
    TeamMember: {
      findAll: async ({ where }) => {
        if (rompeFichas) throw new Error("fichas caídas");
        const ids = where.id[Op.in];
        return fichas.filter((f) => ids.includes(f.id)).map(({ userId }) => ({ userId }));
      },
    },
    IncidenciaAssignee: {
      findAll: async ({ where }) => enlaces.filter((e) => e.incidenciaId === where.incidenciaId),
    },
  };
  return { creadas, ctx: { tenantId: "t-1", tenantModels: models } };
}

const FICHAS = [
  { id: "tm-r", userId: "u-r" },
  { id: "tm-a", userId: "u-a" },
  { id: "tm-b", userId: "u-b" },
  { id: "tm-c", userId: null }, // sin cuenta en el CRM: sin campana
];
const COMENTARIO = { authorId: "tm-r", authorName: "Rosa", text: "¿Cómo lo vemos?" };

describe("la entrega", () => {
  it("toca la campana de cada compañero con cuenta, una vez, con el tipo nuevo", async () => {
    const t = tenant({
      fichas: FICHAS,
      enlaces: [{ incidenciaId: "i-1", teamMemberId: "tm-a" }, { incidenciaId: "i-1", teamMemberId: "tm-b" }],
    });
    let direccion = 0;
    await avisarComentarioIncidencia({
      ctx: t.ctx, row: INC, comentario: COMENTARIO,
      autorTeamMemberId: "tm-r", autorUserId: "u-r",
      entregarADireccion: async () => { direccion += 1; },
    });
    assert.deepEqual(t.creadas.map((c) => c.userId).sort(), ["u-a", "u-b"]);
    assert.equal(direccion, 0);
    for (const c of t.creadas) {
      assert.equal(c.type, TIPO_AVISO);
      assert.equal(c.channel, "app");
      assert.equal(c.entityType, "Incidencia");
      assert.equal(c.entityId, "i-1");
      assert.equal(c.title, "Rosa ha comentado una incidencia");
    }
  });

  it("con los responsables ya incluidos en la fila no consulta la pivote", async () => {
    const t = tenant({ fichas: FICHAS });
    t.ctx.tenantModels.IncidenciaAssignee.findAll = async () => { throw new Error("no debía consultarse"); };
    await avisarComentarioIncidencia({
      ctx: t.ctx, row: { ...INC, assignees: [{ id: "tm-b" }] }, comentario: COMENTARIO,
      autorTeamMemberId: "tm-r", autorUserId: "u-r",
      entregarADireccion: async () => {},
    });
    assert.deepEqual(t.creadas.map((c) => c.userId).sort(), ["u-a", "u-b"]);
  });

  it("si no queda nadie, avisa a dirección menos a quien escribe", async () => {
    const t = tenant({ fichas: FICHAS });
    const sola = { id: "i-2", title: "Sin responsable", reportedById: "tm-r", assignedToId: null, comments: [], assignees: [] };
    const llamadas = [];
    await avisarComentarioIncidencia({
      ctx: t.ctx, row: sola, comentario: COMENTARIO,
      autorTeamMemberId: "tm-r", autorUserId: "u-r",
      entregarADireccion: async (aviso) => { llamadas.push(aviso); },
    });
    assert.equal(t.creadas.length, 0);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].tenantId, "t-1");
    assert.equal(llamadas[0].excepto, "u-r");
    assert.equal(llamadas[0].type, TIPO_AVISO);
    assert.equal(llamadas[0].entityId, "i-2");
  });

  it("un admin sin ficha que comenta no se avisa a sí mismo aunque su cuenta sea la de un responsable", async () => {
    const t = tenant({ fichas: FICHAS });
    await avisarComentarioIncidencia({
      ctx: t.ctx,
      row: { ...INC, assignees: [{ id: "tm-a" }] },
      comentario: { authorId: null, authorName: "Dirección", text: "ok" },
      autorTeamMemberId: null, autorUserId: "u-a",
      entregarADireccion: async () => {},
    });
    assert.deepEqual(t.creadas.map((c) => c.userId).sort(), ["u-r"]);
  });

  it("nunca rompe la operación: campana caída, fichas caídas o tenant sin equipo, y no lanza", async () => {
    const c1 = tenant({ fichas: FICHAS, rompeCampana: true });
    await avisarComentarioIncidencia({
      ctx: c1.ctx, row: { ...INC, assignees: [] }, comentario: COMENTARIO,
      autorTeamMemberId: "tm-r", autorUserId: "u-r", entregarADireccion: async () => {},
    });
    assert.equal(c1.creadas.length, 0);

    const c2 = tenant({ fichas: FICHAS, rompeFichas: true });
    await avisarComentarioIncidencia({
      ctx: c2.ctx, row: { ...INC, assignees: [] }, comentario: COMENTARIO,
      autorTeamMemberId: "tm-r", autorUserId: "u-r", entregarADireccion: async () => {},
    });
    assert.equal(c2.creadas.length, 0);

    await avisarComentarioIncidencia({ ctx: { tenantModels: {} }, row: INC, comentario: COMENTARIO });
  });
});
