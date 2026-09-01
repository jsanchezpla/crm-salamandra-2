// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clinica-preparar.mjs — preparar una sesión antes de darla (26/08/2026).
 *
 *   node scripts/_smoke-clinica-preparar.mjs
 *   node --test-name-pattern="audio" scripts/_smoke-clinica-preparar.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * Aumenta: «desde una cita no se puede preparar la sesión». Debajo había algo
 * peor que unos clics: una sesión solo nacía subiendo un audio, así que para
 * preparar una había que haberla dado ya — 22.045 sesiones y CERO con
 * preparación escrita.
 *
 * Tres cosas se pueden romper aquí sin que nadie lo note:
 *
 *   · **Que el alta parezca transcrita por la IA.** El cajón de la ficha enseña
 *     «Transcrito y estructurado por IA» en cuanto hay `aiReviewedAt`. Si el
 *     cuerpo del alta arrastrase los campos de audio, una sesión preparada a
 *     mano diría que la escribió Claude. Por eso se prueba lo que NO va.
 *   · **Que la fecha llegue mal.** Viene de la URL de una cita, o sea que la
 *     escribe cualquiera; y una sesión fechada en el año 3000 se queda en la
 *     base sin que la cace ningún listado.
 *   · **Que una sesión preparada cuente como dada.** `hastaHoy` es lo único que
 *     separa «preparé la del jueves» de «di una sesión más este mes» en las
 *     estadísticas del centro.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  colaDePreparacion,
  fechaDePreparacion,
  hastaHoy,
  paraInputLocal,
  payloadDePreparacion,
  pidePreparar,
  profesionalDePreparacion,
} from "../lib/clinica/prepararSesion.js";

const AHORA = new Date("2026-08-26T12:00:00.000Z");
// La profesional que da la cita, que no es la terapeuta de referencia del
// paciente: el caso que trajo Rodrigo el 01/09/2026.
const SILVIA = "6c1f3a12-9d84-4b77-8e21-0a5f2c7d4b90";

describe("fechaDePreparacion — llega por la URL, así que se acota", () => {
  it("una fecha buena se lee tal cual", () => {
    const d = fechaDePreparacion("2026-08-28T17:00:00.000Z", AHORA);
    assert.equal(d.toISOString(), "2026-08-28T17:00:00.000Z");
  });

  it("acepta un Date directamente", () => {
    const d = fechaDePreparacion(new Date("2026-08-28T17:00:00.000Z"), AHORA);
    assert.equal(d.toISOString(), "2026-08-28T17:00:00.000Z");
  });

  it("lo que no es una fecha es null, no «hoy» por sorpresa", () => {
    for (const malo of ["", null, undefined, "el jueves", "2026-13-45", "javascript:alert(1)"]) {
      assert.equal(fechaDePreparacion(malo, AHORA), null, `${malo}`);
    }
  });

  it("una fecha absurda también es null", () => {
    // Sin tope, `?fecha=3000-01-01` deja una sesión que no cazaría ningún
    // listado: se queda en la base y nadie la vuelve a ver.
    assert.equal(fechaDePreparacion("3000-01-01T00:00:00.000Z", AHORA), null);
    assert.equal(fechaDePreparacion("1300-01-01T00:00:00.000Z", AHORA), null);
  });

  it("el año que viene sí entra: se prepara con antelación, no con delirio", () => {
    assert.ok(fechaDePreparacion("2027-03-01T09:00:00.000Z", AHORA));
  });
});

