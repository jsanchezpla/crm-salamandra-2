// @prueba ligera — una regex sobre el fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-ficha-incidencia-orden.mjs — en la ficha de una incidencia, primero lo
 * que PASÓ y luego lo que se HIZO (18/09/2026, AV-0182 de Aumenta).
 *
 *   node scripts/_smoke-ficha-incidencia-orden.mjs
 *
 * Isabel: «¿podríais cambiarnos de lugar el cuadro de Observaciones y Acciones
 * realizadas? Usamos el cuadro de observaciones para describir la incidencia y
 * el de acciones para cuando hemos hecho algo con ella». Estaban al revés: se
 * abría la ficha y lo primero que pedía era el remedio de algo que todavía no
 * se había contado.
 *
 * Esto es ORDEN en una pantalla, así que la prueba es una regex sobre el fuente
 * —que es lo que `CLAUDE.md` reserva para «¿sigue esto donde estaba?»—: no hay
 * función que devuelva nada que comprobar. Sirve para que el próximo que mueva
 * cajas en ese modal se entere de que este orden lo pidió una persona.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../app/(dashboard)/equipo/_components/IncidenciaModal.jsx", import.meta.url),
  "utf8"
);

const posicionDe = (etiqueta) => {
  const i = src.indexOf(`>${etiqueta}</label>`);
  assert.notEqual(i, -1, `no está la etiqueta «${etiqueta}» en la ficha de incidencias`);
  return i;
};

describe("la ficha de una incidencia se lee en el orden en que pasan las cosas", () => {
  it("Observaciones va ANTES que Acción realizada (AV-0182)", () => {
    assert.ok(
      posicionDe("Observaciones") < posicionDe("Acción realizada"),
      "«Observaciones» tiene que ir delante: primero se cuenta qué pasó y luego qué se hizo"
    );
  });

  it("y la Verificación, detrás de la acción que verifica", () => {
    assert.ok(posicionDe("Acción realizada") < posicionDe("Verificación"));
  });

  it("las tres cajas siguen estando", () => {
    for (const etiqueta of ["Observaciones", "Acción realizada", "Verificación"]) {
      assert.equal(src.split(`>${etiqueta}</label>`).length, 2, `«${etiqueta}» tiene que salir una sola vez`);
    }
  });
});
