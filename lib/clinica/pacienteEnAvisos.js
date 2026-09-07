/**
 * lib/clinica/pacienteEnAvisos.js — el nombre del paciente delante de una
 * incidencia, en cualquier sitio donde se lea de un vistazo (07/09/2026,
 * AV-0052 de Aumenta).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * Isabel: «cuando se registra una incidencia, aparece debajo del título el
 * nombre del paciente solo para quien la ha creado; para los demás desaparece
 * y el subtítulo pasa a ser a quién va destinada». La lista de Equipo →
 * Incidencias pintaba el paciente para todo el mundo, pero a las responsables
 * la incidencia les llega ANTES por otros tres sitios donde el paciente no
 * estaba: la campana («Incidencia asignada» + solo el título), Inicio → Mi
 * trabajo (solo el título) y el aviso de comentario. Quien la crea la ve en la
 * lista, con paciente; quien la recibe la ve en la campana, sin él. De ahí la
 * sensación de «solo lo ve la creadora».
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * Una sola forma de escribirlo en los tres sitios: «Nombre Apellido · lo que
 * sea». Sin paciente (una incidencia laboral, una de material), el texto va
 * tal cual: no se inventa un «— · …».
 *
 * (Fichero propio en /lib, regla #2: lo comparten `lib/notifications/alerts.js`,
 * `lib/home/summary.js` y `lib/clinica/avisoComentarioIncidencia.js`, que no se
 * importan entre sí; y `lib/clinica/incidencias.js` ya tiene su `miniPatient`
 * para la API, con otra forma.)
 */

/** «Lucía Ruiz Pérez», o "" si la fila no trae paciente o viene sin nombre. */
export function nombrePaciente(patient) {
  if (!patient) return "";
  const p = patient.toJSON ? patient.toJSON() : patient;
  if (typeof p.name === "string" && p.name.trim()) return p.name.trim();
  return [p.firstName, p.lastName]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

/** «Lucía Ruiz · Se solapan dos citas», o el texto solo si no hay paciente. */
export function conPaciente(texto, patient) {
  const t = String(texto ?? "").trim();
  const nombre = nombrePaciente(patient);
  return nombre ? (t ? `${nombre} · ${t}` : nombre) : t;
}
