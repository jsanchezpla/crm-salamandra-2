/**
 * lib/citas/incidenciaPorFalta.js — marcar una falta ABRE UNA INCIDENCIA y se
 * la manda a quien lleva la administración del centro (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Cuando se ponga que la falta es tanto justificada como injustificada se
 * tiene que abrir una incidencia y mandársela automáticamente a Olga (esto
 * último solo para Aumenta).»
 *
 * ── POR QUÉ NO PONE «OLGA» EN NINGÚN SITIO ──────────────────────────────────
 * Porque una persona a fuego en el código se va de vacaciones, cambia de puesto
 * o se va del centro, y los avisos se pierden sin que nadie se entere. La misma
 * lección ya está escrita al lado, en el aviso de campana de las faltas sin
 * justificar (`app/api/citas/bookings/[id]/route.js`).
 *
 * Así que el QUIÉN es un dato del cliente —`settings.citas.incidenciaPorFalta`,
 * una lista de ids de `team_members`— y el código lo LEE (peldaño 2 de la
 * escalera, regla #16). Con la lista vacía no se abre ninguna incidencia: hoy
 * eso deja la función encendida solo en Aumenta, que es lo que se pidió, sin
 * que el CRM tenga que saber quién es Aumenta. Se elige en Configuración →
 * Agenda, así que el día que Olga deje de llevarlo, se cambia sin desplegar.
 *
 * ── LAS DOS FALTAS, NO SOLO LA MALA ─────────────────────────────────────────
 * La incidencia se abre igual si la falta está justificada que si no. No es un
 * castigo: es que las dos hay que gestionarlas —una se recupera con otra cita,
 * la otra hay que reclamarla o cobrarla— y quien lo hace es administración. Lo
 * que cambia es la PRIORIDAD y el texto: la injustificada entra como alta.
 *
 * ── BEST-EFFORT, SIEMPRE ────────────────────────────────────────────────────
 * Nada de esto puede tumbar el PATCH que marca la falta. Si el centro no tiene
 * el módulo, si la tabla no está migrada o si falla la escritura, se marca la
 * falta igual y aquí se devuelve `null`. Marcar la asistencia es la operación
 * principal; la incidencia es el añadido.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La categoría y subcategoría con las que entra: administrativa → Citas. */
export const CATEGORIA_FALTA = "administrativa";
export const SUBCATEGORIA_FALTA = "Citas";

/**
 * A quién se le manda, leído del cliente. Lista de ids de miembros del equipo,
 * sin duplicados y sin basura. Vacía = la función está apagada para este
 * centro, que es el estado de fábrica.
 */
export function responsablesDeIncidenciaPorFalta(tenant) {
  return limpiarResponsables(tenant?.settings?.citas?.incidenciaPorFalta);
}

/**
 * La misma limpieza, sobre una lista suelta: la usa Configuración al guardar,
 * para que lo que se escribe en `settings` tenga exactamente la forma que se
 * lee. Un id repetido o con espacios abriría la incidencia dos veces.
 */
