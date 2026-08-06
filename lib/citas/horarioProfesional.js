/**
 * Los huecos de MI profesional, no los del centro (06/08/2026, Rodrigo).
 *
 * La agenda pública calcula los huecos a partir de las disponibilidades del
 * TIPO DE CITA (`availabilities`): las mismas para todo el mundo. En una
 * consulta de una sola nutricionista eso es correcto. Con equipo deja de
 * serlo: cada paciente lleva su seguimiento con la suya, y ofrecerle la agenda
 * de otra es ofrecerle una cita que no le corresponde.
 *
 * Aquí se cruzan las dos cosas:
 *   1. cuándo ATIENDE el centro para ese tipo de cita  (`availabilities`)
 *   2. cuándo trabaja ESA profesional                  (`team_member_hours`)
 * y el hueco válido es la intersección. Ni un minuto fuera del horario del
 * centro, ni un minuto fuera del de ella.
 *
 * ── QUÉ PASA SI ELLA NO TIENE HORARIO PROPIO ────────────────────────────────
 * Se devuelve la agenda del centro SIN recortar. Es la decisión importante de
 * este fichero: casi nadie tiene su horario metido todavía, y si «sin horario»
 * significara «sin huecos», asignarle una profesional a una paciente la
 * dejaría sin poder pedir cita — un cambio pensado para ordenar acabaría
 * cerrando la agenda. Cuando alguien rellene el suyo, empieza a filtrar.
 */

/** "HH:MM[:SS]" → minutos desde medianoche. `null` si no es una hora. */
function aMinutos(hora) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** minutos → "HH:MM", que es como se guardan las disponibilidades. */
function aHora(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Recorta las disponibilidades del centro al horario de una profesional.
 *
 * @param disponibilidades  filas de `availabilities` YA filtradas por día
 * @param horasProfesional  filas de `team_member_hours` de esa persona
 * @param dayOfWeek         día que se está mirando
 * @returns tramos `{ startTime, endTime, eventTypeId }` con la intersección
 *
 * Un tramo del centro puede partirse en VARIOS si ella trabaja en dos turnos
 * (mañana y tarde con comida en medio): de 9 a 18 del centro contra 9-14 y
 * 16-18 suyos salen dos huecos, no uno de 9 a 18 con un agujero invisible.
 */
export function recortarAlHorario(disponibilidades, horasProfesional, dayOfWeek) {
  const suyas = (horasProfesional ?? []).filter((h) => h.dayOfWeek === dayOfWeek);
  // Sin horario propio no se recorta nada: ver la cabecera.
  if (suyas.length === 0) return disponibilidades ?? [];

  const tramos = [];
  for (const disp of disponibilidades ?? []) {
    const desdeCentro = aMinutos(disp.startTime);
    const hastaCentro = aMinutos(disp.endTime);
    if (desdeCentro == null || hastaCentro == null || hastaCentro <= desdeCentro) continue;

    for (const suya of suyas) {
      const desdeElla = aMinutos(suya.startTime);
      const hastaElla = aMinutos(suya.endTime);
      if (desdeElla == null || hastaElla == null || hastaElla <= desdeElla) continue;

      const desde = Math.max(desdeCentro, desdeElla);
      const hasta = Math.min(hastaCentro, hastaElla);
      // Solapamiento de 0 minutos no es un hueco: es que no coinciden.
      if (hasta <= desde) continue;

      tramos.push({
        ...disp,
        startTime: aHora(desde),
        endTime: aHora(hasta),
      });
    }
  }

  // Ordenados por hora: quien los consume genera los slots en orden y así la
  // pantalla los enseña como se leen.
  return tramos.sort((a, b) => aMinutos(a.startTime) - aMinutos(b.startTime));
}

/**
 * ¿A quién se le pide cita? La profesional asignada de esta ficha, si la tiene.
 *
 * Se devuelve el id o `null`; nunca lanza. Una reserva no puede caerse porque
 * la ficha venga sin el campo (tenants que aún no pasaron la migración).
 */
export function profesionalDe(client) {
  const id = client?.assignedTeamMemberId ?? client?.assigned_team_member_id ?? null;
  return id ? String(id) : null;
}
