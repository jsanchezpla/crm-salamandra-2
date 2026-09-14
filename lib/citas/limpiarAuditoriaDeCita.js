/**
 * lib/citas/limpiarAuditoriaDeCita.js — deja una fila VIEJA de auditoría de una
 * cita como la escribiría hoy la app (14/09/2026).
 *
 * ── MOTIVO DE TOCAR /lib/ (regla #2) ────────────────────────────────────────
 * Hasta el 13/09/2026 (commit e06aeb8d) las citas volcaban la fila entera en
 * `master.audit_logs`: 1.550 filas con nombre, correo, teléfono, notas y el
 * token de cancelar, y 129 huellas de borrado con el nombre. Jorge decidió el
 * 14/09/2026 REESCRIBIRLAS en sitio (no borrarlas). La transformación vive aquí
 * y no dentro del script para que `scripts/_smoke-auditoria-citas-limpieza.mjs`
 * la pruebe sin base de datos: el script (`scripts/limpiar-auditoria-citas.js`)
 * solo lee, llama a esto y escribe.
 *
 * ── CRITERIO ────────────────────────────────────────────────────────────────
 * No se inventa un formato: se pasa cada lado por las MISMAS funciones de
 * `resumenDeCita.js` que usan hoy las rutas, para que una fila limpiada sea
 * indistinguible de una nueva:
 *   · alta / cancelación / cualquier lado con la fila entera → `resumenDeCita`
 *     + las claves propias de la línea (`source`, `reembolso`, `asistentes`…);
 *   · edición (los dos lados enteros) → `fijosDeCita` + `cambiosDeCita`, lo
 *     privado solo por nombre en `cambiadosSinValor`;
 *   · huella de borrado → `huellaDeCita`, sin `cliente`, con `clientId`/
 *     `patientId` si otra fila de la MISMA cita los sabía;
 *   · y al final la red `ladosParaAuditar`.
 * Una fila sin nada privado no se toca (`null`): eso hace el script idempotente
 * y deja intactas las filas escritas después del arreglo.
 *
 * Sin imports salvo `resumenDeCita.js`, que tampoco tiene.
 */

import {
  CAMPOS_RESUMEN_CITA,
  CAMPOS_PRIVADOS_CITA,
  CAMPOS_FUERA_DEL_RESUMEN,
  ASOCIACIONES_CITA,
  resumenDeCita,
  fijosDeCita,
  cambiosDeCita,
  huellaDeCita,
  ladosParaAuditar,
} from "./resumenDeCita.js";

/** La clave con el nombre que llevaba la huella de una cita borrada hasta el 13/09/2026. */
export const CLAVE_NOMBRE_HUELLA = "cliente";

/**
 * Las columnas de la cita; lo que no esté aquí es propio de la línea y se
 * conserva. Las asociaciones no entran: `asistentes`/`impartidores` como número
 * son de la línea (convertir-bloqueos), y como objeto anidado las quita la red.
 */
const CLAVES_DE_LA_CITA = new Set([...CAMPOS_RESUMEN_CITA, ...CAMPOS_PRIVADOS_CITA, ...CAMPOS_FUERA_DEL_RESUMEN]);

const esObjeto = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** ¿Lleva este lado algo que no puede estar en master? (lo privado, el nombre de la huella o una asociación anidada) */
export function ladoConDatosPrivados(lado) {
  if (!esObjeto(lado)) return false;
  for (const [k, v] of Object.entries(lado)) {
    if (CAMPOS_PRIVADOS_CITA.includes(k) || k === CLAVE_NOMBRE_HUELLA) return true;
    if (ASOCIACIONES_CITA.includes(k) && v !== null && typeof v === "object") return true;
  }
  return false;
}

/** Lo que la línea añadía a la cita (`source`, `reembolso`, `borradores`…), sin tocar. */
function propiasDeLaLinea(lado) {
  const out = {};
  for (const [k, v] of Object.entries(lado)) if (!CLAVES_DE_LA_CITA.has(k)) out[k] = v;
  return out;
}

