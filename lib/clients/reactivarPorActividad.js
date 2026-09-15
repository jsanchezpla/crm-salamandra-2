import { Op } from "sequelize";
import { ACTIVO, ESTADOS_QUE_SE_REACTIVAN } from "./estadoPorActividad.js";

/**
 * lib/clients/reactivarPorActividad.js — quien está En pausa o de Baja vuelve
 * a Activo solo en cuanto entra en una cuota, recibe un cobro o se le da una
 * cita nueva (15/09/2026, Rodrigo: «en el momento en que un cliente en pausa o
 * de baja entre en una cuota o reciba un cobro por alguno de sus pacientes,
 * pasará a estar activo», y después: «una cita nueva también los reactiva»).
 *
 * (Fichero nuevo en /lib, regla #2: va como HOOK de los modelos `Payment`,
 * `Cuota` y `Booking` y no en cada endpoint porque un cobro completado nace por
 * al menos seis caminos —el cajón, el PATCH, «a cuenta», el bono, el webhook de
 * Stripe, la conciliación del banco—, una cita por cinco, y el siguiente que
 * alguien escriba se olvidaría.)
 *
 * Solo sube estados, nunca baja ninguno, y no toca `prospect` (el que pone la
 * tienda a quien compra una vez; en salud se lee como Baja). Va en
 * la MISMA transacción que el cobro o la cuota: si se deshace uno, se deshace
 * el otro.
 */

/** ¿Tiene este schema tabla de pacientes? Se pregunta una vez por conexión. */
const conPacientes = new WeakMap();
async function hayPacientes(Patient) {
  if (!conPacientes.has(Patient)) {
    // Con el schema delante: la conexión del tenant NO lleva `search_path`
    // (cada modelo lo dice en su `schema`), y sin él se preguntaría a `public`.
    const tabla = Patient.options?.schema ? `${Patient.options.schema}.patients` : "patients";
    const [fila] = await Patient.sequelize.query("SELECT to_regclass(:tabla) IS NOT NULL AS hay", {
      type: "SELECT",
      replacements: { tabla },
    });
    conPacientes.set(Patient, Boolean(fila?.hay));
  }
  return conPacientes.get(Patient);
}

/**
 * Reactiva al paciente y a su familia.
 *
 * @param models      los modelos del tenant
 * @param {object} q  { patientId, clientId } — cualquiera de los dos puede faltar
 */
export async function reactivar(models, { patientId = null, clientId = null }, { transaction } = {}) {
  const { Client, Patient } = models;
  const familias = new Set(clientId ? [String(clientId)] : []);

  if (Patient && (await hayPacientes(Patient))) {
    if (patientId) {
      const p = await Patient.findByPk(patientId, { attributes: ["id", "clientId"], transaction });
      if (p?.clientId) familias.add(String(p.clientId));
      await Patient.update(
        { status: ACTIVO },
        { where: { id: patientId, status: { [Op.in]: ESTADOS_QUE_SE_REACTIVAN.patients } }, transaction, hooks: false }
      );
    } else if (clientId) {
      // Un cobro a nombre de la familia sin decir de qué hijo: si solo hay uno,
      // es suyo. Con hermanos no se adivina (la misma regla que Morosidad).
      const hijos = await Patient.findAll({ where: { clientId }, attributes: ["id"], transaction });
      if (hijos.length === 1) {
        await Patient.update(
          { status: ACTIVO },
          { where: { id: hijos[0].id, status: { [Op.in]: ESTADOS_QUE_SE_REACTIVAN.patients } }, transaction, hooks: false }
        );
      }
    }
  }

  if (Client && familias.size) {
    await Client.update(
      { status: ACTIVO },
      { where: { id: { [Op.in]: [...familias] }, status: { [Op.in]: ESTADOS_QUE_SE_REACTIVAN.clients } }, transaction, hooks: false }
    );
  }
}

