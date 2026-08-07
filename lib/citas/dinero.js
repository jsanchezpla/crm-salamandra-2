/**
 * dinero.js — quién puede ver el dinero de las citas.
 *
 * DE DÓNDE SALE (07/08/2026, queja de Laura)
 * Su empleada, que es usuario del CRM con rol `user`, veía en la agenda el chip
 * «No se pudo cobrar · 360,00 €» de una clienta. Lo que molestaba era el DINERO:
 * ni las tarifas del centro ni el importe de nadie.
 *
 * DÓNDE SE PUSO LA RAYA, Y POR QUÉ AHÍ
 * Se quitan las CIFRAS y se deja el ESTADO. Recepción sigue viendo si una
 * sesión está cobrada, retenida o si falló el cobro —lo necesita cuando la
 * paciente llega por la puerta— pero no cuánto cuesta ni cuánto se le retuvo.
 * La primera versión de este fichero quitaba también el estado; Laura lo miró y
 * pidió justo esta raya, que es más útil y sigue resolviendo su queja.
 *
 * POR QUÉ ESTO VIVE EN EL SERVIDOR Y NO EN LA PANTALLA
 * Porque esconder no es quitar. El precio de los tipos de cita YA se escondía en
 * la interfaz desde el 06/08 —`app/(dashboard)/citas/tipos/page.jsx` lo tapa con
 * `esAdmin`, con el comentario «el PRECIO solo lo ve dirección»— y sin embargo
 * `GET /api/citas/event-types` seguía devolviéndolo en el JSON: la tarifa entera
 * del centro estaba a un clic derecho → inspeccionar. Media protección es
 * ninguna, y encima da la sensación de estar hecha.
 *
 * POR QUÉ UN SOLO FICHERO
 * La alternativa era repetir `if (!ADMIN_ROLES.has(rol))` en seis endpoints, y
 * entonces «qué cuenta como dinero» quedaría escrito en seis sitios que van
 * divergiendo. Ya pasó con la visibilidad de la agenda, que acabó recogida en
 * `visibilidad.js` por lo mismo. Si mañana aparece un campo nuevo con importes,
 * se añade AQUÍ y queda tapado en todas partes a la vez.
 *
 * QUÉ NO HACE, A PROPÓSITO
 * No decide quién puede CONFIRMAR una cita ni quién dispara un cobro. Rodrigo
 * abrió confirmar y rechazar a todo el equipo el 06/08 con un motivo escrito
 * («poder decir que no pero no que sí no es una lista de espera»), y en una
 * consulta como la de Laura eso es justo el trabajo de recepción. Ver el importe
 * y poder confirmar son dos permisos distintos: esto solo toca el primero.
 */

/** Roles que sí ven el dinero. Mismo conjunto que usan los endpoints de citas. */
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * ¿Este rol puede ver importes y estado de cobro?
 *
 * Se le pasa el rol tal cual sale de `x-user-role`, que `withTenant` reescribe
 * con el rol REAL de la base de datos antes de llegar al handler: degradar a
 * alguien surte efecto en la siguiente petición, sin esperar a que caduque su
 * sesión.
 */
export function puedeVerDinero(rol) {
  return ADMIN_ROLES.has(rol ?? "user");
}

/**
 * Campos de una cita que llevan un IMPORTE. Solo eso.
 *
 * El ESTADO de cobro —«Cobrada», «Retenido, sin cobrar», «No se pudo cobrar»—
 * se queda para todo el mundo (decisión de Laura, 07/08/2026): a recepción le
 * hace falta saber si una sesión está resuelta cuando llega la paciente, y eso
 * no es lo que molestaba. Lo que no puede ver es CUÁNTO.
 *
 * Por eso `paymentStatus` NO está en esta lista, y `authorizationExpiresAt`
 * tampoco: es lo que hace que el chip diga cuánto le queda a una retención, que
 * es estado y no cifra.
 */
const CAMPOS_CITA = [
  "amount",
  // No es un importe, pero es el hilo del que tirar para llegar al cobro
  // completo desde otra pantalla.
  "paymentSessionId",
];

/** Campos de un tipo de cita que son la tarifa del centro. */
const CAMPOS_TIPO = ["price", "instalmentPrice", "instalmentMonths"];

/**
 * Devuelve la cita sin nada de dinero. Se aplica al objeto que va a salir por la
 * API, no al modelo: aquí ya no se guarda nada.
 *
 * Limpia también el `eventType` anidado, que es por donde se colaba la tarifa
 * completa en el detalle de una cita.
 */
export function citaSinDinero(cita) {
  if (!cita || typeof cita !== "object") return cita;
  const limpia = { ...cita };
  for (const campo of CAMPOS_CITA) delete limpia[campo];
  if (limpia.eventType) limpia.eventType = tipoSinDinero(limpia.eventType);
  return limpia;
}

/** Devuelve el tipo de cita sin su tarifa. */
export function tipoSinDinero(tipo) {
  if (!tipo || typeof tipo !== "object") return tipo;
  const limpio = { ...tipo };
  for (const campo of CAMPOS_TIPO) delete limpio[campo];
  return limpio;
}

/**
 * Una cita, ya lista para salir por la API según quién la pida.
 *
 * Es el atajo que usan los endpoints que devuelven UNA cita (detalle, confirmar,
 * rechazar). Tenerlo aquí evita que cada uno escriba su propio
 * `puedeVerDinero(...) ? x : citaSinDinero(x)`, que es como se acaba colando un
 * `!` de más en uno de los seis.
 */
export function citaSegunRol(cita, rol) {
  return puedeVerDinero(rol) ? cita : citaSinDinero(cita);
}

/**
 * Atajo para los listados: aplica el filtro solo si hace falta.
 *
 * `filtrarCitas(filas, rol)` en el punto de salida de un endpoint deja el código
 * legible y hace evidente que el recorte va DESPUÉS de consultar, no antes: la
 * consulta necesita esos campos para su lógica interna (saber si hay que cobrar,
 * si caducó una retención), lo que no puede es enseñárselos a quien no toca.
 */
export function filtrarCitas(citas, rol) {
  if (puedeVerDinero(rol)) return citas;
  return (citas ?? []).map(citaSinDinero);
}

/** Igual, para listados de tipos de cita. */
export function filtrarTipos(tipos, rol) {
  if (puedeVerDinero(rol)) return tipos;
  return (tipos ?? []).map(tipoSinDinero);
}
