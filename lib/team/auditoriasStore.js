/**
 * lib/team/auditoriasStore.js — la parte de la auditoría de desempeño que
 * TOCA LA BASE (09/09/2026, AV-0100).
 *
 * Se separa de `auditoriaDesempeno.js` a propósito: allí no entra nada que
 * necesite Sequelize, para que sus reglas se puedan probar con `node --test` sin
 * levantar nada. Aquí van la puerta del módulo, quién es dirección y cómo se
 * serializa una fila, que son las tres cosas que si se escriben dos veces acaban
 * diciendo cosas distintas entre la lista y la ficha.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** Dirección. Mismo criterio que en incidencias (`alcanceIncidencias.js`). */
export function esDireccion(ctx) {
  return ADMIN_ROLES.has(ctx?.user?.role);
}

/**
 * La puerta del módulo. Devuelve el motivo del 403, o `null` si se puede pasar.
 *
 * `auditorias` es un módulo propio que se vende aparte (regla 16, caso 3a), y
 * necesita `team` porque toda auditoría es de alguien de la plantilla.
 */
export function gateAuditorias(ctx) {
  if (!ctx.hasModule("auditorias")) return "Módulo Auditorías no activo";
  if (!ctx.hasModule("team")) return "Módulo Equipo no activo";
  return null;
}

/** Una fila, tal como la lee la pantalla. */
export function serializarAuditoria(fila) {
  if (!fila) return null;
  const f = fila.toJSON ? fila.toJSON() : fila;
  return {
    id: f.id,
    teamMemberId: f.teamMemberId,
    auditorId: f.auditorId ?? null,
    mes: f.mes,
    fecha: f.fecha ?? null,
    areas: Array.isArray(f.areas) ? f.areas : [],
    fortalezas: f.fortalezas ?? "",
    aspectosAMejorar: f.aspectosAMejorar ?? "",
    accionAcordada: f.accionAcordada ?? "",
    plazoRevision: f.plazoRevision ?? null,
    observaciones: f.observaciones ?? "",
    resultado: f.resultado ?? null,
    resueltoLoAnterior: f.resueltoLoAnterior ?? "",
    pacientesRevisados: Array.isArray(f.pacientesRevisados) ? f.pacientesRevisados : [],
    estado: f.estado ?? "borrador",
    cerradaAt: f.cerradaAt ?? null,
    auditado: f.auditado ? { id: f.auditado.id, displayName: f.auditado.displayName, avatarColor: f.auditado.avatarColor ?? null } : null,
    auditor: f.auditor ? { id: f.auditor.id, displayName: f.auditor.displayName } : null,
  };
}
