/**
 * lib/team/departamentos.js — quién es «Administración» (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Debería haber dentro de los selectores de equipo dos botones más: todo el
 * equipo y todos menos Administración (Olga y Rosa).»
 *
 * ── POR QUÉ NO SON DOS NOMBRES A MANO ──────────────────────────────────────
 * Porque «Olga y Rosa» es la respuesta de HOY a la pregunta «¿quién lleva la
 * administración del centro?», y el botón tiene que seguir acertando el día que
 * una se vaya o entre alguien más. El dato ya existe y ya está relleno:
 * `TeamMember.department`, que se edita en la ficha de Equipo.
 *
 * En producción (comprobado el 01/09/2026 sobre `crm_aumenta`) esas dos fichas
 * NO comparten departamento: Olga es «Administración» y Rosa, «Contabilidad».
 * Por eso la lista de abajo tiene DOS entradas y no una — un botón que solo
 * mirase «Administración» dejaría a Rosa dentro de la selección y el botón
 * estaría mintiendo justo en el caso para el que se pidió.
 *
 * ── POR QUÉ SE NORMALIZA ────────────────────────────────────────────────────
 * `department` es TEXTO LIBRE escrito por quince personas, y ya se nota: en
 * Aumenta conviven «Terapia Ocupacional» y «Terapia ocupacional» como dos
 * departamentos distintos. Se compara sin tildes, sin mayúsculas y sin espacios
 * de más, como hace `lib/clinica/trabajoInterno.js` con los conceptos de
 * bloqueo, y por lo mismo: comparar el texto crudo es adivinar.
 *
 * ── LO QUE NO ENTRA ─────────────────────────────────────────────────────────
 * «Dirección» NO es administración: en Aumenta son Laura B. e Isabel Alberca, y
 * el encargo dice «Administración (Olga y Rosa)» con nombres y apellidos. Un
 * botón que además quitase a dirección quitaría a quien convoca las reuniones.
 * Recepción y secretaría tampoco están: hoy nadie las tiene puestas, y meterlas
 * «por si acaso» sacaría de la selección a gente que nadie ha pedido sacar.
 * Cuando haga falta otro departamento, se añade AQUÍ y vale para todos los
 * selectores del CRM a la vez.
 */

// Texto libre comparable: sin mayúsculas, sin tildes, sin espacios de más.
function normalizar(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Los departamentos que cuentan como administración del centro, ya
 * normalizados. Ver la cabecera: son dos porque en producción son dos.
 */
export const DEPARTAMENTOS_ADMINISTRACION = ["administracion", "contabilidad"];

/** ¿Esta ficha es de administración? Sin departamento puesto, NO. */
export function esAdministracion(department) {
  const d = normalizar(department);
  if (!d) return false;
  return DEPARTAMENTOS_ADMINISTRACION.includes(d);
}

/**
 * Los ids de equipo que son administración, de una lista de fichas.
 *
 * Devuelve ids y no las fichas enteras a propósito: es lo único que necesita
 * el botón del selector, y así el departamento —que la lista recortada de
 * `/api/team` NO manda al navegador (`CAMPOS_FUERA_DE_LA_LISTA`)— se queda en
 * el servidor. Se pinta un botón, no se destapa una ficha.
 */
export function idsDeAdministracion(fichas) {
  if (!Array.isArray(fichas)) return [];
  return fichas.filter((f) => esAdministracion(f?.department)).map((f) => f?.id).filter(Boolean);
}
