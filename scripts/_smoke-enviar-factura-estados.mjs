// @prueba ligera
/**
 * Enviar una factura por correo: qué estados lo permiten (06/09/2026).
 *
 * Las facturas del lote de cuotas nacen COBRADAS (`paid`) y son justo las que
 * la contable quiere mandar cada mes; la ruta solo aceptaba `issued` y el botón
 * de la ficha también, así que no se podía mandar ninguna. Aquí se fija que la
 * ruta y la pantalla admiten los mismos estados, que el borrador y lo anulado
 * siguen fuera, y que mandar una cobrada no le cambia el estado.
 *
 * Se lee el código como texto: es un «¿sigue el if donde estaba?».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const lee = (r) => readFileSync(join(RAIZ, r), "utf8");
const RUTA = "app/api/billing/invoices/[id]/send/route.js";
const PANTALLA = "app/(dashboard)/facturacion/facturas/page.jsx";

test("la ruta de envío acepta emitida, enviada, cobrada, a medias y vencida, y nada más", () => {
  const src = lee(RUTA);
  const m = src.match(/export const ESTADOS_ENVIABLES = \[([^\]]+)\]/);
  assert.ok(m, "falta ESTADOS_ENVIABLES en la ruta");
  const estados = m[1].match(/"[a-z_]+"/g).map((s) => s.replaceAll('"', "")).sort();
  assert.deepEqual(estados, ["issued", "overdue", "paid", "partially_paid", "sent"]);
  assert.match(src, /!ESTADOS_ENVIABLES\.includes\(invoice\.status\) \|\| invoice\.rectifiedByInvoiceId \|\| invoice\.rectifiesInvoiceId/, "una anulada o una rectificativa no se manda");
  assert.ok(!/invoice\.status !== "issued"/.test(src), "el candado viejo (solo issued) no puede seguir ahí");
});

test("mandar una factura cobrada no le cambia el estado: solo `issued` pasa a `sent`", () => {
  const src = lee(RUTA);
  assert.match(src, /const updates = estadoAntes === "issued" \? \{ status: "sent" \} : \{\};/);
  assert.match(src, /before: \{ status: estadoAntes \}/, "la auditoría guarda el estado real de antes");
});

test("el botón Enviar de la ficha enseña los mismos estados que la ruta", () => {
  const src = lee(PANTALLA);
  const boton = src.indexOf('onAction("send")');
  assert.ok(boton > 0, "no encuentro el botón de enviar");
  const condicion = src.slice(Math.max(0, boton - 400), boton);
  assert.match(condicion, /\["issued", "sent", "paid", "partially_paid", "overdue"\]\.includes\(invoice\.status\) && !invoice\.rectifiedByInvoiceId && !invoice\.rectifiesInvoiceId/);
  assert.ok(!/invoice\.status === "issued" && \($/m.test(condicion), "el candado viejo del botón no puede seguir ahí");
});

test("Registrar cobro avisa del cobro pendiente que va a cobrar en vez de duplicar", () => {
  const src = lee("app/(dashboard)/facturacion/cobros/page.jsx");
  assert.match(src, /const pendientes = \(jMes\?\.data\?\.pendientes \?\? \[\]\)\.filter\(/, "lee `pendientes` de /payments/mes con la regla del paciente");
  assert.match(src, /setPendientesDelMes\(pendientes\);/);
  assert.match(src, /if \(pendientes\.length\) \{[\s\S]{0,900}setForm\(\(f\) => \(\{ \.\.\.f, amount: String\(suma\) \}\)\);/, "con pendientes, el importe propuesto es el suyo (o su suma), no la resta contra la cuota entera");
  assert.match(src, /\} else \{[\s\S]{0,400}setParcialDelMes\(Number\(esperado\)/, "sin `return` temprano: la cuota de la familia se pinta también con pendiente");
  assert.match(src, /notes: pendientesDelMes\.length\s*\? form\.notes\.trim\(\) \|\| null/, "con pendiente solo viaja la nota escrita a mano");
  assert.match(src, /Este mes ya tiene su cobro pendiente en Cobros/);
  assert.match(src, /No se crea otra fila/);
});