export function limpiarResponsables(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  for (const v of lista) {
    const id = typeof v === "string" ? v.trim() : "";
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Cuándo era la cita, en cristiano y en hora de Madrid. */
export function cuandoEra(scheduledAt) {
  const d = scheduledAt ? new Date(scheduledAt) : null;
  if (!d || Number.isNaN(d.getTime())) return "sin fecha";
  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * El título y el cuerpo de la incidencia. Separado del guardado para poder
 * fijarlo con una prueba: el título es lo único que se lee en el listado, así
 * que tiene que decir las tres cosas —qué pasó, a quién y cuándo— dentro de los
 * 200 caracteres que admite la columna.
 */
export function textoIncidenciaFalta({ justificada, quien, scheduledAt, motivo }) {
  const tipo = justificada ? "Falta justificada" : "Falta injustificada";
  const titulo = `${tipo} · ${quien || "sin ficha"} · ${cuandoEra(scheduledAt)}`.slice(0, 200);
  const cuerpo = [
    justificada
      ? "Falta justificada: se puede recuperar con otra cita. Cuadrar la recuperación y revisar si se cobra."
      : "Falta injustificada: no avisaron. Revisar si se cobra y avisar a la familia.",
    motivo ? `Motivo apuntado: ${motivo}` : null,
    "Incidencia abierta automáticamente al marcar la falta en la agenda.",
  ]
    .filter(Boolean)
    .join("\n");
  return { titulo, cuerpo, prioridad: justificada ? "medium" : "high" };
}

/**
 * Abre la incidencia y avisa por la campana a sus responsables.
 *
 * @returns {Promise<{id: string, responsables: string[]}|null>} `null` si no
 *   procede (sin lista configurada, sin módulo, sin tabla) o si falló: quien
 *   llama solo lo usa para contarlo, nunca para decidir.
 */
export async function abrirIncidenciaPorFalta({
  tenant,
  tenantModels,
  hasModule,
  booking,
  reportedById = null,
  notificar = null,
}) {
  try {
    const responsables = responsablesDeIncidenciaPorFalta(tenant);
    if (!responsables.length) return null;
    if (typeof hasModule === "function" && !hasModule("clinica") && !hasModule("pacientes")) return null;
    const { Incidencia, TeamMember, Patient } = tenantModels ?? {};
    if (!Incidencia || !TeamMember) return null;

    // Solo los que EXISTEN hoy: una persona que se fue del centro dejaría la
    // incidencia sin dueño y sin que nadie lo note.
    const vivos = (
      await TeamMember.findAll({ where: { id: responsables }, attributes: ["id", "userId"] })
    ).filter(Boolean);
    if (!vivos.length) return null;
    const ordenados = responsables.filter((id) => vivos.some((t) => t.id === id));

    // De quién es la falta: el paciente si la cita lo lleva, y si no, el nombre
    // que trae la propia cita (las reservas por internet llegan sin paciente).
    let quien = booking?.clientName || booking?.customerName || null;
    if (booking?.patientId && Patient) {
      const p = await Patient.findByPk(booking.patientId, { attributes: ["firstName", "lastName"] });
      if (p) quien = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || quien;
    }

    const { titulo, cuerpo, prioridad } = textoIncidenciaFalta({
      justificada: booking?.noShowJustified === true,
      quien,
      scheduledAt: booking?.scheduledAt,
      motivo: booking?.noShowReason ?? null,
    });

    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }); // AAAA-MM-DD
    const incidencia = await Incidencia.create({
      incidenceDate: hoy,
      title: titulo,
      description: cuerpo,
      category: CATEGORIA_FALTA,
      subcategory: SUBCATEGORIA_FALTA,
      priority: prioridad,
      status: "pending",
      patientId: booking?.patientId ?? null,
      clientId: booking?.clientId ?? null,
      assignedToId: ordenados[0] ?? null,
      reportedById: reportedById || null,
      comments: [],
    });

    // La pivote del multi-responsable, si el tenant la tiene migrada. El espejo
    // `assignedToId` ya va puesto arriba, así que sin pivote sigue teniendo
    // dueño (ver lib/clinica/incidencias.js).
    if (typeof incidencia.setAssignees === "function") {
      try {
        await incidencia.setAssignees(ordenados);
      } catch {
        /* sin tabla pivote: se queda con el responsable principal */
      }
    }

    if (typeof notificar === "function") {
      const userIds = vivos.map((t) => t.userId).filter(Boolean);
      if (userIds.length) {
        await notificar({
          userIds,
          type: "incidencia_falta",
          title: booking?.noShowJustified === true ? "Falta justificada" : "Falta injustificada",
          body: `${titulo}. Tienes una incidencia abierta.`,
          entityType: "Incidencia",
          entityId: incidencia.id,
        });
      }
    }

    return { id: incidencia.id, responsables: ordenados };
  } catch (err) {
    process.stderr.write(`[citas] no se pudo abrir la incidencia de la falta: ${err.message}\n`);
    return null;
  }
}
