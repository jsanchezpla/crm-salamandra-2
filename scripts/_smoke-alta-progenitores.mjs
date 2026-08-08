/**
 * _smoke-alta-progenitores.mjs — el alta con dos progenitores y el NIF de
 * facturación, sin servidor ni base de datos (08/08/2026).
 *
 *   node scripts/_smoke-alta-progenitores.mjs
 *
 * Las tres cosas que se prueban aquí son las tres que, si se rompen, no dan
 * error: un progenitor que desaparece en silencio, un contrato que se
 * desfirma solo, y una factura que sale sin NIF.
 */

import assert from "node:assert/strict";
import {
  normalizarProgenitores,
  normalizarPacientes,
  camposCliente,
  PERFIL_SALUD,
  PERFIL_COMERCIAL,
  partirNombre,
} from "../lib/clients/formularioAlta.js";
import { effectiveSigners, contractSituation } from "../lib/clients/clientContract.js";
import { nifDeCliente, nombreFiscalDeCliente } from "../lib/billing/nifCliente.js";

let fallos = 0;
const prueba = (nombre, fn) => {
  try { fn(); process.stdout.write(`  ✓ ${nombre}\n`); }
  catch (e) { fallos += 1; process.stdout.write(`  ✗ ${nombre}\n      ${e.message}\n`); }
};

process.stdout.write("\n  El otro progenitor\n\n");

prueba("un progenitor completo entra con signer:false", () => {
  const { progenitores, error } = normalizarProgenitores([
    { name: "Javier Pérez Ruiz", relationship: "padre", dni: "12345678Z", phone: "600111222", email: "Javier@Example.COM" },
  ]);
  assert.equal(error, undefined);
  assert.equal(progenitores.length, 1);
  assert.equal(progenitores[0].name, "Javier Pérez Ruiz");
  assert.equal(progenitores[0].relationship, "padre");
  assert.equal(progenitores[0].email, "javier@example.com", "el correo se normaliza a minúsculas");
  assert.equal(progenitores[0].signer, false, "NADIE nace firmante desde el mostrador");
});

prueba("una fila en blanco se descarta sin decir nada", () => {
  const { progenitores, error } = normalizarProgenitores([{ name: "", dni: "", phone: "", email: "", relationship: "padre" }]);
  assert.equal(error, undefined);
  assert.equal(progenitores.length, 0);
});

prueba("un progenitor SIN nombre pero CON datos avisa, no desaparece", () => {
  // Es la diferencia con `normalizeGuardians`, que lo filtraría en silencio:
  // recepción vería «cliente creado» y el padre no estaría en ninguna parte.
  const { progenitores, error } = normalizarProgenitores([{ name: "  ", dni: "12345678Z", phone: "600111222" }]);
  assert.equal(progenitores, undefined);
  assert.match(error, /le falta el nombre/i);
});

prueba("dos progenitores con el mismo correo se rechazan", () => {
  const { error } = normalizarProgenitores([
    { name: "Ana Ruiz", email: "familia@example.com" },
    { name: "Javier Pérez", email: "FAMILIA@example.com" },
  ]);
  assert.match(error, /mismo correo/i);
});

prueba("un correo con errata se rechaza antes de llegar a la base", () => {
  const { error } = normalizarProgenitores([{ name: "Ana Ruiz", email: "ana@sinpunto" }]);
  assert.match(error, /formato válido/i);
});

process.stdout.write("\n  Lo que NO puede cambiar: quién firma el contrato\n\n");

prueba("con progenitores signer:false sigue firmando el titular", () => {
  // Esta es LA prueba del bloque. Si algún día alguien pone `signer: true` por
  // defecto en el alta, `effectiveSigners` deja de devolver al titular y pasa a
  // exigir la firma de todos los tutores: los contratos ya firmados de las
  // familias que tienen el área privada encendida se quedarían sin firmar, y
  // con ellos su documentación cerrada.
  const { progenitores } = normalizarProgenitores([
    { name: "Javier Pérez Ruiz", relationship: "padre", dni: "12345678Z" },
  ]);
  const cliente = { id: "cli-1", name: "Ana Ruiz Gómez", guardians: progenitores.map((g, i) => ({ ...g, id: `g-${i}` })) };

  const firmantes = effectiveSigners(cliente);
  assert.equal(firmantes.length, 1, "un solo firmante");
  assert.equal(firmantes[0].id, "cli-1", "y es el TITULAR, no el progenitor");
  assert.equal(firmantes[0].titular, true);

  // Y una firma hecha antes por el titular sigue valiendo.
  const situacion = contractSituation({ cliente, client: cliente, signatures: [{ guardianId: "cli-1" }] });
  assert.equal(situacion.contratoCompleto, true, "el contrato ya firmado NO se desfirma");
  assert.equal(situacion.pendientes.length, 0);
});

