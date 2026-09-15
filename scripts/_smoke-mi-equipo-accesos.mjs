// @prueba ligera
// La pantalla de Equipo de quien no es admin abre por su Bandeja (15/09/2026, AV-0078 de Aumenta).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/team/MiEquipo.jsx", import.meta.url), "utf8");

test("los accesos van ARRIBA, antes de «Mis datos»", () => {
  assert.ok(src.indexOf("<AccesosDelDia />") > 0);
  assert.ok(src.indexOf("<AccesosDelDia />") < src.indexOf("Mis datos"));
});

test("siguen saliendo solo donde existen los endpoints", () => {
  assert.match(src, /\{verAccesosDeEquipoAvanzado && <AccesosDelDia \/>\}/);
});

test("la tarjeta cuenta con el MISMO endpoint que la Bandeja y avisa a quien coordina", () => {
  assert.match(src, /fetch\("\/api\/clinica\/bandeja"/);
  assert.match(src, /registrosSinEmpezar/);
  assert.match(src, /bandeja\?\.coordina/);
  assert.match(src, /Mi bandeja de trabajo/);
});