/** Un lado con la fila entera → el resumen de hoy más lo propio de la línea. */
function resumenConPropias(lado) {
  return { ...resumenDeCita(lado), ...propiasDeLaLinea(lado) };
}

/**
 * De qué ficha es una cita, según un lado de su auditoría (entero o resumido).
 * Solo FK: sirve para que la huella de un borrado viejo diga «de quién» sin nombre.
 */
export function identidadDeCita(lado) {
  if (!esObjeto(lado)) return null;
  const out = {};
  for (const k of ["clientId", "patientId", "tallerGrupoId"]) {
    if (lado[k] !== undefined && lado[k] !== null) out[k] = lado[k];
  }
  return Object.keys(out).length ? out : null;
}

/** La huella vieja (`cliente`, `estado`, …) con la forma de `huellaDeCita` de hoy. */
function huellaSinNombre(before, identidad) {
  const { [CLAVE_NOMBRE_HUELLA]: _nombre, ...resto } = before;
  const huella = huellaDeCita({
    clientId: resto.clientId ?? identidad?.clientId ?? null,
    patientId: resto.patientId ?? identidad?.patientId ?? null,
    tallerGrupoId: resto.tallerGrupoId ?? identidad?.tallerGrupoId ?? null,
    scheduledAt: resto.scheduledAt,
    status: resto.estado,
    eventTypeId: resto.eventTypeId,
    teamMemberId: resto.teamMemberId,
    sessionNumber: resto.sessionNumber,
  });
  const extra = {};
  for (const [k, v] of Object.entries(resto)) if (!(k in huella)) extra[k] = v;
  return { ...huella, ...extra };
}

/**
 * Limpia una fila de auditoría con `entity = 'Booking'`.
 *
 * @param {{ action: string, before: any, after: any }} fila
 * @param {{ identidad?: { clientId?, patientId?, tallerGrupoId? } | null }} [opciones]
 *   la identidad de la cita sacada de OTRAS filas suyas (solo la usa la huella).
 * @returns `null` si no lleva nada privado (no hay que tocarla), o
 *   `{ tipo: "alta"|"edicion"|"cancelacion"|"huella"|"otra", before, after }`.
 */
export function limpiarFilaDeCita({ action, before = null, after = null } = {}, { identidad = null } = {}) {
  const sucioAntes = ladoConDatosPrivados(before);
  const sucioDespues = ladoConDatosPrivados(after);
  if (!sucioAntes && !sucioDespues) return null;

  let tipo;
  let b = before;
  let a = after;

  if (action === "citas.booking_deleted" && sucioAntes && CLAVE_NOMBRE_HUELLA in before) {
    tipo = "huella";
    b = huellaSinNombre(before, identidad);
  } else if (action === "citas.booking_updated" && sucioAntes && sucioDespues) {
    // Lo mismo que escribe hoy el PATCH de app/api/citas/bookings/[id]/route.js.
    tipo = "edicion";
    const cambios = cambiosDeCita(before, after);
    b = { ...fijosDeCita(before), ...cambios.antes, ...propiasDeLaLinea(before) };
    a = {
      ...fijosDeCita(after),
      ...cambios.despues,
      ...(cambios.cambiadosSinValor.length ? { cambiadosSinValor: cambios.cambiadosSinValor } : {}),
      ...propiasDeLaLinea(after),
    };
  } else {
    tipo =
      action === "citas.booking_created" ? "alta" : action === "citas.booking_cancelled" ? "cancelacion" : "otra";
    if (sucioAntes) b = resumenConPropias(before);
    if (sucioDespues) a = resumenConPropias(after);
  }

  const lados = ladosParaAuditar({ entity: "Booking", before: b, after: a });
  return { tipo, before: lados.before, after: lados.after };
}