const cobrado = (p) => p?.status === "completed";
const cuotaViva = (c) => c?.active === true && (!c.endDate || String(c.endDate) >= new Date().toISOString().slice(0, 10));

/**
 * Engancha los hooks. Se llama una vez al montar los modelos del tenant.
 *
 * `Model.update({...}, { where })` no pasa por los hooks de instancia: para
 * eso está `afterBulkUpdate`, que vuelve a leer las filas del WHERE solo
 * cuando lo que se escribió deja el cobro completado o la cuota activa.
 */
export function engancharReactivacion(models) {
  const { Payment, Cuota, Booking } = models;

  /*
   * Y una CITA NUEVA (15/09/2026, Rodrigo: «una cita nueva también los
   * reactiva»). Solo al CREARLA —una a una o la serie entera—: retocar una
   * cita de 2024 no dice que haya vuelto nadie. Una que ya nace cancelada,
   * tampoco.
   */
  if (Booking) {
    const citaViva = (b) => b?.status !== "cancelled";
    Booking.addHook("afterCreate", "reactivarPorCita", async (b, options) => {
      if (!citaViva(b)) return;
      await reactivar(models, { patientId: b.patientId, clientId: b.clientId }, { transaction: options?.transaction });
    });
    Booking.addHook("afterBulkCreate", "reactivarPorCitas", async (filas, options) => {
      const vistos = new Set();
      for (const b of filas) {
        const k = `${b.patientId ?? ""}|${b.clientId ?? ""}`;
        if (!citaViva(b) || vistos.has(k)) continue;
        vistos.add(k);
        await reactivar(models, { patientId: b.patientId, clientId: b.clientId }, { transaction: options?.transaction });
      }
    });
  }

  if (Payment) {
    Payment.addHook("afterSave", "reactivarPorCobro", async (p, options) => {
      // Sin mirar qué cambió: `reactivar` solo toca a quien no está activo, así
      // que repetirlo al retocar las notas de un cobro no escribe nada.
      if (!cobrado(p)) return;
      await reactivar(models, { patientId: p.patientId, clientId: p.clientId }, { transaction: options?.transaction });
    });
    Payment.addHook("afterBulkCreate", "reactivarPorCobros", async (filas, options) => {
      for (const p of filas) {
        if (cobrado(p)) await reactivar(models, { patientId: p.patientId, clientId: p.clientId }, { transaction: options?.transaction });
      }
    });
    Payment.addHook("afterBulkUpdate", "reactivarPorCobrosActualizados", async (options) => {
      if (options?.attributes?.status !== "completed" || !options.where) return;
      const filas = await Payment.findAll({ where: options.where, attributes: ["patientId", "clientId", "status"], transaction: options.transaction, hooks: false });
      for (const p of filas) {
        if (cobrado(p)) await reactivar(models, { patientId: p.patientId, clientId: p.clientId }, { transaction: options.transaction });
      }
    });
  }

  if (Cuota) {
    Cuota.addHook("afterSave", "reactivarPorCuota", async (c, options) => {
      if (!cuotaViva(c)) return;
      await reactivar(models, { patientId: c.patientId, clientId: c.clientId }, { transaction: options?.transaction });
    });
    Cuota.addHook("afterBulkCreate", "reactivarPorCuotas", async (filas, options) => {
      for (const c of filas) {
        if (cuotaViva(c)) await reactivar(models, { patientId: c.patientId, clientId: c.clientId }, { transaction: options?.transaction });
      }
    });
    Cuota.addHook("afterBulkUpdate", "reactivarPorCuotasActualizadas", async (options) => {
      if (options?.attributes?.active !== true || !options.where) return;
      const filas = await Cuota.findAll({ where: options.where, attributes: ["patientId", "clientId", "active", "endDate"], transaction: options.transaction, hooks: false });
      for (const c of filas) {
        if (cuotaViva(c)) await reactivar(models, { patientId: c.patientId, clientId: c.clientId }, { transaction: options.transaction });
      }
    });
  }
}
