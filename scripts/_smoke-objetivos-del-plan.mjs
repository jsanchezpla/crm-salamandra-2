// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-objetivos-del-plan.mjs — los objetivos del Plan con su terapeuta
 * (07/09/2026, AV-0061 de Aumenta: «pacientes compartidos, objetivos por
 * especialidad»).
 *
 *   node scripts/_smoke-objetivos-del-plan.mjs
 *
 * La regla vive en `lib/clinica/objetivosDelPlan.js`: acepta los textos de
 * siempre y los objetos nuevos, no pierde ninguno, no repite, y agrupa por
 * terapeuta con quien escribe primero.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizarObjetivos,
  textosDeObjetivos,
  agruparPorTerapeuta,
  editarObjetivo,
  puedeEditarObjetivo,
  MAX_OBJETIVOS,
  MAX_TEXTO_OBJETIVO,
} from "../lib/clinica/objetivosDelPlan.js";

const LOGO = "11111111-1111-4111-8111-111111111111";
const PSICO = "22222222-2222-4222-8222-222222222222";

describe("normalizarObjetivos", () => {
  it("un plan viejo (textos) sigue valiendo: cada texto es un objetivo sin terapeuta", () => {
    assert.deepEqual(normalizarObjetivos(["Atención sostenida", "  Turnos  "]), [
      { texto: "Atención sostenida", terapeutaId: null },
      { texto: "Turnos", terapeutaId: null },
    ]);
  });
  it("los objetos llevan su terapeuta, y un id que no es UUID se descarta (no el objetivo)", () => {
    assert.deepEqual(normalizarObjetivos([{ texto: "Frases de 3 elementos", terapeutaId: LOGO }, { texto: "x", terapeutaId: "pepe" }]), [
      { texto: "Frases de 3 elementos", terapeutaId: LOGO },
      { texto: "x", terapeutaId: null },
    ]);
  });
  it("vacíos fuera; el mismo texto en dos terapeutas se queda, repetido en la misma no", () => {
    const r = normalizarObjetivos([
      "", { texto: "  " }, null, 7,
      { texto: "Turnos", terapeutaId: LOGO }, { texto: "turnos", terapeutaId: LOGO }, { texto: "Turnos", terapeutaId: PSICO },
    ]);
    assert.equal(r.length, 2);
  });
  it("tope y recorte", () => {
    const muchos = Array.from({ length: 60 }, (_, i) => `Objetivo ${i}`);
    assert.equal(normalizarObjetivos(muchos).length, MAX_OBJETIVOS);
    assert.equal(normalizarObjetivos(["a".repeat(500)])[0].texto.length, 300);
  });
});

describe("textosDeObjetivos", () => {
  it("solo los textos, en orden, de las dos formas", () => {
    assert.deepEqual(textosDeObjetivos(["A", { texto: "B", terapeutaId: LOGO }]), ["A", "B"]);
  });
});

describe("agruparPorTerapeuta", () => {
  const terapeutas = [{ id: PSICO, nombre: "Ana Psico", especialidad: "psicologia" }, { id: LOGO, nombre: "Eva Logo", especialidad: "logopedia" }];
  it("un grupo por terapeuta del paciente (aunque no tenga objetivos), quien escribe primero, y los sueltos al final", () => {
    const g = agruparPorTerapeuta(["Viejo suelto", { texto: "Fonemas", terapeutaId: LOGO }], { terapeutas, yo: LOGO });
    assert.deepEqual(g.map((x) => x.nombre), ["Eva Logo", "Ana Psico", "Sin terapeuta"]);
    assert.equal(g[0].esYo, true);
    assert.equal(g[0].especialidad, "logopedia");
    assert.deepEqual(g[0].objetivos.map((o) => o.texto), ["Fonemas"]);
    assert.deepEqual(g[1].objetivos, []);
    assert.deepEqual(g[2].objetivos.map((o) => o.texto), ["Viejo suelto"]);
  });
  it("un terapeuta que ya no es del paciente conserva su grupo con el nombre del equipo", () => {
    const g = agruparPorTerapeuta([{ texto: "Antiguo", terapeutaId: PSICO }], { terapeutas: [], equipo: [{ id: PSICO, displayName: "Ana Psico" }] });
    assert.deepEqual(g.map((x) => x.nombre), ["Ana Psico"]);
    const sin = agruparPorTerapeuta([{ texto: "Antiguo", terapeutaId: PSICO }], {});
    assert.equal(sin[0].nombre, "Terapeuta que ya no está");
  });
});

