/**
 * lib/citas/resumenDeCita.js — lo ÚNICO de una cita que llega a master.audit_logs (13/09/2026).
 *
 * ── MOTIVO DE TOCAR /lib/ (regla #2) ────────────────────────────────────────
 * El alta desde el panel, la reserva pública, la edición y las dos vías de
 * cancelar volcaban `row.toJSON()` —nombre, correo, teléfono, notas, respuestas
 * del formulario, el texto del cobro y el token del enlace «cancelar»— en la
 * tabla de auditoría de master, que comparten todos los clientes (1.550 filas
 * el 13/09/2026). CLAUDE.md, Seguridad → Auditoría: «un RESUMEN, nunca la fila
 * entera (datos personales y de salud no se duplican en master)».
 *
 * ── POR QUÉ UN FICHERO NUEVO Y NO LO QUE YA HAY ─────────────────────────────
 * · Mismo criterio que `auditSummary` de `lib/clinica/audit.js` (23/07/2026),
 *   que quitó el `row.toJSON()` de los registros clínicos con una lista BLANCA
 *   («Ante la duda, fuera»). Pero sus claves son las de otro modelo.
 * · `resumen()` de `lib/utils/auditoria.js` no sirve tal cual: pasa las fechas
 *   por `String()` (fecha local, no ISO), devuelve null si queda vacío e importa
 *   masterDb, así que su prueba no sería ligera.
 * · Sin imports a propósito (como `gastaSesion.js`): lo prueba
 *   `scripts/_smoke-citas-auditoria.mjs` sin base de datos.
 *
 * Las tres listas cubren EXACTAMENTE las columnas de `Booking.model.js` (más
 * createdAt/updatedAt): la prueba falla si aparece una columna sin decidir.
 *
 * Ver docs/decisions/2026-09-13-la-auditoria-de-una-cita-no-lleva-al-paciente.md
 */

/** Ids, hora, estado y dinero: lo que dice DE QUÉ cita se habla sin decir de quién. */
export const CAMPOS_RESUMEN_CITA = Object.freeze([
  "eventTypeId",
  "scheduledAt",
  "duration",
  "modality",
  "status",
  "cancelledAt",
  "noShowJustified",
  "recoveredByBookingId",
  "teamMemberId",
  "patientId",
  "clientId",
  "paymentStatus",
  "amount",
  "packId",
  "sessionNumber",
  "tallerGrupoId",
  "cobroModo",
  "cobroConceptId",
  "cobroImporte",
  "diagnosticoId",
  "diagnosticoTramo",
]);

/** Nunca salen a master: quién es, texto libre sobre la familia o el cobro, y el secreto del enlace «cancelar». */
export const CAMPOS_PRIVADOS_CITA = Object.freeze([
  "clientName",
  "clientEmail",
  "clientPhone",
  "additionalData",
  "notes",
  "noShowReason",
  "formAnswers",
  "cobroTexto",
  "cancellationToken",
]);

/**
 * Ni resumen ni privados: ruido (relojes internos, el id que ya va en
 * `entityId`) o campos que tienen su PROPIA línea explícita y no cambian de
 * comportamiento aquí: `meetUrl` → `appointment.meet_link_set`;
 * `cancellationReason` → `booking_status_changed` / `_cancelled` / `_rejected`.
 */
export const CAMPOS_FUERA_DEL_RESUMEN = Object.freeze([
  "id",
  "createdAt",
  "updatedAt",
  "reminderSentAt",
  "holdExpiresAt",
  "authorizationExpiresAt",
  "paymentSessionId",
  "meetUrl",
  "cancellationReason",
]);

/**
 * Los alias de Booking en `lib/db/tenantDb.js`: lo que `toJSON()` arrastra
 * cuando la fila se cargó con `include` (`patient` lleva nombre y apellidos;
 * `diagnostico`, el expediente). La prueba los compara con tenantDb.js.
 */
export const ASOCIACIONES_CITA = Object.freeze([
  "patient",
  "client",
  "eventType",
  "teamMember",
  "pack",
  "tallerGrupo",
  "diagnostico",
  "avisos",
  "changeRequests",
  "asistentes",
  "impartidores",
]);

/** La instancia de Sequelize a objeto plano; si su toJSON revienta, null (nunca lanza). */
function plano(x) {
  if (x && typeof x === "object" && !(x instanceof Date) && typeof x.toJSON === "function") {
    try {
      return x.toJSON();
    } catch {
      return null;
    }
  }
  return x;
}

const valor = (v) => (v instanceof Date ? v.toISOString() : v);

