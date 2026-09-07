// @prueba ligera — regex sobre el fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-convertir-bloqueo-en-cita.mjs — «Convertir en cita» desde el modal
 * del bloqueo (07/09/2026, AV-0059 de Aumenta: un «Reservado» que la familia
 * confirma pasa a ser la cita del paciente con su cobro).
 *
 *   node scripts/_smoke-convertir-bloqueo-en-cita.mjs
 *
 * No hay función pura que probar: es un gesto entre tres pantallas. Lo que se
 * vigila es que las tres piezas sigan encajadas: el modal ofrece el botón, el
 * calendario abre el alta con la terapeuta y el bloqueo, y el drawer crea la
 * cita sin el aviso del bloqueo y lo quita después.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lee = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("el modal del bloqueo ofrece «Convertir en cita» (no en talleres)", () => {
  const src = lee("modules/default/citas/BloqueoModal.jsx");
  assert.match(src, /onConvertir = null/);
  assert.match(src, /onConvertir && !bloqueo\.tallerId/);
  assert.match(src, /Convertir en cita/);
});

test("el calendario abre el alta con la terapeuta del hueco y el bloqueo a sustituir", () => {
  const src = lee("modules/default/CitasModule.jsx");
  assert.match(src, /teamMemberId: b\.teamMemberId \?\? null/);
  assert.match(src, /desdeBloqueo: \{/);
  assert.match(src, /teamMemberId: b\.teamMemberId \?\? ""/);
  const cols = lee("modules/default/citas/AgendaPorTerapeuta.jsx");
  assert.match(cols, /teamMemberId: b\.teamMemberId \?\? null/);
});

test("el drawer nace con la terapeuta, no avisa del propio bloqueo y lo quita al guardar", () => {
  const src = lee("modules/default/citas/NuevaCitaDrawer.jsx");
  assert.match(src, /teamMemberId: inicial\.teamMemberId \?\? ""/);
  assert.match(src, /\.\.\.\(desdeBloqueo \? \{ permitirBloqueo: true \} : \{\}\)/);
  assert.match(src, /\/api\/citas\/bloqueos\?id=\$\{encodeURIComponent\(desdeBloqueo\.id\)\}`, \{ method: "DELETE" \}/);
  // El borrado va DESPUÉS de crear la cita y ANTES de avisar al padre.
  const iCrear = src.indexOf('if (!j.ok) throw new Error(j.error || "Error creando cita")');
  const iBorrar = src.indexOf("method: \"DELETE\" });\n          const jb");
  const iCreated = src.indexOf("onCreated();", iBorrar);
  assert.ok(iCrear > 0 && iBorrar > iCrear && iCreated > iBorrar, "orden: crear → quitar bloqueo → onCreated");
});
