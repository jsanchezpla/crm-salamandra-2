// @prueba ligera
/**
 * _smoke-taller-sesion.mjs — el registro de una sesión de TALLER (01/09/2026,
 * Aumenta por Rodrigo).
 *
 * «El registro general el mismo a todos menos el apartado extra privado para
 * cada paciente.» Esa frase son dos promesas opuestas, y las dos se fijan aquí:
 *
 *   1. lo COMÚN llega igual a todos, y llega a las columnas de siempre de
 *      `clinic_sessions` — que es de donde comen el informe, el anexo y las
 *      estadísticas. Si se quedara solo en el JSONB, un paciente que va a HHSS
 *      todo el curso tendría el taller en la pantalla y no en su informe.
 *   2. lo INDIVIDUAL no cruza. La nota de un niño no puede acabar en el
 *      registro de otro por ningún camino: ni por la lista de apartados, ni por
 *      el cuerpo común, ni por una plantilla mal escrita. Es la única regla de
 *      este sprint que, si se rompe, se rompe hacia una familia.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAVE_NOTA_INDIVIDUAL,
  ETIQUETA_NOTA_POR_DEFECTO,
  apartadoDeNota,
  apartadosComunes,
  esSesionDeTaller,
  etiquetaNotaDe,
  notaIndividualDe,
  registroDelPaciente,
  valoresComunes,
} from "../lib/clinica/tallerSesion.js";

/** Una sesión de taller como la que guarda el endpoint. */
function sesionDeTaller(extra = {}) {
  return {
    id: "s-taller-1",
    tallerId: "t-hhss",
    teamMemberId: "tm-marta",
    sessionDate: new Date("2026-09-01T17:00:00.000Z"),
    duration: 90,
    status: "registered",
    internalNotes: "La madre de X no trae el material. Hablarlo en equipo.",
    contentSections: {
      apartados: [
        { key: "objectives", label: "Objetivos trabajados", tipo: "lista" },
        { key: "activities", label: "Actividades realizadas", tipo: "texto" },
        { key: "clima_grupo", label: "Clima del grupo", tipo: "texto" },
      ],
      objectives: ["Pedir turno", "Escucha activa"],
      activities: "Juego de rol en parejas.",
      clima_grupo: "Grupo cohesionado; dos se distraen al final.",
    },
    ...extra,
  };
}

// ── 1. Lo común llega, y llega a donde tiene que llegar ─────────────────────

test("el cuerpo común va a las columnas de siempre, no a un JSONB aparte", () => {
  const r = registroDelPaciente({ sesionTaller: sesionDeTaller(), nota: "Participó mucho." });

  // De estas columnas comen el informe, el anexo y las estadísticas.
  assert.deepEqual(r.objectives, ["Pedir turno", "Escucha activa"]);
  assert.equal(r.activities, "Juego de rol en parejas.");
  // Y el apartado que NO es de fábrica, al JSONB.
  assert.equal(r.contentSections.clima_grupo, "Grupo cohesionado; dos se distraen al final.");
});

test("el registro queda enganchado a su sesión de taller, con su fecha y su firma", () => {
  const r = registroDelPaciente({ sesionTaller: sesionDeTaller() });
  assert.equal(r.tallerSesionId, "s-taller-1");
  assert.equal(r.therapistId, "tm-marta");
  assert.equal(r.duration, 90);
  assert.equal(new Date(r.sessionDate).toISOString(), "2026-09-01T17:00:00.000Z");
  assert.ok(esSesionDeTaller(r));
  assert.equal(esSesionDeTaller({ tallerSesionId: null }), false);
});

test("cerrar la sesión del taller la cierra en la ficha de cada paciente", () => {
  assert.equal(registroDelPaciente({ sesionTaller: sesionDeTaller() }).status, "registered");
  assert.equal(
    registroDelPaciente({ sesionTaller: sesionDeTaller({ status: "published" }) }).status,
    "published"
  );
});

test("dos pacientes reciben EXACTAMENTE el mismo cuerpo común", () => {
  const a = registroDelPaciente({ sesionTaller: sesionDeTaller(), nota: "Participó mucho." });
  const b = registroDelPaciente({ sesionTaller: sesionDeTaller(), nota: "Se levantó dos veces." });

  assert.deepEqual(a.objectives, b.objectives);
  assert.equal(a.activities, b.activities);
  assert.equal(a.contentSections.clima_grupo, b.contentSections.clima_grupo);
});

// ── 2. Lo individual no cruza ───────────────────────────────────────────────

