// @prueba ligera
/**
 * _smoke-mailing-audiencia-csv.mjs — la parte PURA de la audiencia del
 * mailing (`lib/mailing/audiencia.js`), el lector de CSV
 * (`lib/mailing/csv.js`) y la clasificación de avisos de SES
 * (`lib/mailing/avisosSes.js`), 06/09/2026.
 *
 * Fija lo que DEVUELVEN: las reglas de un segmento se normalizan a la lista
 * blanca (nada desconocido se guarda), la casilla de novedades manda (un
 * booleano legado y un `granted:false` explícito se leen bien), la regla de
 * última cita hace lo que dice, el CSV entiende Excel/Sheets/Mailchimp y un
 * rebote transitorio NO va a supresión.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const aud = await import(pathToFileURL(resolve("lib/mailing/audiencia.js")).href);
const csv = await import(pathToFileURL(resolve("lib/mailing/csv.js")).href);
const avisos = await import(pathToFileURL(resolve("lib/mailing/avisosSes.js")).href);

test("normalizarReglas: lista blanca, topes y valores por defecto", () => {
  assert.deepEqual(aud.normalizarReglas(null), { fuentes: ["clientes", "contactos"], modulos: [], estados: [], ultimaCita: null });
  const r = aud.normalizarReglas({
    fuentes: ["clientes", "marcianos"],
    modulos: ["nutricion", "nutricion", "DROP TABLE", "clinica"],
    estados: ["active", "raro", "inactive"],
    ultimaCita: { tipo: "hace_menos", dias: "180.4" },
  });
  assert.deepEqual(r, { fuentes: ["clientes"], modulos: ["nutricion", "clinica"], estados: ["active", "inactive"], ultimaCita: { tipo: "hace_menos", dias: 180 } });
  assert.deepEqual(aud.normalizarReglas({ ultimaCita: { tipo: "nunca", dias: 99 } }).ultimaCita, { tipo: "nunca" });
  assert.equal(aud.normalizarReglas({ ultimaCita: { tipo: "ayer" } }).ultimaCita, null);
  assert.equal(aud.normalizarReglas({ ultimaCita: { tipo: "hace_mas", dias: 0 } }).ultimaCita.dias, 1);
  assert.equal(aud.normalizarReglas({ ultimaCita: { tipo: "hace_mas", dias: 99999 } }).ultimaCita.dias, 3650);
});

test("clienteAceptaNovedades: la casilla manda y hace falta correo", () => {
  const con = (prefs, email = "a@b.com") => ({ email, communicationPrefs: prefs });
  assert.equal(aud.clienteAceptaNovedades(con({ novedades: { granted: true, by: "portal" } })), true);
  assert.equal(aud.clienteAceptaNovedades(con({ novedades: true })), true); // booleano legado
  assert.equal(aud.clienteAceptaNovedades(con({ novedades: { granted: false, by: "portal" } })), false);
  assert.equal(aud.clienteAceptaNovedades(con({})), false); // por defecto NO (POR_DEFECTO.novedades)
  assert.equal(aud.clienteAceptaNovedades(con(null)), false);
  assert.equal(aud.clienteAceptaNovedades(con({ novedades: true }, "")), false);
  assert.equal(aud.clienteAceptaNovedades(con({ novedades: true }, "sin-arroba")), false);
  // Que aceptara los avisos de cita no significa que acepte publicidad.
  assert.equal(aud.clienteAceptaNovedades(con({ citasEmail: { granted: true, by: "portal" } })), false);
});

test("cumpleUltimaCita: hace menos, hace más y nunca", () => {
  const ahora = new Date("2026-09-06T10:00:00Z");
  const hace = (d) => new Date(ahora.getTime() - d * 86400000);
  assert.equal(aud.cumpleUltimaCita(null, null, ahora), true);
  assert.equal(aud.cumpleUltimaCita({ tipo: "hace_menos", dias: 180 }, hace(30), ahora), true);
  assert.equal(aud.cumpleUltimaCita({ tipo: "hace_menos", dias: 180 }, hace(200), ahora), false);
  assert.equal(aud.cumpleUltimaCita({ tipo: "hace_menos", dias: 180 }, null, ahora), false);
  assert.equal(aud.cumpleUltimaCita({ tipo: "hace_mas", dias: 180 }, hace(200), ahora), true);
  assert.equal(aud.cumpleUltimaCita({ tipo: "hace_mas", dias: 180 }, hace(30), ahora), false);
  assert.equal(aud.cumpleUltimaCita({ tipo: "hace_mas", dias: 180 }, null, ahora), false); // sin cita no es «hace más»
  assert.equal(aud.cumpleUltimaCita({ tipo: "nunca" }, null, ahora), true);
  assert.equal(aud.cumpleUltimaCita({ tipo: "nunca" }, hace(1), ahora), false);
});

test("csv: separador detectado, cabecera opcional, comillas y duplicados", () => {
  const r = csv.leerCsvDeContactos('Nombre;Email\r\n"García, Ana";ANA@Centro.com\r\nPepe;pepe@x.com\r\n;ana@centro.com\r\nsin correo;nada\r\n');
  assert.equal(r.cabecera, true);
  assert.deepEqual(r.filas, [
    { email: "ana@centro.com", nombre: "García, Ana" },
    { email: "pepe@x.com", nombre: "Pepe" },
  ]);
  assert.equal(r.duplicados, 1);
  assert.deepEqual(r.invalidos, ["sin correo;nada"]);
});

test("csv: coma, sin cabecera, correo en cualquier columna y BOM", () => {
  const r = csv.leerCsvDeContactos("﻿a@b.com,Ana\nLuis,luis@b.com,600\n");
  assert.equal(r.cabecera, false);
  assert.deepEqual(r.filas, [
    { email: "a@b.com", nombre: "Ana" },
    { email: "luis@b.com", nombre: "Luis" },
  ]);
  assert.deepEqual(csv.leerCsvDeContactos("").filas, []);
  assert.deepEqual(csv.trocearLinea('a,"b,c","d""e"', ","), ["a", "b,c", 'd"e']);
});

test("avisos de SES: rebote duro y queja suprimen, transitorio no", () => {
  const duro = avisos.clasificarAviso({
    notificationType: "Bounce",
    bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: "Nadie@X.com", diagnosticCode: "550 no such user" }] },
  });
  assert.equal(duro.tipo, "bounce");
  assert.equal(duro.permanente, true);
  assert.deepEqual(duro.destinatarios, ["nadie@x.com"]);
  assert.match(duro.detalle, /Permanent · General · 550/);

  const blando = avisos.clasificarAviso({ eventType: "Bounce", bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "lleno@x.com" }] } });
  assert.equal(blando.permanente, false);

  const queja = avisos.clasificarAviso({ eventType: "Complaint", complaint: { complainedRecipients: [{ emailAddress: "harto@x.com" }], complaintFeedbackType: "abuse" } });
  assert.equal(queja.tipo, "complaint");
  assert.deepEqual(queja.destinatarios, ["harto@x.com"]);

  assert.equal(avisos.clasificarAviso({ eventType: "Delivery" }).tipo, "delivery");
  assert.equal(avisos.clasificarAviso({}).tipo, "desconocido");
});

test("procesarAvisoSes: solo lo permanente y las quejas llegan a la supresión", async () => {
  const llamadas = { supresiones: [], updates: [] };
  const ctx = {
    slug: "demo",
    tenantHasModule: () => false,
    tenantModels: {
      MailingSend: {
        findOne: async () => ({ id: "s1", campaignId: "c1" }),
        update: async (v, o) => llamadas.updates.push([v.estado, o.where]),
      },
      MailingSuppression: { findOrCreate: async ({ where, defaults }) => (llamadas.supresiones.push([where.email, defaults.motivo]), [{ id: "x" }, true]) },
      MailingContact: { update: async () => 1 },
      Client: null,
    },
  };
  const r1 = await avisos.procesarAvisoSes(ctx, {
    notificationType: "Bounce",
    mail: { messageId: "m1" },
    bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "lleno@x.com" }] },
  });
  assert.equal(r1.suprimidos, 0);
  assert.deepEqual(llamadas.supresiones, []);
  assert.deepEqual(llamadas.updates.at(-1), ["rebotado", { id: "s1" }]);

  await avisos.procesarAvisoSes(ctx, {
    notificationType: "Complaint",
    mail: { messageId: "m1" },
    complaint: { complainedRecipients: [{ emailAddress: "harto@x.com" }] },
  });
  assert.deepEqual(llamadas.supresiones, [["harto@x.com", "queja"]]);
  assert.deepEqual(llamadas.updates.at(-1), ["queja", { id: "s1" }]);
});
