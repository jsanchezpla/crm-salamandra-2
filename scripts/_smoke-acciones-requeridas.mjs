// @prueba ligera
// Fija lib/billing/accionesRequeridas.js: las filas de la pantalla «Acciones
// requeridas», con modelos de mentira.
import test from "node:test";
import assert from "node:assert/strict";
import { listaDeAcciones } from "../lib/billing/accionesRequeridas.js";

const HOY = "2026-08-31";
const EN7 = "2026-09-07";

function modelos({ facturas = [], presupuestos = [], quotesRompe = null } = {}) {
  return {
    Client: {}, // solo hace falta que exista para que se pida el include
    Invoice: { findAll: async () => facturas },
    Quote: {
      findAll: async (opts) => {
        if (quotesRompe) throw quotesRompe;
        // Distingue las dos consultas por su where: accepted vs vivas
        const esAceptados = opts?.where?.status === "accepted";
        return presupuestos.filter((p) => (esAceptados ? p.status === "accepted" : p.status !== "accepted"));
      },
    },
  };
}

test("una factura vencida sale con su pendiente (total − cobrado), no con el total", async () => {
  const r = await listaDeAcciones({
    tenantModels: modelos({
      facturas: [{ id: 1, number: "F-2026-0001", clientId: 9, client: { name: "Familia G." }, dueDate: "2026-08-01", total: "100.00", paidAmount: "40.00" }],
    }),
    today: HOY,
    in7: EN7,
  });
  assert.equal(r.vencidas.length, 1);
  assert.equal(r.vencidas[0].tipo, "vencida");
  assert.equal(r.vencidas[0].importe, 60);
  assert.equal(r.vencidas[0].cliente, "Familia G.");
  assert.equal(r.vencidas[0].fecha, "2026-08-01");
});

test("presupuestos: los vivos que caducan y los aceptados salen en listas separadas", async () => {
  const r = await listaDeAcciones({
    tenantModels: modelos({
      presupuestos: [
        { id: 2, number: "P-2026-0002", status: "sent", client: { name: "A" }, validUntil: "2026-09-02", issueDate: "2026-08-20", total: "50.00" },
        { id: 3, number: "P-2026-0003", status: "accepted", client: { name: "B" }, validUntil: "2026-09-20", issueDate: "2026-08-25", total: "80.00" },
      ],
    }),
    today: HOY,
    in7: EN7,
  });
  assert.deepEqual(r.caducan.map((x) => x.numero), ["P-2026-0002"]);
  assert.deepEqual(r.aceptados.map((x) => x.numero), ["P-2026-0003"]);
  assert.equal(r.caducan[0].tipo, "caduca");
  assert.equal(r.aceptados[0].tipo, "aceptado");
  assert.equal(r.aceptados[0].importe, 80);
});

test("la tabla quotes sin migrar (42P01) deja las dos listas vacías sin tumbar nada", async () => {
  const e = new Error("relation quotes does not exist");
  e.parent = { code: "42P01" };
  const r = await listaDeAcciones({ tenantModels: modelos({ quotesRompe: e }), today: HOY, in7: EN7 });
  assert.deepEqual(r.caducan, []);
  assert.deepEqual(r.aceptados, []);
});

test("otro error de base NO se esconde", async () => {
  const e = new Error("se cayó");
  e.parent = { code: "57P01" };
  await assert.rejects(() => listaDeAcciones({ tenantModels: modelos({ quotesRompe: e }), today: HOY, in7: EN7 }));
});

test("sin nada pendiente: tres listas vacías y ningún tope tocado", async () => {
  const r = await listaDeAcciones({ tenantModels: modelos(), today: HOY, in7: EN7 });
  assert.deepEqual(r.vencidas, []);
  assert.equal(r.topes.vencidas, false);
  assert.equal(r.topes.limite > 0, true);
});