test("la nota de uno NO aparece en el registro del otro", () => {
  const a = registroDelPaciente({ sesionTaller: sesionDeTaller(), nota: "Participó mucho." });
  const b = registroDelPaciente({ sesionTaller: sesionDeTaller(), nota: "Se levantó dos veces." });

  assert.equal(a.contentSections[CLAVE_NOTA_INDIVIDUAL], "Participó mucho.");
  assert.equal(b.contentSections[CLAVE_NOTA_INDIVIDUAL], "Se levantó dos veces.");

  // Y no se ha colado por ningún otro campo del registro del otro.
  const todoB = JSON.stringify(b);
  assert.equal(todoB.includes("Participó mucho"), false, "la nota de A no puede estar en el registro de B");
});

test("si la clave de la nota se cuela en los apartados COMUNES, se echa", () => {
  // Alguien la mete en la plantilla del centro, o llega en un cuerpo trucado.
  const sucia = sesionDeTaller({
    contentSections: {
      apartados: [
        { key: "activities", label: "Actividades realizadas", tipo: "texto" },
        { key: CLAVE_NOTA_INDIVIDUAL, label: "Nota individual", tipo: "texto" },
      ],
      activities: "Juego de rol.",
      [CLAVE_NOTA_INDIVIDUAL]: "ESTO ES DEL GRUPO Y NO DEBERÍA ESTAR AQUÍ",
    },
  });

  const r = registroDelPaciente({ sesionTaller: sucia, nota: "La mía." });
  assert.equal(r.contentSections[CLAVE_NOTA_INDIVIDUAL], "La mía.");
  const todo = JSON.stringify(r);
  assert.equal(todo.includes("NO DEBERÍA ESTAR AQUÍ"), false);
});

test("apartadosComunes y valoresComunes son los dos cerrojos, por separado", () => {
  const lista = apartadosComunes([
    { key: "activities", label: "Actividades", tipo: "texto" },
    { key: CLAVE_NOTA_INDIVIDUAL, label: "Nota individual", tipo: "texto" },
  ]);
  assert.deepEqual(lista.map((a) => a.key), ["activities"]);

  const bolsa = valoresComunes({
    apartados: [{ key: "activities", label: "Actividades", tipo: "texto" }],
    plantilla: "base",
    activities: "Juego de rol.",
    [CLAVE_NOTA_INDIVIDUAL]: "no",
  });
  assert.deepEqual(Object.keys(bolsa), ["activities"]);
});

test("las notas internas del GRUPO no bajan al registro de nadie", () => {
  const r = registroDelPaciente({ sesionTaller: sesionDeTaller(), nota: "La mía." });
  const todo = JSON.stringify(r);
  assert.equal(todo.includes("no trae el material"), false);
  // Y no se inventa un `internalNotes` en la sesión del paciente.
  assert.equal(r.internalNotes, undefined);
});

// ── 3. El apartado privado se comporta como un apartado más ─────────────────

test("la nota va en la foto de apartados, la última y con su título", () => {
  const r = registroDelPaciente({
    sesionTaller: sesionDeTaller(),
    nota: "Participó mucho.",
    etiquetaNota: "Cómo fue para él",
  });
  const foto = r.contentSections.apartados;
  assert.equal(foto.at(-1).key, CLAVE_NOTA_INDIVIDUAL);
  assert.equal(foto.at(-1).label, "Cómo fue para él");
  // Y sale también en el camino de vuelta, que es lo que reabre el formulario.
  assert.equal(etiquetaNotaDe(r.contentSections), "Cómo fue para él");
  assert.equal(notaIndividualDe(r.contentSections), "Participó mucho.");
});

test("sin título puesto, la nota se llama como de fábrica", () => {
  assert.equal(apartadoDeNota("").label, ETIQUETA_NOTA_POR_DEFECTO);
  assert.equal(apartadoDeNota("   ").label, ETIQUETA_NOTA_POR_DEFECTO);
  assert.equal(apartadoDeNota(null).label, ETIQUETA_NOTA_POR_DEFECTO);
  assert.equal(apartadoDeNota("Cómo fue").label, "Cómo fue");
});

test("un paciente sin nota escrita se guarda igual, con su apartado vacío", () => {
  const r = registroDelPaciente({ sesionTaller: sesionDeTaller() });
  assert.equal(r.contentSections[CLAVE_NOTA_INDIVIDUAL], "");
  assert.equal(notaIndividualDe(r.contentSections), "");
});

test("lo que llega roto no tumba el reparto", () => {
  assert.equal(notaIndividualDe(null), "");
  assert.equal(notaIndividualDe("texto"), "");
  assert.equal(etiquetaNotaDe(undefined), "");
  assert.deepEqual(apartadosComunes(null), []);
  const r = registroDelPaciente({ sesionTaller: { id: "x" } });
  assert.equal(r.tallerSesionId, "x");
  assert.ok(r.sessionDate instanceof Date);
});