describe("colaDePreparacion — lo que cuelga el modal de la cita", () => {
  it("lleva la fecha de la cita", () => {
    assert.equal(
      colaDePreparacion("2026-08-28T17:00:00.000Z", { ahora: AHORA }),
      "?preparar=1&fecha=2026-08-28T17%3A00%3A00.000Z"
    );
  });

  it("sin fecha válida sigue llevando a preparar", () => {
    // Un enlace que no lleva a ninguna parte es peor que uno que abre el
    // formulario con la fecha de hoy: eso se corrige de un vistazo.
    assert.equal(colaDePreparacion(null, { ahora: AHORA }), "?preparar=1");
    assert.equal(colaDePreparacion("el jueves", { ahora: AHORA }), "?preparar=1");
  });

  it("y lleva la CITA, que es lo que evita duplicar el registro", () => {
    // 01/09/2026: sin este id, volver a la misma cita abría un formulario en
    // blanco y guardarlo creaba otra sesión del mismo día.
    const q = new URLSearchParams(
      colaDePreparacion("2026-08-28T17:00:00.000Z", { bookingId: "b-1", ahora: AHORA })
    );
    assert.equal(q.get("cita"), "b-1");
  });

  it("sin cita no cuelga el parámetro vacío", () => {
    // Un `cita=` a secas obligaría a la pantalla a distinguir «no viene» de
    // «viene vacío», que es justo la clase de detalle que se olvida.
    assert.equal(new URLSearchParams(colaDePreparacion(null, { ahora: AHORA })).has("cita"), false);
    assert.equal(
      new URLSearchParams(colaDePreparacion(null, { bookingId: "   ", ahora: AHORA })).has("cita"),
      false
    );
  });

  it("y lleva el PROFESIONAL de la cita, que es quien firma el registro", () => {
    // 01/09/2026, Rodrigo: «si la cita desde la que se prepara la sesión está
    // asignada a Silvia Hernández, el registro debe estar a cargo de Silvia
    // Hernández», aunque el terapeuta de referencia del paciente sea otro.
    const q = new URLSearchParams(
      colaDePreparacion("2026-08-28T17:00:00.000Z", {
        bookingId: "b-1",
        profesionalId: SILVIA,
        ahora: AHORA,
      })
    );
    assert.equal(q.get("prof"), SILVIA);
  });

  it("una cita SIN profesional no cuelga el parámetro", () => {
    // Y así la pantalla cae en el terapeuta del paciente, que es lo correcto:
    // una cita sin asignar no sabe nada mejor que su ficha.
    for (const nadie of [null, undefined, "", "   ", "no-es-un-id"]) {
      const q = new URLSearchParams(
        colaDePreparacion("2026-08-28T17:00:00.000Z", { profesionalId: nadie, ahora: AHORA })
      );
      assert.equal(q.has("prof"), false, `${nadie}`);
    }
  });

  it("ida y vuelta: lo que cuelga la cita es lo que entiende la pantalla", () => {
    const q = new URLSearchParams(
      colaDePreparacion("2026-08-28T17:00:00.000Z", {
        bookingId: "b-1",
        profesionalId: SILVIA,
        ahora: AHORA,
      })
    );
    assert.equal(pidePreparar(q.get("preparar")), true);
    assert.equal(
      fechaDePreparacion(q.get("fecha"), AHORA).toISOString(),
      "2026-08-28T17:00:00.000Z"
    );
    assert.equal(q.get("cita"), "b-1");
    assert.equal(profesionalDePreparacion(q.get("prof")), SILVIA);
  });
});

describe("profesionalDePreparacion — la firma también llega por la barra de direcciones", () => {
  it("un id de verdad se lee tal cual", () => {
    assert.equal(profesionalDePreparacion(SILVIA), SILVIA);
    assert.equal(profesionalDePreparacion(`  ${SILVIA}  `), SILVIA);
    // Mayúsculas incluidas: un UUID es el mismo id se escriba como se escriba.
    assert.equal(profesionalDePreparacion(SILVIA.toUpperCase()), SILVIA.toUpperCase());
  });

  it("lo que no es un id es «», nunca una firma inventada", () => {
    // Aquí se decide QUIÉN firma una nota clínica: ante la duda, nadie, y la
    // pantalla cae en el terapeuta del paciente. La otra reja —que ese id sea
    // del EQUIPO del centro— la pone la pantalla contra /api/team.
    for (const malo of ["", null, undefined, "   ", "silvia", "1", "b-1", "<script>", `${SILVIA}x`]) {
      assert.equal(profesionalDePreparacion(malo), "", `${malo}`);
    }
  });
});

describe("pidePreparar", () => {
  it("abre el formulario con lo que cuelga el enlace", () => {
    for (const si of ["1", "true", "TRUE", "si", " 1 "]) assert.equal(pidePreparar(si), true, si);
  });
  it("y no con cualquier otra cosa", () => {
    for (const no of ["", null, undefined, "0", "no", "false", "audio"])
      assert.equal(pidePreparar(no), false, `${no}`);
  });
});

describe("paraInputLocal — el input de fecha habla en hora local", () => {
  it("una fecha local sale con su hora, no con la UTC", () => {
    // Construida con componentes LOCALES a propósito: así la prueba dice lo
    // mismo en Madrid que en el contenedor, que va en UTC.
    assert.equal(paraInputLocal(new Date(2026, 7, 28, 17, 0)), "2026-08-28T17:00");
  });
  it("rellena con ceros", () => {
    assert.equal(paraInputLocal(new Date(2026, 0, 5, 9, 5)), "2026-01-05T09:05");
  });
  it("una fecha ilegible da cadena vacía, no «NaN»", () => {
    assert.equal(paraInputLocal("el jueves"), "");
    assert.equal(paraInputLocal(null), "");
  });
});

