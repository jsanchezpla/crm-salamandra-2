/**
 * lib/citas/permisosBloqueos.js — quién puede poner, cambiar y quitar un
 * bloqueo de la agenda (07/09/2026, AV-0056 y AV-0058 de Aumenta).
 *
 * ── DE DÓNDE VIENE LA REGLA ────────────────────────────────────────────────
 * Desde el 10/08/2026 (nutri_laura: Rocío apuntaba lo suyo con el desplegable
 * en «Todo el centro» y cerraba también la agenda de Laura) la regla era una
 * sola: quien no es admin toca SOLO los suyos, y dirección todo. Vivía escrita
 * tres veces dentro de `app/api/citas/bloqueos/route.js` (POST, PATCH, DELETE).
 *
 * ── LO QUE FALTABA: ADMINISTRACIÓN ─────────────────────────────────────────
 * En Aumenta la agenda de las terapeutas la coloca administración: entra con
 * rol `user` y mueve citas de cualquiera —eso siempre se pudo—, pero los
 * huecos «LIBRE PACIENTES» y «Reservado» de cada terapeuta son bloqueos a su
 * nombre, y ahí el servidor contestaba «Solo puedes cambiar tus propias
 * ausencias». Olga: «solamente nos deja mover los pacientes».
 *
 * La regla, por tanto, tiene tres escalones y no dos:
 *
 *   · dirección (admin)        → todo, incluidos los cierres de todo el centro.
 *   · administración           → los bloqueos de CUALQUIER persona; pero un
 *     (`lib/team/departamentos.js`)  cierre de centro (sin persona) sigue
 *                                 siendo de dirección: es lo único que cierra
 *                                 la agenda de todo el mundo de golpe.
 *   · el resto del equipo      → solo los suyos.
 *
 * «Administración» no es un rol nuevo: es el departamento de la ficha de
 * equipo, el mismo criterio con el que el archivo de documentos sabe a quién
 * excluir del botón «Todos menos Administración». Quien lleve la agenda del
 * centro ya está en ese departamento; quien no, no debería poder tocar la
 * agenda de otros, que era justo el aviso de nutri_laura.
 *
 * Funciones puras: reciben `yo` tal como lo calcula `quienSoy()` del endpoint
 * (`{ esAdmin, esAdministracion, teamMemberId }`) y devuelven `null` si se
 * puede o el mensaje que verá la persona si no. Se prueban en
 * `scripts/_smoke-permisos-bloqueos.mjs`.
 */

/** ¿Puede elegir a nombre de quién va un bloqueo? Dirección y administración. */
export function puedeElegirPersona(yo) {
  return !!(yo?.esAdmin || yo?.esAdministracion);
}

/** ¿Puede cerrar (o reabrir) TODO el centro, o sea un bloqueo sin persona? Solo dirección. */
export function puedeCerrarElCentro(yo) {
  return !!yo?.esAdmin;
}

/**
 * Veto para CAMBIAR o QUITAR un bloqueo que ya existe. `verbo` solo cambia la
 * frase: "cambiar" (PATCH) o "quitar" (DELETE).
 */
export function vetoParaTocar(yo, bloqueo, verbo = "cambiar") {
  if (puedeCerrarElCentro(yo)) return null;
  const esDelCentro = !bloqueo?.teamMemberId;
  if (esDelCentro) {
    return verbo === "quitar"
      ? "Los cierres de todo el centro los quita un administrador."
      : "Los cierres de todo el centro los cambia un administrador.";
  }
  if (puedeElegirPersona(yo)) return null;
  if (yo?.teamMemberId && bloqueo.teamMemberId === yo.teamMemberId) return null;
  return verbo === "quitar"
    ? "Solo puedes quitar tus propias ausencias."
    : "Solo puedes cambiar tus propias ausencias.";
}

/**
 * Veto para PONER un bloqueo a nombre de `teamMemberId` (`null` = todo el
 * centro), o para CAMBIAR de quién es uno que ya existe. Devuelve también a
 * nombre de quién queda de verdad: quien no puede elegir se lo pone a sí
 * mismo, mande lo que mande el navegador.
 */
export function aNombreDeQuien(yo, teamMemberIdPedido) {
  const pedido = teamMemberIdPedido || null;
  if (puedeCerrarElCentro(yo)) return { veto: null, teamMemberId: pedido };
  if (pedido === null) {
    if (puedeElegirPersona(yo) && yo?.teamMemberId) {
      // Administración sin elegir a nadie: se lo pone a sí misma, nunca al
      // centro entero.
      return { veto: null, teamMemberId: yo.teamMemberId };
    }
    if (puedeElegirPersona(yo)) {
      return { veto: "Cerrar todo el centro es cosa de dirección. Elige a una persona.", teamMemberId: null };
    }
  }
  if (puedeElegirPersona(yo)) return { veto: null, teamMemberId: pedido };
  if (!yo?.teamMemberId) {
    return {
      veto: "Tu usuario no está enlazado con una ficha de equipo, así que no se sabe de quién sería la ausencia. Pídeselo a un administrador.",
      teamMemberId: null,
    };
  }
  return { veto: null, teamMemberId: yo.teamMemberId };
}
