/**
 * lib/billing/cuotasConPacientes.js — traer las cuotas con quién paga y a quién
 * cubren, en dos consultas (09/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad que NECESITA Sequelize de lo
 * que ya decidía `cuotaPacientes.js` en puro. Vivía dentro de
 * `app/api/billing/cuotas/route.js` y ahora la piden tres endpoints —la lista
 * de cuotas, los tipos de cuota y la ficha de un tipo—; copiada tres veces
 * habría acabado diciendo cosas distintas en cada pantalla, que es justo el
 * fallo que arregló `lib/billing/resumenCaja.js` con el Excel del arqueo.)
 *
 * La regla de negocio no está aquí: una cuota sin paciente cubre a los
 * pacientes de su familia, y eso lo dice `cuotaPacientes.js`, con su prueba.
 * Aquí solo se cuelgan los datos para que pueda decirlo.
 */

import { billingHasPatients } from "./patientLink.js";

/** 42P01 = la tabla no existe en este schema (migración sin aplicar). */
function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01";
}

/** El paciente solo se incluye si el tenant tiene módulo asistencial. */
export function includePaciente(tenantModels, hasModule) {
  if (!billingHasPatients(hasModule) || !tenantModels.Patient) return [];
  return [{ model: tenantModels.Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }];
}

/**
 * Los pacientes de cada familia que aparece en la lista, en UNA consulta.
 * Mapa clientId -> [{ id, firstName, lastName }]. Vacío si el centro no tiene
 * módulo asistencial (una gestoría no tiene pacientes) o si la tabla no está.
 */
export async function pacientesPorFamilia({ tenantModels, hasModule, cuotas }) {
  const mapa = new Map();
  if (!billingHasPatients(hasModule) || !tenantModels.Patient) return mapa;
  const ids = [...new Set((cuotas ?? []).map((c) => c.clientId).filter(Boolean))];
  if (!ids.length) return mapa;
  try {
    const filas = await tenantModels.Patient.findAll({
      where: { clientId: ids },
      attributes: ["id", "firstName", "lastName", "clientId"],
      order: [["firstName", "ASC"]],
      raw: true,
    });
    for (const p of filas) {
      const clave = String(p.clientId);
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push({ id: p.id, firstName: p.firstName, lastName: p.lastName });
    }
  } catch (err) {
    // Tenant sin tabla de pacientes migrada: la pantalla sigue como estaba.
    if (!esTablaAusente(err)) throw err;
  }
  return mapa;
}

/**
 * Las cuotas que casan con `where`, ya en JSON, con su familia, su pagador, su
 * paciente y —cuando no tiene— los pacientes de su familia resueltos.
 */
export async function cuotasConPacientes({ tenantModels, hasModule, where = {}, order = [["active", "DESC"], ["startDate", "DESC"]] }) {
  const { Cuota, Client } = tenantModels;
  const cuotas = await Cuota.findAll({
    where,
    include: [
      { model: Client, as: "client", attributes: ["id", "name", "fiscalName", "taxId", "fiscalTaxId"] },
      { model: Client, as: "payer", attributes: ["id", "name", "fiscalName"], required: false },
      ...includePaciente(tenantModels, hasModule),
    ],
    order,
  });
  const familias = await pacientesPorFamilia({ tenantModels, hasModule, cuotas });
  return cuotas.map((c) => ({
    ...c.toJSON(),
    familiaPacientes: familias.get(String(c.clientId)) ?? [],
  }));
}
