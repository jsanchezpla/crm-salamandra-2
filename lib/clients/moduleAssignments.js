/**
 * lib/clients/moduleAssignments.js — lógica compartida del sprint
 * "Clientes ↔ módulos".
 *
 * (Motivo del fichero nuevo en /lib, regla #2: encapsula la materialización
 * del Patient clínico y la lista de módulos asignables, reutilizada por los
 * endpoints GET/PATCH de asignaciones.)
 *
 * Módulos que un Client puede tener asignados desde su ficha. La mitad de
 * Nutrición es "pertenencia/intención" (la vista /nutricion/asignados sigue
 * siendo plan-céntrica hasta el refactor del siguiente sprint). La de Clínica
 * materializa un Patient enlazado por client_id para que aparezca en Clínica.
 */
export const ASSIGNABLE_MODULE_KEYS = ["nutricion", "clinica"];

/**
 * MARCAS que NO son módulos (12/08/2026, Rodrigo).
 *
 * Viven en la misma tabla y en la misma sección de la ficha que los módulos
 * —para quien la usa son casillas iguales— pero no existen como `moduleKey` en
 * `master.tenant_modules`, así que no se pueden filtrar con `hasModule(k)`: se
 * gatean por el módulo que les da SENTIDO, que es otra cosa.
 *
 * `profesional_salud`: nace del formulario de profesionales de la web de Laura
 * (un nutricionista que pide supervisión, no un paciente). Su único efecto hoy
 * es abrir los tipos de cita reservados a profesionales, así que depende de
 * `citas`: sin agenda no hay nada que abrir y la casilla no se pinta.
 *
 * ⚠️ La marca NO da permisos en el CRM. Es una etiqueta sobre el cliente, igual
 * que «Paciente Nutrición»; lo que decide qué puede reservar es
 * `lib/citas/tiposVisibles.js`, que la consulta.
 */
export const MARCAS_ASIGNABLES = [
  { key: "profesional_salud", requiereModulo: "citas" },
];

/**
 * Las casillas que se pintan en la ficha, en el orden en que se ven.
 *
 * `profesional_salud` va detrás de `nutricion` a propósito (Rodrigo: «justo
 * debajo de Paciente Nutrición»): son las dos que convive un cliente de una
 * consulta de nutrición, y dejarla al final la separaría de la que se le
 * parece.
 */
export function marcasYModulosAsignables(hasModule) {
  if (typeof hasModule !== "function") return [];
  const orden = ["nutricion", "profesional_salud", "clinica"];
  const permitidas = new Set([
    ...ASSIGNABLE_MODULE_KEYS.filter((k) => hasModule(k)),
    ...MARCAS_ASIGNABLES.filter((m) => hasModule(m.requiereModulo)).map((m) => m.key),
  ]);
  return orden.filter((k) => permitidas.has(k));
}

/**
 * Marca al cliente como profesional de la salud si el LEAD del que sale lo era.
 *
 * Se llama al convertir un lead en cliente. El dato se lee del propio lead EN EL
 * SERVIDOR y no del cuerpo de la petición: quien convierte es la pantalla de
 * Leads, y dejar que el navegador dijera «este es profesional» sería dejar que
 * cualquiera con la sesión abierta se abriera los tipos de cita reservados.
 *
 * Best-effort, como el resto de este fichero: un fallo aquí no puede tumbar una
 * conversión que ya creó la ficha. Si no se marca, Laura tiene la casilla en la
 * ficha para hacerlo a mano.
 *
 * @returns {Promise<boolean>} si quedó marcado
 */
export async function marcarProfesionalDesdeLead({ tenantModels, clientId, leadId, userId = null }) {
  const { Lead, ClientModuleAssignment } = tenantModels ?? {};
  if (!Lead || !ClientModuleAssignment || !clientId || !leadId) return false;
  try {
    const lead = await Lead.findByPk(leadId, { attributes: ["id", "customFields"] });
    // `profesionalSalud` lo pone el formulario de profesionales de la web (ver
    // `nutrilaura-leads.php`). Se compara con `true` estricto: un "false" o un
    // "no" de texto no pueden colar como afirmativos.
    if (lead?.customFields?.profesionalSalud !== true) return false;

    await ClientModuleAssignment.findOrCreate({
      where: { clientId, moduleKey: "profesional_salud" },
      defaults: {
        enabled: true,
        assignedAt: new Date(),
        assignedByUserId: userId,
        metadata: { auto: true, desdeLead: leadId },
      },
    });
    return true;
  } catch (err) {
    if (!isMissingTable(err)) {
      process.stderr.write(`[clients:profesional] lead ${leadId} → ${clientId}: ${err.message}\n`);
    }
    return false;
  }
}

/** ¿Este cliente está marcado como profesional de la salud? Nunca lanza. */
export async function esProfesionalDeLaSalud(tenantModels, clientId) {
  const { ClientModuleAssignment } = tenantModels ?? {};
  if (!ClientModuleAssignment || !clientId) return false;
  try {
    const fila = await ClientModuleAssignment.findOne({
      where: { clientId, moduleKey: "profesional_salud", enabled: true },
      attributes: ["id"],
    });
    return !!fila;
  } catch (err) {
    // Tabla sin migrar en un tenant viejo: se responde que NO, que es el lado
    // que cierra la puerta.
    if (!isMissingTable(err)) {
      process.stderr.write(`[clients:profesional] ${clientId}: ${err.message}\n`);
    }
    return false;
  }
}

