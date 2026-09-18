// @prueba ligera — funciones puras de /lib y lectura del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-acta-coordinacion.mjs — una línea, un punto del acta (13/09/2026).
 *
 *   node scripts/_smoke-acta-coordinacion.mjs
 *   node --test-name-pattern="repararTroceado" scripts/_smoke-acta-coordinacion.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El POST de `app/api/clinica/coordinations` hacía `split(",")` sobre Temas,
 * Acuerdos y Próximos pasos. Las 3 actas escritas a mano en Aumenta (09/09 al
 * 11/09/2026) salieron troceadas a media frase: «Reforzar pautas en casa,
 * revisar en un mes» quedaba en DOS acuerdos. La regla pasó a
 * `lib/clinica/actaCoordinacion.js` y esta prueba fija lo que DEVUELVE:
 *
 *   · la coma no parte; las líneas sí; la viñeta escrita a mano se quita y las
 *     falsas viñetas («-5 %», «10.30», «1.5 h», «+34») no;
 *   · un array no se re-parte ni deja pasar objetos (tumbarían el `<li>`);
 *   · la ida y vuelta por un formulario de edición da lo mismo;
 *   · `repararTroceado` recompone lo viejo y NO es idempotente (por eso el
 *     script de reparación se salta las actas ya reparadas);
 *   · de ese script, sus funciones puras: `--antes` obligatorio (con hora, con
 *     zona), `--copia` absoluta y nunca bajo /app, y `planDeFila` (qué
 *     recompone, qué salta —también si algún punto ya lleva coma—, qué cuenta).
 *
 * Y, por texto, que la ruta y las pantallas siguen usándola, y que la entrada
 * de `lib/provisioning/integraciones.js` apunta a la línea buena de la ruta.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lineasDelFormulario,
  asistentesDelFormulario,
  repararTroceado,
  sinVineta,
} from "../lib/clinica/actaCoordinacion.js";
import { serializeCoordination } from "../lib/clinica/serialize.js";
import { algunTrozoConComa, leerArgumentos, planDeFila } from "./reparar-coordinaciones-troceadas.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8");

const T3 = "- Uno\n• Dos\n1. Tres\n2) Cuatro\n3.- Cinco\n* Seis\n– Siete\na) Ocho\n·Nueve";

describe("lineasDelFormulario", () => {
  it("la coma NO parte la frase", () => {
    assert.deepEqual(lineasDelFormulario("Reforzar pautas en casa, revisar en un mes"), [
      "Reforzar pautas en casa, revisar en un mes",
    ]);
  });

  it("parte por cualquier salto de línea, recorta y quita las vacías", () => {
    assert.deepEqual(lineasDelFormulario("Uno\r\n\n  Dos  \rTres\n"), ["Uno", "Dos", "Tres"]);
  });

  it("quita la viñeta escrita a mano", () => {
    assert.deepEqual(lineasDelFormulario(T3), [
      "Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve",
    ]);
  });

  it("no se come lo que parece viñeta y no lo es", () => {
    const lineas = ["-5 % del tiempo", "10.30 reunión con la tutora", "1.5 h más de refuerzo", "1.er trimestre", "+34 600 000 000"];
    assert.deepEqual(lineasDelFormulario(lineas.join("\n")), lineas);
    assert.equal(sinVineta("-5 % del tiempo"), "-5 % del tiempo");
  });

  it("una viñeta sola en su línea desaparece", () => {
    assert.deepEqual(lineasDelFormulario("Uno\n-\n1.\n•\n2)\nDos"), ["Uno", "Dos"]);
  });

  it("vacíos y números", () => {
    for (const v of [null, undefined, "", "   "]) assert.deepEqual(lineasDelFormulario(v), []);
    assert.deepEqual(lineasDelFormulario(7), ["7"]);
    assert.deepEqual(lineasDelFormulario({ texto: "x" }), []);
  });

  it("un array no se re-parte y no deja pasar lo que no es texto", () => {
    assert.deepEqual(
      lineasDelFormulario(["Uno, con coma", "  Dos  ", "", null, { texto: "x" }, ["y"], 5]),
      ["Uno, con coma", "Dos", "5"]
    );
  });

  it("ida y vuelta por un formulario de edición: da lo mismo", () => {
    const a = lineasDelFormulario(T3);
    assert.deepEqual(lineasDelFormulario(a.join("\n")), a);
    const b = lineasDelFormulario("Reforzar pautas en casa, revisar en un mes\n\n- Enviar informe\r\n");
    assert.deepEqual(lineasDelFormulario(b.join("\n")), b);
  });
});

