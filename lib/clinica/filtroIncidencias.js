/**
 * lib/clinica/filtroIncidencias.js — el `where` del listado de incidencias,
 * en un solo sitio (11/09/2026, AV-0125 de Aumenta).
 *
 * (Fichero en `/lib`, regla #2: lo necesitan la lista y su exportación a
 * Excel. La lección está escrita en `app/api/clients/export/route.js`: el Excel
 * de Clientes ignoraba el filtro de visibilidad que la lista sí aplicaba, y
 * era una puerta lateral. Aquí las dos rutas leen los MISMOS parámetros por la
 * MISMA función, y quien no es dirección exporta exactamente lo que ve.)
 *
 * Lo que entra: `status` / `faltas=1`, `category`, `patientId`, `q` (texto:
 * asunto, descripción o nombre del paciente), `reportedById`, `mine=1` o
 * `assignedToId`, y `vistas=1`. Lo que manda por encima de todo: el alcance
 * (`lib/clinica/alcanceIncidencias.js`) — dirección ve todas, el resto las
 * que registró o tiene asignadas.
 */

import { Op } from "sequelize";
import { filtroPorNombre } from "../utils/busquedaDb.js";
import { resolveCurrentTeamMemberId } from "../team/currentTeamMember.js";
import { veTodasLasIncidencias, whereIncidenciasVisibles } from "./alcanceIncidencias.js";
import { idsVistasPor } from "./incidenciasDe.js";
import { isValidCategory, isValidStatus } from "./incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los include del listado: paciente, responsable principal, quien registró y todos los responsables. */
export const includesDeIncidencias = (M) => [
  { model: M.Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
  { model: M.TeamMember, as: "assignedTo", attributes: ["id", "displayName", "avatarColor"], required: false },
  { model: M.TeamMember, as: "reportedBy", attributes: ["id", "displayName", "avatarColor"], required: false },
  // Multi-responsable (sprint 2026-07-29): una incidencia puede tener varias
  // personas al cargo. `assignedTo` se conserva como espejo del primero para
  // no romper los filtros y las vistas que ya lo usan.
  {
    model: M.TeamMember, as: "assignees",
    attributes: ["id", "displayName", "avatarColor"],
    through: { attributes: [] },
    required: false,
  },
];

/**
 * @param {Request} request
 * @param {URLSearchParams} sp
 * @param {object} M     modelos del tenant
 * @param {object} ctx   el contexto de `withTenant` (para el rol)
 * @returns {{ where: object, yoSoy: string|null, misVistas: string[], verVistas: boolean, esAdmin: boolean }}
 */
export async function whereDeIncidencias({ request, sp, M, ctx }) {
  const { Incidencia } = M;
  const where = {};
  const status = sp.get("status");
  if (status && isValidStatus(status)) where.status = status;
  /*
   * ── LA PESTAÑA «FALTAS» (03/09/2026, AV-0038 de Aumenta) ─────────────────
   * Las incidencias que abre sola la agenda al marcar una falta llevan
   * `falta` (lib/clinica/faltas.js) y viven en su pestaña: `?faltas=1` las
   * devuelve SOLO a ellas, y sin el parámetro las de siempre las excluyen.
   * Dos listas, no una con etiqueta: es lo que pidió Olga («un apartado
   * distinto de incidencias por las faltas»).
   */
  const soloFaltas = sp.get("faltas") === "1";
  where.falta = soloFaltas ? { [Op.ne]: null } : null;
  const category = sp.get("category");
  if (category && isValidCategory(category)) where.category = category;
  const patientId = sp.get("patientId");
  if (patientId && UUID_RE.test(patientId)) where.patientId = patientId;

  /*
   * BUSCAR POR TEXTO (02/09/2026, AV-0011 de Aumenta): «encontrar una por
   * asunto, paciente o cualquier palabra, sin leerlas todas». 34 incidencias
   * en dos días, y las faltas automáticas la hacen crecer sola.
   *
   * La misma regla que el buscador de Clientes y el de facturas —todas las
   * palabras, cada una en cualquier campo, sin importar tildes—, sobre el
   * asunto y la descripción, O el nombre del paciente (por su tabla, como
   * hacen las facturas). Entra como AND para no pisar los demás filtros.
   */
  const q = (sp.get("q") || "").trim();
  if (q) {
    const porTexto = await filtroPorNombre(Incidencia.sequelize, q, ["Incidencia.title", "Incidencia.description"]);
    const alternativas = porTexto ? [porTexto] : [];
    if (M.Patient) {
      // Best-effort, como en lib/clients/familiasPorPaciente.js: un centro sin
      // tabla de pacientes (42P01) sigue buscando por asunto y descripción.
      try {
        const porPaciente = await filtroPorNombre(M.Patient.sequelize, q, ["Patient.first_name", "Patient.last_name"]);
        if (porPaciente) {
          const pacientes = await M.Patient.findAll({ where: porPaciente, attributes: ["id"], limit: 300, raw: true });
          if (pacientes.length) alternativas.push({ patientId: { [Op.in]: pacientes.map((p) => p.id) } });
        }
      } catch (e) {
        if (e?.original?.code !== "42P01" && e?.parent?.code !== "42P01") throw e;
      }
    }
    if (alternativas.length) (where[Op.and] ||= []).push(alternativas.length === 1 ? alternativas[0] : { [Op.or]: alternativas });
  }

  // Quién la registró (31/08/2026, Rodrigo): la pareja del filtro de
  // responsable — «las que he mandado yo u otra persona a una persona
  // concreta» son los dos filtros combinados. Este es columna directa: a
  // diferencia del responsable, quien registra es siempre UNO.
  const reportedById = sp.get("reportedById");
  if (reportedById && UUID_RE.test(reportedById)) where.reportedById = reportedById;

  /*
   * Quien mira, para que la pantalla pueda abrirse en LAS MIAS (01/09/2026,
   * Rodrigo: «que de forma predeterminada salgan las que me atanen a mi»). Se
   * devuelve abajo, en `yoSoy`, porque el navegador no tiene forma de saber que
   * miembro del equipo es: /api/auth/me da el usuario, no la ficha de equipo.
   */
  const yoSoy = await resolveCurrentTeamMemberId(request, M);

  // ── Quién ve qué (02/09/2026, Aumenta AV-0018) ────────────────────────────
  // Dirección ve todas; el resto, solo las que registró o tiene asignadas. La
  // regla vive en `lib/clinica/alcanceIncidencias.js` y entra como AND para no
  // pisar el `where.id` que ponen los filtros de abajo. Para quien no es
  // dirección, `mine=1` sobra: su alcance YA es «las mías».
  const esAdmin = veTodasLasIncidencias(ctx);
  if (!esAdmin) (where[Op.and] ||= []).push(await whereIncidenciasVisibles(M, yoSoy));

  /*
   * ── LAS QUE YA HE DADO POR VISTAS (04/09/2026, Rodrigo) ───────────────────
   * «Que le deje de salir»: las que esta persona marcó como vistas se apartan
   * del listado, aunque la incidencia siga abierta para el resto. Apartadas,
   * NO escondidas — `?vistas=1` las devuelve, y su alcance no cambia: una
   * despachada por error se recupera. Ver `lib/clinica/vistoIncidencia.js`.
   */
  const misVistas = await idsVistasPor(M, yoSoy);
  const verVistas = sp.get("vistas") === "1";
  if (misVistas.length && !verVistas) {
    (where[Op.and] ||= []).push({ id: { [Op.notIn]: misVistas } });
  }

  let assignedToId = sp.get("assignedToId");
  if (sp.get("mine") === "1" && esAdmin) {
    /*
     * Sin ficha de equipo —direccion, o quien entra con un usuario que no esta
     * en la plantilla— «las mias» no significa nada, y antes esto ponia un id
     * imposible que devolvia CERO incidencias: la pantalla se abria vacia y
     * parecia que no habia ninguna. Ahora, en ese caso, no se filtra.
     */
    assignedToId = yoSoy || null;
  }
  if (assignedToId && UUID_RE.test(assignedToId)) {
    // Filtra por la tabla PIVOTE, no por `assignedToId`: ese campo solo guarda
    // al responsable PRINCIPAL, así que quien fuera segundo responsable no veía
    // la incidencia en "mis incidencias" — justo lo que el multi-responsable
    // venía a resolver. La migración rellenó la pivote con los responsables
    // antiguos, así que las incidencias de siempre siguen saliendo.
    if (M.IncidenciaAssignee) {
      const enlaces = await M.IncidenciaAssignee.findAll({
        where: { teamMemberId: assignedToId },
        attributes: ["incidenciaId"],
      });
      where.id = { [Op.in]: enlaces.map((e) => e.incidenciaId) };
    } else {
      where.assignedToId = assignedToId; // tenant sin migrar
    }
  }

  return { where, yoSoy, misVistas, verVistas, esAdmin };
}
