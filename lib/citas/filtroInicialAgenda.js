/**
 * lib/citas/filtroInicialAgenda.js — con qué filtro se abre la pantalla de
 * Citas: la agenda de quien mira, o la de todo el centro.
 *
 * (Fichero nuevo en /lib, regla #2: es un «si eres X no te enseño Y», y esos
 * van con nombre y con prueba en /lib, no sueltos por el JSX. La decisión la
 * toma `CitasModule` una sola vez al montarse, y aquí se puede probar sin
 * navegador.)
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────────
 * 01/09/2026, Rodrigo: «que de forma predeterminada salgan las que me atañen a
 * mí». Con la agenda compartida encendida, Aumenta pinta las citas de dieciocho
 * personas a la vez, y quien entraba a mirar lo suyo tenía que filtrarse a sí
 * mismo cada vez. Es un valor INICIAL, no un permiso: «Todo el equipo» sigue a
 * un clic, y quién PUEDE ver qué lo decide el servidor (`visibilidad.js`).
 *
 * ── PERO ADMINISTRACIÓN NO (10/09/2026, Rodrigo) ───────────────────────────
 * «En Citas, Olga y Rosa tienen agenda propia y no tiene sentido: deberían ver
 * la de todos, igual que admin.» Quien lleva la administración del centro no
 * atiende a nadie —las dos suman CERO citas en producción—, así que la agenda
 * se les abría EN BLANCO y el centro entero quedaba detrás de un clic que nadie
 * sabía que había que dar. Su trabajo es justo la agenda de los demás.
 *
 * Se pregunta por el DEPARTAMENTO y no por el rol: en Aumenta las dos son
 * `admin`, pero dirección también lo es y dirección sí pasa consulta (54 citas
 * cada una), así que a dirección la preselección le sirve. Quién es
 * administración lo dice el servidor (`administracion` de `/api/team`, con la
 * regla de `lib/team/departamentos.js`), el mismo dato que ya usa el botón
 * «Todos menos Administración» de los selectores de equipo: cuando entre alguien
 * nuevo en administración, esto acierta sin tocar código.
 */

/**
 * Con qué profesionales se abre el filtro del calendario.
 *
 * @param {object}   opciones
 * @param {string?}  opciones.miFichaId          la ficha de equipo de quien mira, si tiene
 * @param {string[]} opciones.idsAdministracion  fichas de administración, según el servidor
 * @returns {string[]|null}  los ids a preseleccionar, o `null` para no tocar el
 *                           filtro — que es como se ve el centro entero.
 */
export function filtroAlAbrirLaAgenda({ miFichaId, idsAdministracion } = {}) {
  if (!miFichaId) return null;
  if (llevaLaAdministracion(miFichaId, idsAdministracion)) return null;
  return [miFichaId];
}

/** ¿Esta ficha de equipo es de las que llevan la administración del centro? */
export function llevaLaAdministracion(miFichaId, idsAdministracion) {
  if (!miFichaId || !Array.isArray(idsAdministracion)) return false;
  return idsAdministracion.some((id) => String(id) === String(miFichaId));
}