describe("asistentesDelFormulario", () => {
  it("por comas", () => {
    assert.deepEqual(asistentesDelFormulario("Marga, Paloma (tutora)"), ["Marga", "Paloma (tutora)"]);
  });

  it("por líneas y por «;», como el importador", () => {
    assert.deepEqual(asistentesDelFormulario("Marga\nPaloma; Ana"), ["Marga", "Paloma", "Ana"]);
  });

  it("solo separadores → vacío", () => {
    assert.deepEqual(asistentesDelFormulario(",, ,"), []);
    assert.deepEqual(asistentesDelFormulario(null), []);
  });

  it("un array deja los objetos tal cual y limpia los textos", () => {
    const obj = { kind: "external", name: "Marga" };
    assert.deepEqual(asistentesDelFormulario([obj, " Ana ", "", null, ["x"]]), [obj, "Ana"]);
  });
});

describe("repararTroceado", () => {
  it("vuelve a unir lo que partió la coma", () => {
    assert.deepEqual(repararTroceado(["Reforzar pautas en casa", "revisar en un mes"]), [
      "Reforzar pautas en casa, revisar en un mes",
    ]);
  });

  it("y lo parte por sus líneas de verdad", () => {
    assert.deepEqual(repararTroceado(["Pautas\nrevisar", "enviar informe"]), ["Pautas", "revisar, enviar informe"]);
  });

  it("vacíos y lo que no es texto", () => {
    assert.deepEqual(repararTroceado([]), []);
    assert.deepEqual(repararTroceado(null), []);
    assert.deepEqual(repararTroceado(["a", 3, { x: 1 }, "b"]), ["a, b"]);
  });

  it("NO es idempotente: sobre un acta ya reparada la estropea (por eso el script lleva freno)", () => {
    const reparada = ["Línea 1", "Línea 2"];
    const segunda = repararTroceado(reparada);
    assert.deepEqual(segunda, ["Línea 1, Línea 2"]);
    assert.notDeepEqual(segunda, reparada);
  });
});

