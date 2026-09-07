/**
 * lib/citas/quienDaBonos.js — quién puede dar, anular y editar un bono de
 * sesiones (07/09/2026, vuelta de AV-0055 de Aumenta).
 *
 * Hasta hoy, solo dirección (admin). Pero en Aumenta los bonos los gestiona
 * ADMINISTRACIÓN (Olga), que entra con rol `user` y lleva Facturación: es la
 * misma persona que apunta el cobro del bono en Cobros, y tenerla que pedirle
 * a dirección que abra el bono cada vez es el trámite que la petición quería
 * quitar.
 *
 * La regla: dirección siempre; y quien tenga acceso al módulo de Facturación
 * (`billing`), porque dar un bono es apuntar un dinero cobrado por fuera —la
 * misma responsabilidad que registrar un cobro—. El resto del equipo sigue
 * VIENDO los bonos de la ficha (lo necesita para atender), pero sin botones.
 *
 * `hasModule` es el del contexto (`withTenant`: módulo del tenant ∩ acceso del
 * usuario) en el servidor, o `enabledModules.includes` de `/api/auth/me` en la
 * pantalla: las dos cosas son la misma intersección.
 */

const ROLES_DIRECCION = new Set(["admin", "superadmin"]);

export function puedeDarBonos({ role, hasModule }) {
  if (ROLES_DIRECCION.has(String(role ?? ""))) return true;
  return typeof hasModule === "function" ? !!hasModule("billing") : false;
}

export const MOTIVO_SIN_PERMISO = "Solo dirección o quien lleve Facturación puede dar o quitar bonos";