/*
 * ── CORREGIR UN OBJETIVO EN SITIO (09/09/2026, AV-0080 de Aumenta) ──────────
 * Blanca: «esos mismos objetivos que te genera la IA, pueda modificarse, ya que
 * ahora tan solo deja eliminarlos o añadir algún otro nuevo».
 */
describe("editarObjetivo", () => {
  const YO = "11111111-1111-1111-1111-111111111111";
  const OTRA = "22222222-2222-2222-2222-222222222222";
  const base = () => [
    { texto: "Mantener la atención sostenida 15-20 minutos", terapeutaId: YO },
    { texto: "Mejorar la precisión lectora", terapeutaId: YO },
    { texto: "Mejorar la precisión lectora", terapeutaId: OTRA },
  ];

  it("cambia el texto de esa posición y no toca ni el terapeuta ni a los demás", () => {
    const r = editarObjetivo(base(), 1, "Mejorar la precisión lectora en textos de su nivel");
    assert.equal(r.ok, true);
    assert.equal(r.objetivos[1].texto, "Mejorar la precisión lectora en textos de su nivel");
    assert.equal(r.objetivos[1].terapeutaId, YO);
    assert.equal(r.objetivos[0].texto, "Mantener la atención sostenida 15-20 minutos");
    assert.equal(r.objetivos[2].texto, "Mejorar la precisión lectora");
    assert.equal(r.objetivos.length, 3);
  });

  it("recorta a 300, igual que al añadir", () => {
    // Hay un objetivo en producción clavado en el tope: ya salió recortado.
    const r = editarObjetivo(base(), 0, "x".repeat(400));
    assert.equal(r.ok, true);
    assert.equal(r.objetivos[0].texto.length, MAX_TEXTO_OBJETIVO);
  });

  it("EL FEO: dejarlo igual que otro objetivo MÍO no se guarda y avisa", () => {
    /*
     * Sin este freno `normalizarObjetivos` se queda con el primero y el
     * objetivo recién corregido desaparece sin decir nada — que es peor que no
     * dejar editar.
     */
    const r = editarObjetivo(base(), 0, "Mejorar la precisión lectora");
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "repetido");
    assert.equal(r.objetivos.length, 3, "la lista vuelve entera");
    assert.equal(r.objetivos[0].texto, "Mantener la atención sostenida 15-20 minutos");
  });

  it("el mismo texto que el de OTRA terapeuta sí vale", () => {
    // La logopeda y la psicóloga pueden compartir objetivo: son dos terapias.
    const r = editarObjetivo(base(), 0, "Mejorar la precisión lectora".toUpperCase());
    assert.equal(r.ok, false, "ojo: este caso es contra la MISMA terapeuta");
    const r2 = editarObjetivo(
      [{ texto: "A", terapeutaId: YO }, { texto: "B", terapeutaId: OTRA }],
      1,
      "A",
    );
    assert.equal(r2.ok, true);
    assert.equal(r2.objetivos[1].texto, "A");
    assert.equal(r2.objetivos[1].terapeutaId, OTRA);
  });

  it("vaciarlo no borra: para eso está la ×", () => {
    for (const v of ["", "   ", null, undefined]) {
      const r = editarObjetivo(base(), 0, v);
      assert.equal(r.ok, false);
      assert.equal(r.motivo, "vacio");
      assert.equal(r.objetivos.length, 3);
    }
  });

  it("una posición que no existe no revienta ni inventa nada", () => {
    for (const i of [-1, 3, 99, 1.5, "uno", null, undefined]) {
      const r = editarObjetivo(base(), i, "Otra cosa");
      assert.equal(r.ok, false, `indice ${i}`);
      assert.equal(r.motivo, "no-esta");
      assert.equal(r.objetivos.length, 3);
    }
  });

  it("funciona sobre un plan viejo de textos sueltos", () => {
    // 151 de los 571 objetivos de Aumenta siguen siendo texto plano.
    const r = editarObjetivo(["Primero", "Segundo"], 1, "Segundo corregido");
    assert.equal(r.ok, true);
    assert.deepEqual(r.objetivos, [
      { texto: "Primero", terapeutaId: null },
      { texto: "Segundo corregido", terapeutaId: null },
    ]);
  });

  it("dejarlo exactamente igual se acepta y no cambia nada", () => {
    const r = editarObjetivo(base(), 0, "Mantener la atención sostenida 15-20 minutos");
    assert.equal(r.ok, true);
    assert.deepEqual(r.objetivos, normalizarObjetivos(base()));
  });

  it("la lista de entrada no se toca", () => {
    const lista = base();
    editarObjetivo(lista, 0, "Otra cosa");
    assert.equal(lista[0].texto, "Mantener la atención sostenida 15-20 minutos");
  });
});