describe("scripts/reparar-coordinaciones-troceadas.js (sus funciones puras)", () => {
  it("--antes es obligatorio y tiene que ser una fecha", () => {
    assert.ok(leerArgumentos([]).error);
    assert.ok(leerArgumentos(["--confirm"]).error);
    assert.ok(leerArgumentos(["--antes"]).error);
    assert.ok(leerArgumentos(["--antes", "ayer"]).error);
    assert.ok(leerArgumentos(["--antes", "2026-13-45"]).error);
    assert.ok(leerArgumentos(["--antes", "2026-02-30"]).error, "V8 la pasaría al 2 de marzo");
    const ok = leerArgumentos(["--antes", "2026-09-14"]);
    assert.equal(ok.error, undefined);
    assert.equal(ok.antes, "2026-09-14");
    assert.equal(ok.antesUtc, "2026-09-14T00:00:00.000Z", "solo fecha = 00:00 UTC");
    assert.equal(ok.confirm, false, "sin --confirm simula");
    assert.match(ok.copia, /^\/tmp\/coordinaciones-troceadas-\d+\.json$/);
  });

  it("--antes con hora exige zona, y a SQL va el instante en UTC", () => {
    // La hora de `date` en el VPS es de Madrid y la sesión de la base va en UTC:
    // sin zona cortaría dos horas tarde y entrarían actas del POST nuevo.
    assert.ok(leerArgumentos(["--antes", "2026-09-14T10:00"]).error);
    assert.ok(leerArgumentos(["--antes", "2026-09-14T10:00:30"]).error);
    const madrid = leerArgumentos(["--antes", "2026-09-14T10:00+02:00"]);
    assert.equal(madrid.error, undefined);
    assert.equal(madrid.antesUtc, "2026-09-14T08:00:00.000Z");
    assert.equal(leerArgumentos(["--antes", "2026-09-14T08:00Z"]).antesUtc, "2026-09-14T08:00:00.000Z");
  });

  it("--tenant valida el slug y --copia es absoluta y nunca bajo /app", () => {
    assert.ok(leerArgumentos(["--antes", "2026-09-14", "--tenant", "crm_x; drop"]).error);
    assert.equal(leerArgumentos(["--antes", "2026-09-14", "--tenant", "aumenta"]).tenant, "aumenta");
    assert.ok(leerArgumentos(["--antes", "2026-09-14", "--copia", "/app/copia.json"]).error);
    assert.ok(leerArgumentos(["--antes", "2026-09-14", "--copia", "/tmp/../app/copia.json"]).error);
    assert.ok(leerArgumentos(["--antes", "2026-09-14", "--copia", "copia.json"]).error, "relativa: acabaría en el cwd");
    assert.ok(leerArgumentos(["--antes", "2026-09-14", "--copia", "--confirm"]).error, "la copia no se llama --confirm");
    assert.ok(leerArgumentos(["--antes", "2026-09-14", "--copia"]).error, "--copia sin valor");
    assert.equal(leerArgumentos(["--antes", "2026-09-14", "--confirm", "--copia", "/tmp/c.json"]).copia, "/tmp/c.json");
  });

  it("planDeFila recompone los tres campos, no toca participantes y cuenta", () => {
    const plan = planDeFila({
      id: "3f2a1b2c-0000-0000-0000-000000000000",
      participants: ["Marga", "Paloma"],
      topics: ["Lectura\nRecreo"],
      agreements: ["Reforzar pautas en casa", "revisar en un mes\nEnviar informe"],
      nextActions: [],
    });
    assert.deepEqual(plan.nuevo.agreements, ["Reforzar pautas en casa, revisar en un mes", "Enviar informe"]);
    assert.deepEqual(plan.nuevo.topics, ["Lectura", "Recreo"]);
    assert.deepEqual(plan.antes, { topics: 1, agreements: 2, nextActions: 0 });
    assert.deepEqual(plan.despues, { topics: 2, agreements: 2, nextActions: 0 });
    assert.ok(!("participants" in plan.nuevo));
  });

  it("planDeFila salta el acta en la que nada cambia", () => {
    assert.equal(planDeFila({ id: "x", topics: ["Lectura"], agreements: [], nextActions: null }), null);
  });

  it("planDeFila salta el acta en la que algún punto ya lleva coma (del POST nuevo o ya reparada)", () => {
    // Un split(",") nunca dejó un trozo con coma. Sin esta red, un --antes mal
    // puesto la dejaría en topics ['Lectura, Recreo'] y agreements 2→1.
    const nueva = {
      id: "n",
      topics: ["Lectura", "Recreo"],
      agreements: ["Reforzar pautas en casa, revisar en un mes", "Enviar informe"],
      nextActions: [],
    };
    assert.equal(algunTrozoConComa(nueva), true);
    assert.equal(planDeFila(nueva), null);
    assert.equal(planDeFila({ id: "r", topics: [], agreements: [], nextActions: ["Llamar, y luego escribir"] }), null);
    assert.equal(algunTrozoConComa({ topics: ["Lectura"], agreements: ["a", 3], nextActions: null }), false);
  });
});

