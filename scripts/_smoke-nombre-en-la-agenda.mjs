// @prueba ligera
/**
 * _smoke-nombre-en-la-agenda.mjs — en la rejilla manda el paciente
 * (08/09/2026, AV-0088 de Aumenta).
 *
 * Laura: «al generar nuevas citas nos sale en horario el nombre de la madre en
 * lugar del nombre del paciente». La agenda pintaba el titular de la ficha, que
 * en un centro clínico es quien paga.
 *
 * Lo que fija esta prueba, sobre todo, es que el arreglo NO rompa las citas que
 * no tienen paciente: un taller, una consulta de adulto o un centro sin el
 * módulo de pacientes tienen que seguir enseñando el nombre de siempre.
 *
 * Y desde el 14/09/2026, que para ponerle el nombre al paciente la agenda NO
 * pida la tabla `patients` en un centro que no la tiene (nutri_laura: seis días
 * con la agenda en blanco).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nombreDeLaCita, includeDelPaciente } from "../lib/citas/nombreEnLaAgenda.js";

test("con paciente, manda el paciente", () => {
  assert.equal(
    nombreDeLaCita({ patient: { firstName: "Mateo", lastName: "Ruiz Gil" }, clientName: "Ana Gil Roca" }),
    "Mateo Ruiz Gil",
  );
});

test("sin paciente, se queda el nombre de siempre", () => {
  // Una consulta de adulto, un taller, o un centro sin módulo de pacientes:
  // ahí `patient` ni se carga y la caja no puede quedarse en blanco.
  assert.equal(nombreDeLaCita({ patient: null, clientName: "Ana Gil Roca" }), "Ana Gil Roca");
  assert.equal(nombreDeLaCita({ clientName: "Ana Gil Roca" }), "Ana Gil Roca");
});

test("un paciente a medio rellenar no deja la caja vacía", () => {
  // Si solo hay apellidos, se pinta lo que haya; si no hay nada de nada, se
  // cae al titular en vez de dejar la cita sin rótulo.
  assert.equal(nombreDeLaCita({ patient: { lastName: "Ruiz Gil" }, clientName: "Ana" }), "Ruiz Gil");
  assert.equal(nombreDeLaCita({ patient: { firstName: "Mateo" }, clientName: "Ana" }), "Mateo");
  assert.equal(nombreDeLaCita({ patient: { firstName: "  ", lastName: "" }, clientName: "Ana Gil" }), "Ana Gil");
});

test("los espacios de más no se cuelan en la rejilla", () => {
  assert.equal(nombreDeLaCita({ patient: { firstName: "  Mateo ", lastName: " Ruiz  Gil " } }), "Mateo Ruiz Gil");
  assert.equal(nombreDeLaCita({ clientName: "  Ana Gil  " }), "Ana Gil");
});

test("sin nada que pintar devuelve cadena vacía, no «undefined»", () => {
  // Que la caja salga sin texto es feo; que ponga «undefined» es un fallo que
  // el centro ve y reporta.
  assert.equal(nombreDeLaCita({}), "");
  assert.equal(nombreDeLaCita(null), "");
  assert.equal(nombreDeLaCita(), "");
  assert.equal(nombreDeLaCita({ clientName: null }), "");
});

/*
 * ── EL PACIENTE SOLO SE PIDE DONDE HAY TABLA (14/09/2026) ──────────────────
 * nutri_laura tiene Citas y NO tiene la tabla `patients`. El calendario la
 * pedía siempre, y su agenda estuvo del 08/09 al 14/09 en blanco con un 500
 * (42P01) debajo: «no me sale ninguna de las citas que tenía para hoy».
 */
const PatientFalso = { name: "Patient" };
const centroCon = (...claves) => (k) => claves.includes(k);

test("un centro con Citas y sin Clínica ni Pacientes NO pide la tabla patients", () => {
  // nutri_laura, tal cual está en producción.
  assert.deepEqual(
    includeDelPaciente({ Patient: PatientFalso, tenantHasModule: centroCon("citas", "clients", "nutricion", "team") }),
    [],
  );
});

test("con Clínica o con Pacientes, sí se pide, y sin volver obligatoria la cita con paciente", () => {
  for (const tenantHasModule of [centroCon("citas", "clinica"), centroCon("citas", "pacientes")]) {
    const inc = includeDelPaciente({ Patient: PatientFalso, tenantHasModule });
    assert.equal(inc.length, 1);
    assert.equal(inc[0].model, PatientFalso);
    assert.equal(inc[0].as, "patient");
    // Un taller o una consulta de adulto no tienen paciente y tienen que seguir saliendo.
    assert.equal(inc[0].required, false);
  }
});

test("sin modelo o sin a quién preguntar, no se pide nada", () => {
  assert.deepEqual(includeDelPaciente({ Patient: null, tenantHasModule: centroCon("clinica") }), []);
  assert.deepEqual(includeDelPaciente({ Patient: PatientFalso }), []);
  assert.deepEqual(includeDelPaciente(), []);
});

test("el calendario pide al paciente por includeDelPaciente, preguntando al CENTRO", () => {
  const ruta = readFileSync(new URL("../app/api/citas/bookings/calendar/route.js", import.meta.url), "utf8");
  assert.ok(
    ruta.includes("includeDelPaciente({ Patient, tenantHasModule })"),
    "el calendario tiene que decidir el include del paciente con includeDelPaciente y tenantHasModule",
  );
  // Un `model: Patient` suelto en la ruta es volver al `if (Patient)` del 08/09.
  assert.equal(/model:\s*Patient\b/.test(ruta), false, "el calendario no puede montar el include del paciente a mano");
});
