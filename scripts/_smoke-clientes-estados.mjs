// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clientes-estados.mjs — el estado de una ficha (26/08/2026).
 *
 *   node scripts/_smoke-clientes-estados.mjs
 *   node --test-name-pattern="No vino" scripts/_smoke-clientes-estados.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * Lau pidió poder marcar «no vino» a quien llamó y nunca llegó a empezar. El
 * estado va en la COLUMNA `clients.status`, que ya tenía el valor `prospect`
 * sin estrenar. Tres cosas se pueden romper aquí sin que se note:
 *
 *   · **Que se cuele un valor que no es de la columna.** Llega por el cuerpo
 *     del PUT, así que lo escribe quien quiera; y `status` es un ENUM de
 *     PostgreSQL: un valor de fuera no da un dato raro, revienta la consulta.
 *   · **Que se encienda donde no toca.** En un cliente comercial la columna ya
 *     significa otra cosa —la tienda marca `prospect` a quien compró una vez—,
 *     y laura_ubeda tiene 183 fichas así. Enseñarles «No vino» sería mentir.
 *   · **Que «No vino» siga reclamando huecos.** Es la mitad de para lo que
 *     sirve: una ficha de alguien que no viene no puede seguir pidiendo su
 *     teléfono en «Fichas a completar».
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVO,
  BAJA,
  ESTADOS_FICHA,
  NO_VINO,
  dejaDeReclamar,
  esEstadoDeFicha,
  estadosDeFicha,
  etiquetaDeEstado,
  tonoDeEstado,
  usaEstadoDeFicha,
} from "../lib/clients/estados.js";

/** `hasModule` de mentira, como el que reciben las pantallas. */
const con =
  (...modulos) =>
  (k) =>
    modulos.includes(k);

describe("los tres estados son los de la columna, y no más", () => {
  it("son exactamente los del ENUM de clients.status", () => {
    // Si aquí apareciera un cuarto, la consulta reventaría: `status` es un ENUM
    // de PostgreSQL y no acepta valores de fuera.
    assert.deepEqual(ESTADOS_FICHA, ["active", "prospect", "inactive"]);
  });

  it("el selector los da en orden y con rótulo", () => {
    assert.deepEqual(
      estadosDeFicha().map((e) => e.label),
      ["Activo", "No vino", "Baja"]
    );
  });

  it("cada uno lleva su ayuda: el rótulo solo no dice qué pasa al elegirlo", () => {
    for (const e of estadosDeFicha()) assert.ok(e.ayuda.length > 20, e.key);
  });

  it("nadie puede modificar el catálogo desde fuera", () => {
    const primera = estadosDeFicha();
    primera[0].label = "Pisado";
    assert.equal(estadosDeFicha()[0].label, "Activo");
  });
});

describe("esEstadoDeFicha — el valor llega por el cuerpo del PUT", () => {
  it("acepta los tres", () => {
    for (const v of ESTADOS_FICHA) assert.equal(esEstadoDeFicha(v), true, v);
  });

  it("y nada más", () => {
    for (const malo of [
      "",
      null,
      undefined,
      "activo",
      "ACTIVE",
      "new",
      "converted",
      "borrado",
      1,
      {},
    ]) {
      assert.equal(esEstadoDeFicha(malo), false, `${malo}`);
    }
  });

  it("los espacios de sobra no cuelan un valor bueno como malo", () => {
    assert.equal(esEstadoDeFicha("  prospect  "), true);
  });
});

describe("etiquetaDeEstado", () => {
  it("dice lo que se lee en el chip", () => {
    assert.equal(etiquetaDeEstado(ACTIVO), "Activo");
    assert.equal(etiquetaDeEstado(NO_VINO), "No vino");
    assert.equal(etiquetaDeEstado(BAJA), "Baja");
  });

  it("un valor desconocido se dice tal cual, no se traga", () => {
    // Tragárselo pintaría «Activo» sobre un dato que nadie ha entendido: mejor
    // que se vea el valor crudo y alguien pregunte.
    assert.equal(etiquetaDeEstado("inventado"), "inventado");
    assert.equal(etiquetaDeEstado(null), "");
  });

  it("tonoDeEstado nunca devuelve vacío, ni con basura", () => {
    for (const v of [...ESTADOS_FICHA, "inventado", null]) {
      const t = tonoDeEstado(v);
      assert.ok(t.dot && t.bg, `${v}`);
    }
  });
});

describe("dejaDeReclamar — «Fichas a completar» no persigue a quien no viene", () => {
  it("«No vino» y «Baja» dejan de reclamar", () => {
    assert.equal(dejaDeReclamar(NO_VINO), true);
    assert.equal(dejaDeReclamar(BAJA), true);
  });

  it("«Activo» sigue reclamando, que es de lo que va la pantalla", () => {
    assert.equal(dejaDeReclamar(ACTIVO), false);
  });

  it("un estado desconocido reclama: ante la duda, se enseña", () => {
    // El fallo caro aquí es esconder una ficha por un valor que nadie entiende.
    assert.equal(dejaDeReclamar("inventado"), false);
    assert.equal(dejaDeReclamar(null), false);
  });
});

describe("usaEstadoDeFicha — se pregunta por MÓDULO, nunca por slug", () => {
  it("un centro clínico lo usa", () => {
    assert.equal(usaEstadoDeFicha(con("clients", "clinica", "pacientes")), true);
  });

  it("una nutricionista también", () => {
    assert.equal(usaEstadoDeFicha(con("clients", "nutricion")), true);
  });

  it("con solo «pacientes» basta", () => {
    assert.equal(usaEstadoDeFicha(con("clients", "pacientes")), true);
  });

  it("un cliente comercial NO lo usa: allí la columna ya significa otra cosa", () => {
    // laura_ubeda tiene 183 fichas en `prospect` que puso la tienda («compró
    // una vez, todavía no es cartera»). Enseñarles «No vino» sería mentir.
    assert.equal(usaEstadoDeFicha(con("clients", "leads", "booking")), false);
    assert.equal(usaEstadoDeFicha(con("clients", "leads", "tienda", "inventory")), false);
    assert.equal(usaEstadoDeFicha(con("clients")), false);
  });
});