describe("lo que escribe el POST, serializado", () => {
  it("sale con un punto por línea y la coma dentro de la frase", () => {
    const fila = {
      id: "x",
      coordinationType: "school",
      coordinationDate: "2026-09-11",
      participants: asistentesDelFormulario("Marga, Paloma"),
      topics: lineasDelFormulario("Lectura\nRecreo"),
      agreements: lineasDelFormulario("Reforzar pautas en casa, revisar en un mes\n- Enviar informe"),
      nextActions: lineasDelFormulario(""),
    };
    const s = serializeCoordination(fila);
    assert.deepEqual(s.agreements, ["Reforzar pautas en casa, revisar en un mes", "Enviar informe"]);
    assert.deepEqual(s.nextActions, []);
    assert.deepEqual(s.topicsList, ["Lectura", "Recreo"]);
    assert.equal(s.participants, "Marga, Paloma");
  });

  it("red contra cambios del serializador: una importada sale igual que entra", () => {
    const fila = {
      id: "y",
      coordinationType: "family",
      coordinationDate: "2026-02-01",
      participants: [{ kind: "external", name: "Madre" }, { kind: "internal", name: "Terapeuta" }],
      topics: ["Motivo, con comas."],
      agreements: ["Acuerdos, con comas.", "Seguimiento, en un mes."],
      nextActions: [],
    };
    const s = serializeCoordination(fila);
    assert.deepEqual(s.agreements, fila.agreements);
    assert.deepEqual(s.topicsList, fila.topics);
  });
});

describe("la ruta y las pantallas siguen donde estaban", () => {
  const RUTA = "app/api/clinica/coordinations/route.js";

  it("la ruta ya no parte por comas y usa las dos funciones", () => {
    const src = leer(RUTA);
    assert.ok(!src.includes('split(",")'), "la ruta sigue con split(\",\")");
    for (const trozo of [
      "lineasDelFormulario(body.agreements)",
      "lineasDelFormulario(body.nextActions)",
      "lineasDelFormulario(body.topics)",
      "asistentesDelFormulario(body.participants)",
    ]) assert.ok(src.includes(trozo), `falta ${trozo} en la ruta`);
  });

  /*
   * Desde el 18/09/2026 (AV-0102) el acta se pinta en UN solo sitio,
   * `components/clinica/ActaCoordinacion.jsx`, y de ahí tiran el listado
   * general y la pestaña de la ficha del paciente. Antes eran dos tarjetas
   * distintas y la de la ficha se dejaba fuera los acuerdos y los próximos
   * pasos, que es de lo que se quejó Aumenta.
   */
  it("la tarjeta del acta pinta un tema por línea y respeta los saltos de acuerdos y próximos pasos", () => {
    const src = leer("components/clinica/ActaCoordinacion.jsx");
    assert.ok(src.includes('topicsList.filter(Boolean).join("\\n")'));
    assert.ok(src.includes('c.agreements.map((a, i) => <li key={i} className="whitespace-pre-line">'));
    assert.ok(src.includes('c.nextActions.map((a, i) => <li key={i} className="whitespace-pre-line">'));
  });

  it("las dos pantallas usan esa tarjeta y ninguna se pinta la suya", () => {
    for (const p of ["app/(dashboard)/clinica/coordinaciones/page.jsx", "app/(dashboard)/pacientes/[id]/page.jsx"]) {
      const src = leer(p);
      assert.ok(src.includes("<ActaCoordinacion"), `${p} ya no usa la tarjeta compartida`);
      assert.ok(!src.includes("c.agreements.map("), `${p} se ha vuelto a pintar el acta por su cuenta`);
    }
  });

  it("el modal dice «uno por línea» en los tres campos", () => {
    const src = leer("components/clinica/NuevaCoordinacionModal.jsx");
    assert.equal(src.split("uno por línea").length - 1, 3);
  });

  it("integraciones.js apunta a la línea de la ruta que guarda la familia", () => {
    const m = leer("lib/provisioning/integraciones.js").match(/app\/api\/clinica\/coordinations\/route\.js:(\d+)/);
    assert.ok(m, "integraciones.js ya no cita la ruta de coordinaciones");
    const linea = leer(RUTA).split(/\r?\n/)[Number(m[1]) - 1] ?? "";
    assert.ok(linea.includes("clientIdOfPatient"), `la línea ${m[1]} de la ruta no es la de clientIdOfPatient`);
  });
});