describe("payloadDePreparacion — lo que se manda al alta de sesión", () => {
  const base = {
    patientId: "11111111-1111-1111-1111-111111111111",
    therapistId: "22222222-2222-2222-2222-222222222222",
    fecha: new Date("2026-08-28T17:00:00.000Z"),
    prepText: "  Traer el material de secuencias  ",
  };

  it("nace en borrador, que es lo que es: apuntada, no dada", () => {
    assert.equal(payloadDePreparacion(base).status, "draft");
  });

  it("con la fecha de la cita y la preparación limpia", () => {
    const p = payloadDePreparacion(base);
    assert.equal(p.sessionDate, "2026-08-28T17:00:00.000Z");
    assert.equal(p.prepText, "Traer el material de secuencias");
  });

  it("NO lleva ni un campo de audio ni de IA", () => {
    // Lo importante de esta función es lo que no devuelve: con `aiReviewedAt`
    // puesto, la ficha diría «Transcrito y estructurado por IA» de una sesión
    // que escribió una persona a mano.
    const p = payloadDePreparacion(base);
    for (const campo of ["aiTranscription", "aiStructured", "audioDurationSec", "aiReviewedAt"]) {
      assert.equal(campo in p, false, campo);
    }
  });

  it("sin fecha se apunta ahora, no revienta", () => {
    const p = payloadDePreparacion({ ...base, fecha: undefined });
    assert.ok(!Number.isNaN(Date.parse(p.sessionDate)));
  });

  it("sin paciente o sin terapeuta se niega, y lo dice", () => {
    assert.throws(() => payloadDePreparacion({ ...base, patientId: null }), /paciente/i);
    assert.throws(() => payloadDePreparacion({ ...base, therapistId: null }), /terapeuta/i);
    assert.throws(() => payloadDePreparacion(), /paciente/i);
  });

  it("con cita, la lleva; sin cita, ni la menciona", () => {
    // 01/09/2026: `bookingId` es lo que hace que volver a esa cita traiga ESTE
    // registro. Y una sesión escrita desde la ficha del paciente no sale de
    // ninguna cita: mandar la clave a null obligaría al endpoint a distinguir
    // «no viene» de «viene vacío».
    assert.equal(payloadDePreparacion({ ...base, bookingId: "b-1" }).bookingId, "b-1");
    assert.equal("bookingId" in payloadDePreparacion(base), false);
    assert.equal("bookingId" in payloadDePreparacion({ ...base, bookingId: "  " }), false);
  });

  it("las observaciones van completas y vacías, como en el alta con audio", () => {
    const p = payloadDePreparacion(base);
    assert.deepEqual(p.observations, {
      familyComments: "",
      nextSessionNotes: "",
      homeworkTasks: "",
      incidents: "",
    });
    assert.deepEqual(p.objectives, []);
  });
});

describe("hastaHoy — una sesión preparada no es una sesión dada", () => {
  it("corta el final del periodo por ahora", () => {
    assert.equal(
      hastaHoy(new Date("2026-08-31T23:59:59.000Z"), AHORA).toISOString(),
      AHORA.toISOString()
    );
  });

  it("un periodo ya cerrado se queda como está", () => {
    const fin = new Date("2026-07-31T23:59:59.000Z");
    assert.equal(hastaHoy(fin, AHORA).toISOString(), fin.toISOString());
  });

  it("el borde exacto no se toca", () => {
    assert.equal(hastaHoy(AHORA, AHORA).toISOString(), AHORA.toISOString());
  });

  it("un final ilegible cae en ahora, que es el lado seguro", () => {
    assert.equal(hastaHoy("el jueves", AHORA).toISOString(), AHORA.toISOString());
  });
});

describe("el 1 de enero de 1970, que es la trampa de new Date(null)", () => {
  it("`hastaHoy` con un final vacío no manda el periodo a 1970", () => {
    // `new Date(null)` es el epoch, no una fecha inválida. Si se colase, el
    // recuento de sesiones daría cero y parecería que el centro no trabajó.
    assert.equal(hastaHoy(null, AHORA).toISOString(), AHORA.toISOString());
    assert.equal(hastaHoy("", AHORA).toISOString(), AHORA.toISOString());
  });
});