describe("puedeEditarObjetivo", () => {
  const YO = "11111111-1111-1111-1111-111111111111";
  const OTRA = "22222222-2222-2222-2222-222222222222";

  it("el mío sí, el de otra no", () => {
    assert.equal(puedeEditarObjetivo({ terapeutaId: YO }, { yo: YO }), true);
    assert.equal(puedeEditarObjetivo({ terapeutaId: OTRA }, { yo: YO }), false);
  });

  it("el que no tiene dueño sí, aunque no sea mío", () => {
    // Son 188 en Aumenta: es como se limpian los planes viejos.
    assert.equal(puedeEditarObjetivo({ terapeutaId: null }, { yo: YO }), true);
    assert.equal(puedeEditarObjetivo({ terapeutaId: null }, { yo: null }), true);
  });

  it("dirección puede con todos", () => {
    assert.equal(puedeEditarObjetivo({ terapeutaId: OTRA }, { yo: YO, esAdmin: true }), true);
  });

  it("sin saber quién soy, lo de otra sigue cerrado", () => {
    assert.equal(puedeEditarObjetivo({ terapeutaId: OTRA }, {}), false);
    assert.equal(puedeEditarObjetivo({ terapeutaId: OTRA }), false);
  });
});

describe("el índice que hace falta para señalar un objetivo", () => {
  it("agruparPorTerapeuta devuelve la posición en la lista normalizada", () => {
    /*
     * Sin esto el botón «mío» estaba ROTO desde el 07/09: comparaba por
     * identidad de objeto (`x === o`) y `agruparPorTerapeuta` devuelve copias,
     * así que no acertaba nunca y el clic no hacía nada.
     */
    const YO = "11111111-1111-1111-1111-111111111111";
    const lista = [{ texto: "A", terapeutaId: YO }, "B", { texto: "C", terapeutaId: YO }];
    const grupos = agruparPorTerapeuta(lista, { yo: YO });
    const mios = grupos.find((g) => g.terapeutaId === YO).objetivos;
    const sueltos = grupos.find((g) => g.terapeutaId === null).objetivos;
    assert.deepEqual(mios.map((o) => o.indice), [0, 2]);
    assert.deepEqual(sueltos.map((o) => o.indice), [1]);
    // Y el índice apunta de verdad a ese objetivo en la lista normalizada.
    const normal = normalizarObjetivos(lista);
    assert.equal(normal[sueltos[0].indice].texto, "B");
  });
});