/**
 * Módulos que se asignan SOLOS al dar de alta un cliente, si el tenant los
 * tiene activos.
 *
 * `nutricion` sí (decisión de nutri_laura, la reina del módulo, 2026-07-27):
 * en una consulta de nutrición TODO cliente nuevo es paciente; obligar a
 * marcar el check a mano hacía que las fichas nuevas no salieran en el
 * buscador de citas hasta que alguien se acordaba.
 *
 * `clinica` NO, a propósito: Aumenta (la reina de clínica) pidió que el
 * paciente sea siempre explícito — quien paga no siempre es quien asiste.
 */
export const AUTO_ASSIGN_MODULE_KEYS = ["nutricion"];

function isMissingTable(err) {
  return err?.parent?.code === "42P01" || err?.original?.code === "42P01";
}

// Divide el nombre del cliente en firstName / lastName para el Patient
// (ambos NOT NULL, VARCHAR(120)). Heurística: primer token = nombre, resto =
// apellidos. Se trunca a 120 para no reventar la columna (un Client.name puede
// llegar a 255) — el terapeuta puede afinarlo luego en la ficha del paciente.
function splitName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  let firstName, lastName;
  if (parts.length === 0) [firstName, lastName] = ["Cliente", "—"];
  else if (parts.length === 1) [firstName, lastName] = [parts[0], "—"];
  else [firstName, lastName] = [parts[0], parts.slice(1).join(" ")];
  return { firstName: firstName.slice(0, 120), lastName: lastName.slice(0, 120) };
}

// Cuenta datos clínicos que impiden borrar el Patient (FK ON DELETE RESTRICT:
// clinic_sessions y clinical_reports). Coordinations es SET NULL → no bloquea.
async function countClinicDeps(tenantModels, patientId, transaction) {
  const { ClinicSession, ClinicalReport } = tenantModels;
  let n = 0;
  if (ClinicSession) n += await ClinicSession.count({ where: { patientId }, transaction });
  if (ClinicalReport) n += await ClinicalReport.count({ where: { patientId }, transaction });
  return n;
}

/**
 * Sincroniza el Patient enlazado a un Client al activar/desactivar 'clinica'.
 *
 * CAMBIO (Sprint Pacientes & Clientes, Fase 1): asignar el módulo YA NO crea ni
 * borra pacientes automáticamente. Aumenta pidió que el paciente sea SIEMPRE
 * explícito (botón "Crear paciente" en la ficha del cliente), porque casi
 * siempre el que paga (cliente) NO es el que asiste (paciente puede ser un hijo,
 * etc.) y un cliente puede tener VARIOS pacientes. El auto-alta creaba un
 * paciente con el nombre del cliente → paciente equivocado o duplicado.
 *
 * Se mantiene la firma/retorno { action } por compatibilidad con el endpoint de
 * asignaciones, pero no toca la tabla `patients`.
 */
export async function syncClinicPatient({ tenantModels, client, enabled, transaction }) {
  // Referencias intencionadamente sin usar: la asignación del módulo ya no
  // materializa pacientes (ver comentario). Los helpers splitName/countClinicDeps
  // se conservan por si un flujo futuro (p. ej. migración) los necesita.
  void tenantModels;
  void client;
  void enabled;
  void transaction;
  return { action: "skip", reason: "explicit_patient_creation" };
}

/**
 * Marca los módulos de AUTO_ASSIGN_MODULE_KEYS en un cliente recién creado.
 *
 * Se llama DESPUÉS de la transacción del alta, nunca dentro: es un extra, y un
 * fallo aquí (tabla sin migrar en un tenant viejo, carrera con otro proceso)
 * no puede tumbar un alta que ya está bien hecha. Por eso es best-effort:
 * captura todo y devuelve la lista de lo que consiguió marcar.
 *
 * IMPORTANTE: decide con `tenantHasModule` (módulo activo en el TENANT), no
 * con `hasModule` (que además exige el moduleAccess del USUARIO que da el
 * alta): si no, el marcado dependería de los permisos de quien crea la ficha
 * y fallaría en silencio.
 */
export async function applyAutoAssignments({ tenantModels, clientId, tenantHasModule, userId = null }) {
  const { ClientModuleAssignment } = tenantModels;
  if (!ClientModuleAssignment || typeof tenantHasModule !== "function") return [];

  const marcados = [];
  for (const moduleKey of AUTO_ASSIGN_MODULE_KEYS) {
    if (!tenantHasModule(moduleKey)) continue;
    try {
      // findOrCreate respeta el único (client_id, module_key): si alguien lo
      // marcó antes (doble clic, import repetido), no duplica ni pisa.
      const [fila, creada] = await ClientModuleAssignment.findOrCreate({
        where: { clientId, moduleKey },
        defaults: { enabled: true, assignedAt: new Date(), assignedByUserId: userId, metadata: { auto: true } },
      });
      if (creada || fila.enabled) marcados.push(moduleKey);
    } catch (err) {
      if (!isMissingTable(err)) {
        process.stderr.write(`[clients:autoAssign] ${moduleKey} en ${clientId}: ${err.message}\n`);
      }
    }
  }
  return marcados;
}

/**
 * Lee las asignaciones de un cliente de forma tolerante a schema parcial: si la
 * tabla no existe todavía en el tenant (42P01) devuelve [].
 */
export async function listAssignments(ClientModuleAssignment, clientId) {
  try {
    return await ClientModuleAssignment.findAll({
      where: { clientId },
      order: [["moduleKey", "ASC"]],
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export { isMissingTable };
