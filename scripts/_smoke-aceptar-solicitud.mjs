/**
 * _smoke-aceptar-solicitud.mjs — comprueba, sin servidor ni base de datos, lo
 * que decide el aceptar de una solicitud (08/08/2026).
 *
 *   node scripts/_smoke-aceptar-solicitud.mjs
 *
 * Se prueban las funciones PURAS —las que deciden qué ficha y qué paciente
 * salen de unas respuestas— porque son donde está el criterio. Lo que toca la
 * base de datos (materializar contactos, la transacción) no se puede probar
 * aquí y va aparte.
 *
 * El caso que más importa es el último: las 20 solicitudes que Aumenta tiene
 * pendientes vienen del formulario ANTIGUO y no traen ni parentesco, ni nombre
 * del peque, ni edad. Tienen que aceptarse sin crear un paciente fantasma y
 * diciéndolo.
 */

import assert from "node:assert/strict";
import { clienteDesdeSolicitud, pacienteDesdeSolicitud, frasesDelParte } from "../lib/formularios/accept.js";
import { RELACION_ES_EL_PACIENTE } from "../lib/formularios/fields.js";

const FORM_NUEVO = {
  fields: [
    { key: "nombre", label: "¿Cómo te llamas?", type: "text", mapTo: "name" },
    { key: "parentesco", label: "¿Quién eres?", type: "select", mapTo: "relationship" },
    { key: "nombrePeque", label: "¿Cómo se llama el peque?", type: "text", mapTo: "patientName" },
    { key: "edadPeque", label: "¿Cuántos años tiene?", type: "number", mapTo: "patientAge" },
    { key: "motivo", label: "¿Qué os preocupa?", type: "textarea", mapTo: "reason" },
    { key: "telefono", label: "Teléfono", type: "tel", mapTo: "phone" },
    { key: "email", label: "Correo electrónico", type: "email", mapTo: "email" },
    { key: "consentimiento", label: "Acepto", type: "consent", mapTo: null },
  ],
};

// El formulario VIEJO: las mismas preguntas de contacto y nada del peque.
const FORM_VIEJO = {
  fields: [
    { key: "nombre", label: "Nombre", type: "text", mapTo: "name" },
    { key: "mensaje", label: "Lo que nos contó", type: "textarea", mapTo: null },
  ],
};

const sol = (answers, extra = {}) => ({
  formTitle: "Cuéntanos qué necesitáis",
  name: null, email: null, phone: null,
  answers, ...extra,
});

const r = (key, label, value, type = "text") => ({ key, label, type, value });

let fallos = 0;
const prueba = (nombre, fn) => {
  try { fn(); process.stdout.write(`  ✓ ${nombre}\n`); }
  catch (e) { fallos += 1; process.stdout.write(`  ✗ ${nombre}\n      ${e.message}\n`); }
};

process.stdout.write("\n  Aceptar una solicitud — decisiones\n\n");

prueba("una familia completa produce ficha, parentesco del titular y paciente", () => {
  const s = sol([
    r("nombre", "¿Cómo te llamas?", "Marta Ruiz Gómez"),
    r("parentesco", "¿Quién eres?", "Madre", "select"),
    r("nombrePeque", "¿Cómo se llama el peque?", "Lucía Ruiz Pérez"),
    r("edadPeque", "¿Cuántos años tiene?", "6", "number"),
    r("motivo", "¿Qué os preocupa?", "Le cuesta concentrarse en clase.", "textarea"),
    r("telefono", "Teléfono", "600111222", "tel"),
    r("email", "Correo electrónico", "marta@example.com", "email"),
  ]);
  const cliente = clienteDesdeSolicitud(FORM_NUEVO, s);
  assert.equal(cliente.name, "Marta Ruiz Gómez");
  assert.equal(cliente.email, "marta@example.com");
  assert.equal(cliente.customFields.motivo, "Le cuesta concentrarse en clase.");
  assert.equal(cliente.customFields.parentescoTitular, "madre");
  // La procedencia va en `origin`, con i, que es lo que pinta la ficha.
  assert.match(cliente.customFields.origin, /^Formulario web/);
  assert.equal(cliente.customFields.origen, undefined);
  // Y NO se crea ningún tutor: la madre ES la titular de la ficha.
  assert.equal(cliente.guardians, undefined);

  const { paciente, motivo } = pacienteDesdeSolicitud(FORM_NUEVO, s);
  assert.equal(motivo, undefined);
  assert.equal(paciente.firstName, "Lucía");
  assert.equal(paciente.lastName, "Ruiz Pérez");
  assert.equal(paciente.age, 6);
  assert.equal(paciente.referralReason, "Le cuesta concentrarse en clase.");
});

