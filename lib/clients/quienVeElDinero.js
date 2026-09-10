/**
 * lib/clients/quienVeElDinero.js — qué partes de una ficha son dinero y quién
 * las ve (10/09/2026, ticket de Raquel Torralbo, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: lo preguntan los meses del área privada,
 * los bonos de la ficha y los bonos de la agenda. Tres sitios, una regla.)
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * Raquel: «nosotras las terapeutas no tenemos acceso a los clientes; se podría
 * abrir, pero capado a datos de carácter informativo: contacto, correo, los
 * datos del contrato; el tema económico que solo lo vean oficina y dirección».
 * Rodrigo lo aprobó tal cual el 10/09/2026.
 *
 * Abrirles Clientes ya escondía casi todo el dinero solo: la pestaña
 * «Facturación» se pinta con `/api/clients/[id]/billing-summary`, que gatea por
 * `billing`, y sin él la sección devuelve null y la pestaña desaparece del
 * menú. Lo que NO se escondía —porque gateaba por `clients` a secas— es esto:
 *
 *   · los MESES del área privada, que dicen mes a mes si la familia ha pagado
 *     (se abren solos con el cobro del mes);
 *   · el plan de CUOTAS de un bono a plazos: cuántas van cobradas, cuál rebotó
 *     y qué dijo el banco.
 *
 * Las sesiones que le quedan de un bono NO son dinero: son lo que hace falta
 * para atender, y se quedan a la vista de todo el equipo.
 *
 * El dinero de las CITAS (importes, tarifas, cobros fallidos) ya se tapaba
 * aparte desde el 07/08/2026 en `lib/citas/dinero.js`, y allí la frontera es el
 * rol porque así lo pidió Laura para su agenda. Esto es la ficha, y aquí manda
 * el módulo: son dos preguntas distintas y se responden en su sitio.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * El dinero es de quien lleva Facturación (`lib/auth/permisos.js`: se gatea con
 * `hasModule("billing")` y NUNCA con el rol, porque quien administra no siempre
 * dirige; ver también `lib/citas/quienDaBonos.js`, que reparte igual). Con una
 * excepción con nombre: en un centro que NO tiene el módulo de
 * Facturación no hay «quien lo lleve», así que cerrarlo por ahí dejaría la
 * sección sin dueño y desaparecería para todo el mundo. Ahí se queda como
 * estaba: la ve quien tenga las fichas.
 */

/**
 * ¿Ve esta persona el dinero de una ficha?
 *
 * @param ctx el contexto de `withTenant` (necesita `hasModule` —módulo del
 *            tenant ∩ acceso del usuario— y `tenantHasModule` —solo el tenant—).
 */
export function veElDineroDeLaFicha(ctx) {
  const enElCentro = typeof ctx?.tenantHasModule === "function" ? ctx.tenantHasModule("billing") : false;
  if (!enElCentro) return true; // centro sin Facturación: no hay dinero que repartir
  return typeof ctx?.hasModule === "function" ? !!ctx.hasModule("billing") : false;
}

/**
 * Los mismos bonos, sin lo que es dinero.
 *
 * Se quita el plan de cuotas entero (cuántas van, cuál rebotó, el motivo del
 * banco y el próximo intento). Lo demás —nombre, tipo de cita, sesiones
 * gastadas y restantes— se queda: es con lo que se atiende.
 */
export function bonosSinDinero(bonos) {
  return (Array.isArray(bonos) ? bonos : []).map((b) => (b?.cuotas ? { ...b, cuotas: null } : b));
}