/** ¿Mismo valor? Una fecha se compara por instante, venga como Date o como texto. */
function igual(a, b) {
  if (a instanceof Date || b instanceof Date) {
    const ta = a == null ? null : new Date(a).getTime();
    const tb = b == null ? null : new Date(b).getTime();
    return ta === tb;
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Resumen de una cita para `before`/`after`: solo la lista blanca, sin nulos,
 * fechas en ISO. Acepta la instancia de Sequelize o un objeto plano.
 */
export function resumenDeCita(cita) {
  const c = plano(cita);
  if (!c || typeof c !== "object") return null;
  const out = {};
  for (const k of CAMPOS_RESUMEN_CITA) {
    if (c[k] !== undefined && c[k] !== null) out[k] = valor(c[k]);
  }
  return out;
}

/**
 * Lo que una línea de EDICIÓN lleva SIEMPRE en los dos lados, cambie o no:
 * sin ellos, «se movió de hora» no dice cuánto dura, de quién es ni en qué
 * estado queda, y la comprobación de huecos forzados sobre bloqueos (T4,
 * 13/09/2026) lee `after->>'duration'`, `'teamMemberId'`, `'status'` y
 * `'patientId'` de esa fila. Son ids, hora y estado: nada personal.
 */
export const CAMPOS_FIJOS_EDICION = Object.freeze([
  "scheduledAt",
  "duration",
  "teamMemberId",
  "status",
  "eventTypeId",
  "patientId",
]);

/**
 * Los fijos de una cita, con null EXPLÍCITO (a diferencia de `resumenDeCita`):
 * «sin profesional» se distingue de «no se guardó». Fechas en ISO. Nunca lanza.
 */
export function fijosDeCita(cita) {
  const p = plano(cita);
  const c = p && typeof p === "object" ? p : {};
  const out = {};
  for (const k of CAMPOS_FIJOS_EDICION) out[k] = valor(c[k]) ?? null;
  return out;
}

/**
 * Qué cambió al editar. De la lista blanca, los valores de antes y de después
 * (con null explícito cuando se vacía); de lo privado —y de `meetUrl` y
 * `cancellationReason`, que tienen su línea—, solo el NOMBRE del campo en
 * `cambiadosSinValor`. El valor vigente sigue en `bookings`.
 */
export function cambiosDeCita(antes, despues) {
  const a = plano(antes) ?? {};
  const d = plano(despues) ?? {};
  const r = { antes: {}, despues: {}, cambiadosSinValor: [] };
  if (typeof a !== "object" || typeof d !== "object") return r;
  for (const k of CAMPOS_RESUMEN_CITA) {
    if (igual(a[k], d[k])) continue;
    r.antes[k] = valor(a[k]) ?? null;
    r.despues[k] = valor(d[k]) ?? null;
  }
  for (const k of [...CAMPOS_PRIVADOS_CITA, "meetUrl", "cancellationReason"]) {
    if (!igual(a[k], d[k])) r.cambiadosSinValor.push(k);
  }
  return r;
}

/**
 * Lo poco que queda de una cita BORRADA: la identifica por sus FK y sin el
 * nombre (13/09/2026; hasta entonces guardaba `cliente: clientName`). La ficha
 * sigue en el tenant. Una reserva pública de alguien sin ficha (`clientId`
 * null) queda sin «de quién»: aceptado y escrito en la decisión.
 */
export function huellaDeCita(cita) {
  const c = plano(cita) ?? {};
  return {
    clientId: c.clientId ?? null,
    patientId: c.patientId ?? null,
    tallerGrupoId: c.tallerGrupoId ?? null,
    scheduledAt: valor(c.scheduledAt) ?? null,
    estado: c.status ?? null,
    eventTypeId: c.eventTypeId ?? null,
    teamMemberId: c.teamMemberId ?? null,
    sessionNumber: c.sessionNumber ?? null,
  };
}

/**
 * Un lado (before/after) sin lo privado ni las asociaciones anidadas. Conserva
 * todo lo demás (source, reembolso, dinero, asistentes numéricos…). Nunca lanza:
 * va dentro del try silencioso de `logCitasAudit`, y si lanzara la fila de
 * auditoría se perdería sin ruido.
 */
export function sinDatosPrivadosDeCita(lado) {
  if (lado == null) return null;
  if (typeof lado !== "object" || Array.isArray(lado) || lado instanceof Date) return lado;
  const obj = plano(lado);
  if (!obj || typeof obj !== "object") return obj ?? null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CAMPOS_PRIVADOS_CITA.includes(k)) continue;
    if (ASOCIACIONES_CITA.includes(k) && v !== null && typeof v === "object") continue;
    out[k] = v;
  }
  return out;
}

/**
 * La RED de `logCitasAudit`: con `entity: "Booking"` quita lo privado aunque
 * quien llama se lo pase; con cualquier otra entidad (EventType, Availability,
 * TeamBlock, SessionPack…) devuelve los MISMOS objetos, sin tocarlos.
 */
export function ladosParaAuditar({ entity, before = null, after = null } = {}) {
  if (entity !== "Booking") return { before, after };
  return { before: sinDatosPrivadosDeCita(before), after: sinDatosPrivadosDeCita(after) };
}