prueba("«soy yo quien necesita ayuda» no crea paciente ni parentesco", () => {
  const s = sol([
    r("nombre", "¿Cómo te llamas?", "Ana Soler"),
    r("parentesco", "¿Quién eres?", RELACION_ES_EL_PACIENTE, "select"),
    r("nombrePeque", "¿Cómo se llama el peque?", ""),
  ]);
  assert.equal(clienteDesdeSolicitud(FORM_NUEVO, s).customFields.parentescoTitular, undefined);
  assert.equal(pacienteDesdeSolicitud(FORM_NUEVO, s).motivo, "es_el_titular");
});

prueba("el nombre del peque en blanco NO crea un paciente sin nombre", () => {
  // `validarRespuestas` guarda la clave con value:"" aunque el campo sea
  // opcional, y `allowNull:false` no rechaza la cadena vacía: sin este corte
  // entrarían pacientes fantasma sin que nadie viera un error.
  const s = sol([
    r("nombre", "¿Cómo te llamas?", "Pedro Gil"),
    r("parentesco", "¿Quién eres?", "Padre", "select"),
    r("nombrePeque", "¿Cómo se llama el peque?", ""),
    r("edadPeque", "¿Cuántos años tiene?", "", "number"),
  ]);
  assert.equal(pacienteDesdeSolicitud(FORM_NUEVO, s).motivo, "sin_nombre");
  // Pero el parentesco del titular SÍ se guarda: es padre de alguien.
  assert.equal(clienteDesdeSolicitud(FORM_NUEVO, s).customFields.parentescoTitular, "padre");
});

prueba("un peque sin apellidos no se crea a medias ni hereda los de la familia", () => {
  const s = sol([
    r("nombre", "¿Cómo te llamas?", "Pedro Gil Navarro"),
    r("parentesco", "¿Quién eres?", "Padre", "select"),
    r("nombrePeque", "¿Cómo se llama el peque?", "Mateo"),
  ]);
  assert.equal(pacienteDesdeSolicitud(FORM_NUEVO, s).motivo, "nombre_incompleto");
});

prueba("una edad imposible se descarta en vez de reventar el INSERT", () => {
  const s = sol([
    r("nombre", "Nombre", "Eva Lima"),
    r("parentesco", "¿Quién eres?", "Tutor o tutora legal", "select"),
    r("nombrePeque", "Peque", "Iker Lima Sanz"),
    r("edadPeque", "Edad", "999", "number"),
  ]);
  const { paciente } = pacienteDesdeSolicitud(FORM_NUEVO, s);
  assert.equal(paciente.age, null);
  assert.equal(clienteDesdeSolicitud(FORM_NUEVO, s).customFields.parentescoTitular, "tutor");
});

prueba("las 20 solicitudes del formulario VIEJO se aceptan sin inventarse nada", () => {
  const s = sol(
    [r("nombre", "Nombre", "Carmen Ortiz"), r("mensaje", "Lo que nos contó", "Quiero información sobre logopedia.", "textarea")],
    { email: "carmen@example.com", phone: "600999888" }
  );
  const cliente = clienteDesdeSolicitud(FORM_VIEJO, s);
  assert.equal(cliente.name, "Carmen Ortiz");
  // El contacto sale de la solicitud aunque el formulario no lo declarara.
  assert.equal(cliente.email, "carmen@example.com");
  assert.equal(cliente.phone, "600999888");
  // Nada de parentesco inventado.
  assert.equal(cliente.customFields.parentescoTitular, undefined);
  // Y lo que escribió no se pierde: cae en «lo que nos contó».
  assert.match(cliente.customFields.info_adicional, /logopedia/);
  assert.equal(pacienteDesdeSolicitud(FORM_VIEJO, s).motivo, "sin_datos");
});

process.stdout.write("\n  El parte que se le enseña a quien acepta\n\n");

prueba("dice lo que se ha guardado y lo que hay que hacer a mano", () => {
  const frases = frasesDelParte({
    contactos: { email: true, phone: true },
    paciente: { creado: false, motivo: "sin_nombre" },
  });
  assert.equal(frases.length, 2);
  assert.match(frases[0], /el correo y el teléfono/);
  assert.match(frases[1], /a mano/);
});

prueba("un cliente sin módulo de pacientes no recibe avisos que no le tocan", () => {
  const frases = frasesDelParte({
    contactos: { email: true, phone: false },
    paciente: { creado: false, motivo: "sin_modulo" },
  });
  assert.equal(frases.length, 1);
  assert.match(frases[0], /el correo/);
  assert.doesNotMatch(frases[0], /teléfono/);
});

prueba("con ficha existente avisa de que no se ha creado paciente nuevo", () => {
  const frases = frasesDelParte({
    contactos: { email: false, phone: false, motivo: "ficha_existente" },
    paciente: { creado: false, motivo: "ficha_existente" },
  });
  assert.equal(frases.length, 1);
  assert.match(frases[0], /ya existía/);
});

process.stdout.write(fallos === 0 ? "\n  Todo en verde.\n\n" : `\n  ${fallos} fallo(s).\n\n`);
process.exit(fallos === 0 ? 0 : 1);
