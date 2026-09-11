// @prueba ligera — regla pura de /lib y regex sobre el fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-quitar-bloqueo.mjs — quitar un bloqueo desde la agenda (07/09/2026,
 * Rodrigo: «un bloqueo solo se puede borrar desde Citas → Bloqueos, y es
 * donde nadie lo busca»).
 *
 *   node scripts/_smoke-quitar-bloqueo.mjs
 *
 * Lo que se vigila:
 *   · que el modal del bloqueo llame al DELETE de siempre y avise al padre;
 *   · que el botón se enseñe con la MISMA regla que aplica el servidor
 *     (`vetoParaTocar` con verbo «quitar»), para no ofrecer un 403;
 *   · y que el calendario le pase al modal quién es quien mira, que es lo
 *     único con lo que se puede decidir eso.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { vetoParaTocar } from "../lib/citas/permisosBloqueos.js";

const lee = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** La misma condición que pinta el modal, para comprobarla contra el servidor. */
const loEnsenaElModal = (yo, bloqueo) =>
  Boolean(yo?.esAdmin || (bloqueo.teamMemberId && (yo?.esAdministracion || bloqueo.teamMemberId === yo?.teamMemberId)));

describe("el botón se enseña exactamente a quien el servidor deja", () => {
  const casos = [
    ["dirección, bloqueo de otra", { esAdmin: true, teamMemberId: "tm-a" }, { teamMemberId: "tm-b" }],
    ["dirección, cierre del centro", { esAdmin: true, teamMemberId: "tm-a" }, { teamMemberId: null }],
    ["administración, bloqueo de otra", { esAdministracion: true, teamMemberId: "tm-a" }, { teamMemberId: "tm-b" }],
    ["administración, cierre del centro", { esAdministracion: true, teamMemberId: "tm-a" }, { teamMemberId: null }],
    ["terapeuta, el suyo", { teamMemberId: "tm-a" }, { teamMemberId: "tm-a" }],
    ["terapeuta, el de otra", { teamMemberId: "tm-a" }, { teamMemberId: "tm-b" }],
    ["terapeuta, cierre del centro", { teamMemberId: "tm-a" }, { teamMemberId: null }],
    ["sin ficha de equipo", {}, { teamMemberId: "tm-b" }],
  ];
  for (const [nombre, yo, bloqueo] of casos) {
    it(nombre, () => {
      const puedeElServidor = vetoParaTocar(yo, bloqueo, "quitar") === null;
      assert.equal(loEnsenaElModal(yo, bloqueo), puedeElServidor, nombre);
    });
  }
});

describe("las piezas están enganchadas", () => {
  it("el modal borra por el endpoint de siempre y avisa al padre", () => {
    const src = lee("modules/default/citas/BloqueoModal.jsx");
    assert.match(src, /Quitar el bloqueo/);
    // Desde el 11/09/2026 la URL lleva detrás `&siguientes=1` cuando se quita la serie (AV-0121).
    assert.match(src, /\/api\/citas\/bloqueos\?id=\$\{encodeURIComponent\(bloqueo\.id\)\}\$\{conSiguientes \? "&siguientes=1" : ""\}`, \{ method: "DELETE" \}/);
    assert.match(src, /onQuitado \? onQuitado\(\) : onSaved\(\)/);
    // Pregunta antes: al lado está «Convertir en cita» y esto no se deshace.
    assert.match(src, /window\.confirm\(/);
  });

  it("el calendario le dice al modal quién mira, del propio endpoint", () => {
    const src = lee("modules/default/CitasModule.jsx");
    assert.match(src, /yoBloqueosRef\.current = jb\.data\.yo \?\? null/);
    assert.match(src, /yo=\{yoBloqueosRef\.current\}/);
    assert.match(src, /onQuitado=\{/);
  });
});