process.stdout.write("\n  El NIF que sale impreso\n\n");

prueba("manda el de facturación cuando lo hay", () => {
  assert.equal(nifDeCliente({ taxId: "11111111H", fiscalTaxId: "B12345678" }), "B12345678");
  assert.equal(nombreFiscalDeCliente({ name: "Ana Ruiz", fiscalName: "Empresa S.L." }), "Empresa S.L.");
});

prueba("cae al DNI de la ficha si no hay uno de facturación", () => {
  // Sin este respaldo, las empresas de spain_enzymes y demo —cuyo `taxId` YA es
  // su CIF— empezarían a facturar sin NIF el día del despliegue.
  assert.equal(nifDeCliente({ taxId: "B98765432" }), "B98765432");
  assert.equal(nifDeCliente({ taxId: "B98765432", fiscalTaxId: "   " }), "B98765432");
  assert.equal(nombreFiscalDeCliente({ name: "Ana Ruiz" }), "Ana Ruiz");
});

prueba("sin ningún documento devuelve null, no una cadena vacía", () => {
  assert.equal(nifDeCliente({}), null);
  assert.equal(nifDeCliente(null), null);
});

process.stdout.write("\n  Qué se pregunta en el mostrador\n\n");

prueba("un centro con pacientes pregunta el parentesco y el motivo", () => {
  const claves = camposCliente(PERFIL_SALUD, { conPacientes: true }).map((c) => c.key);
  assert.ok(claves.includes("parentescoTitular"));
  assert.ok(claves.includes("motivo"));
  assert.ok(claves.includes("taxId"));
  assert.ok(claves.includes("birthDate"));
  assert.ok(claves.includes("domicilio"));
});

prueba("una consulta donde el paciente ES el cliente no pregunta el parentesco", () => {
  const claves = camposCliente(PERFIL_SALUD, { conPacientes: false }).map((c) => c.key);
  assert.equal(claves.includes("parentescoTitular"), false, "no hay dos personas que relacionar");
  assert.ok(claves.includes("motivo"), "pero el motivo sí, que es de quien llama");
});

prueba("un cliente comercial no ve nada de esto", () => {
  const claves = camposCliente(PERFIL_COMERCIAL).map((c) => c.key);
  assert.equal(claves.includes("parentescoTitular"), false);
  assert.equal(claves.includes("motivo"), false);
  assert.ok(claves.includes("company"));
});

prueba("el motivo de cada paciente llega hasta el objeto que se guarda", () => {
  // Sin `referralReason` en la lista blanca de `normalizarPacientes`, se
  // teclea, se manda y no se guarda: el endpoint crea el paciente con
  // EXACTAMENTE lo que devuelve esa función.
  const { pacientes } = normalizarPacientes([
    { firstName: "Lucía", lastName: "Ruiz Pérez", referralReason: "Dificultades de atención." },
  ]);
  assert.equal(pacientes[0].referralReason, "Dificultades de atención.");
});

prueba("partirNombre dice lo mismo en la pantalla y en el servidor", () => {
  assert.deepEqual(partirNombre("Lucía Ruiz Pérez"), { firstName: "Lucía", lastName: "Ruiz Pérez" });
  assert.deepEqual(partirNombre("  Mateo  "), { firstName: "Mateo", lastName: "" });
  assert.deepEqual(partirNombre(""), { firstName: "", lastName: "" });
});

process.stdout.write(fallos === 0 ? "\n  Todo en verde.\n\n" : `\n  ${fallos} fallo(s).\n\n`);
process.exit(fallos === 0 ? 0 : 1);
