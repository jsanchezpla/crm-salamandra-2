// @prueba ligera — texto del fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-desprogramar-citas.mjs — quitarle a un paciente sus citas futuras de
 * una vez, sin avisar a nadie por correo (05/09/2026).
 *
 *   node scripts/_smoke-desprogramar-citas.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * AV-0049 (Aumenta, Olga García): «al dar de alta en agenda un paciente y
 * programar para todas las semanas, al querer desprogramar no podemos hacerlo;
 * tendríamos que eliminar cita por cita semanalmente». Repetir una cita crea N
 * citas INDEPENDIENTES a propósito, así que no hay serie que deshacer: lo que
 * sí hay es un paciente y una fecha.
 *
 * Lo que se fija aquí es lo que duele si se rompe, y es texto del endpoint:
 *
 *  1. **No manda correos.** Cancelar UNA cita avisa a la familia; cuarenta
 *     avisos de golpe por una baja ya hablada serían cuarenta llamadas al día
 *     siguiente. Si alguien importa aquí el remitente o la plantilla de
 *     cancelación, esto lo dice.
 *  2. **Solo hacia adelante.** Sin el corte por fecha, un clic se llevaría por
 *     delante el historial entero del paciente.
 *  3. **Solo las citas vivas.** Una completada o una falta ya dijeron lo suyo.
 *  4. **Cancela, no borra.** La cita cancelada libera el hueco y se queda en el
 *     histórico: es lo que distingue «se dio de baja» de «nunca existió».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUTA = readFileSync(new URL("../app/api/pacientes/[id]/desprogramar/route.js", import.meta.url), "utf8");
const COMPONENTE = readFileSync(new URL("../components/citas/CitasDelPaciente.jsx", import.meta.url), "utf8");
const ETIQUETAS = readFileSync(new URL("../lib/actividad/etiquetas.js", import.meta.url), "utf8");

test("no manda ni un correo ni un WhatsApp", () => {
  assert.ok(!/resendClient|sendEmail|emailCancelacion|avisarCitaPorWhatsapp|templates\//.test(RUTA),
    "el desprogramado en bloque no puede avisar a la familia cita a cita");
});

test("solo toca las citas VIVAS", () => {
  assert.match(RUTA, /const VIVAS = \["pending", "confirmed"\]/,
    "las completadas, las faltas y las ya canceladas se quedan como están");
  assert.match(RUTA, /status: \{ \[Op\.in\]: VIVAS \}/, "el update no filtra por estado");
});

test("solo hacia adelante, nunca el pasado", () => {
  assert.match(RUTA, /scheduledAt: \{ \[Op\.gte\]: instante \}/,
    "sin el corte por fecha se llevaría por delante el historial entero");
  assert.match(RUTA, /madridToday\(\)/, "por defecto tiene que ser hoy en Madrid, no en UTC");
});

test("cancela, no borra", () => {
  assert.match(RUTA, /status: "cancelled"/, "tiene que cancelar");
  assert.ok(!/\.destroy\(|Op\.in\]: ids \}\s*\}\s*\);\s*await .*destroy/.test(RUTA), "no puede borrar citas");
});

test("deja UNA línea de auditoría con el recuento, y sin datos de salud", () => {
  assert.match(RUTA, /action: "citas\.desprogramadas_en_bloque"/);
  assert.match(RUTA, /after: \{ pacienteId: id, citas: quitadas, desde: fecha, motivo \}/,
    "la auditoría tiene que llevar el recuento, no las filas");
  assert.match(ETIQUETAS, /"citas\.desprogramadas_en_bloque":/,
    "toda acción auditada necesita su frase en etiquetas.js");
});

test("el gate exige los dos módulos", () => {
  assert.match(RUTA, /hasModule\("citas"\) && \(ctx\.hasModule\("clinica"\) \|\| ctx\.hasModule\("pacientes"\)\)/);
});

test("la pantalla avisa de que la familia NO se entera", () => {
  assert.match(COMPONENTE, /NO se avisa a la familia/,
    "quien da la baja tiene que saber que el aviso a la familia es cosa suya");
  assert.match(COMPONENTE, /Quitar las futuras/, "falta el botón");
});

// ── Revisión del 06/09/2026 ─────────────────────────────────────────────────
test("nunca corta antes de ahora mismo: la sesión de esta mañana no se cancela", () => {
  assert.match(RUTA, /medianoche > ahora \? medianoche : ahora/, "el instante tiene que ser max(00:00 de la fecha, ahora)");
});

test("la baja en bloque hace lo mismo que cancelar UNA cita: retira el borrador y devuelve el dinero", () => {
  assert.match(RUTA, /retirarBorradoresDeLaCita\(\{/, "tiene que retirar el borrador de registro de cada cita");
  assert.match(RUTA, /reembolsarCitaSiProcede\(ctx, cita, \{ quienCancela: "profesional"/, "tiene que devolver el cobro como el PATCH de la cita");
  assert.ok(!/Booking\.update\(/.test(RUTA), "ya no puede ser un UPDATE masivo: las dos piezas van cita a cita");
});
