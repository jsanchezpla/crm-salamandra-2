// @prueba ligera
// Las fechas se leen DD/MM/AAAA (AV-0146 de Aumenta, 15/09/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDate, fmtDateTime } from "../lib/utils/format.js";

test("un día a secas se da la vuelta sin perder un día", () => {
  assert.equal(fmtDate("2026-09-15"), "15/09/2026");
  assert.equal(fmtDate("2026-01-01"), "01/01/2026");
});

test("un instante se lee en hora de Madrid, no en UTC", () => {
  // 23:30 UTC del 14 son las 01:30 del 15 en Madrid.
  assert.equal(fmtDate("2026-09-14T23:30:00.000Z"), "15/09/2026");
  assert.equal(fmtDate(new Date("2026-09-14T23:30:00.000Z")), "15/09/2026");
  assert.equal(fmtDateTime("2026-09-14T23:30:00.000Z"), "15/09/2026 01:30");
});

test("vacío da raya y lo que no es fecha se deja como está", () => {
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate(""), "—");
  assert.equal(fmtDate("no es fecha"), "no es fecha");
});
