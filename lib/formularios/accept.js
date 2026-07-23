/**
 * lib/formularios/accept.js — convertir una solicitud en ficha de cliente.
 *
 * Es el corazón del módulo: lo que hace que "aceptar" signifique algo. Dos
 * decisiones que conviene entender antes de tocar esto:
 *
 * 1. LA TRANSACCIÓN CONTIENE SOLO LO INDIVISIBLE: crear el cliente y marcar la
 *    solicitud como aceptada. Todo lo demás (avisar por correo, dar de alta el
 *    usuario en WordPress) va FUERA y después. Si metiéramos dentro algo que
 *    puede fallar por causas ajenas —una tabla que ese tenant no tiene, un
 *    WordPress caído—, un fallo tonto dejaría a la paciente creada a medias o,
 *    peor, la solicitud reconvertible y dos fichas de la misma persona.
 *
 * 2. `submission.clientId` ES EL CANDADO DE IDEMPOTENCIA. Si tiene valor, esta
 *    solicitud ya se aceptó y no vuelve a crear nada. Protege del doble clic y
 *    de tener la misma solicitud abierta en dos pestañas.
 */

import { Op } from "sequelize";
import { infoAdicional } from "./fields.js";

/**
 * Busca una ficha que ya sea de esta persona, por email o por teléfono.
 * Devuelve el cliente o null. No decide nada: solo informa, para que la
 * nutricionista elija entre crear una nueva o usar la que ya hay.
 */
export async function buscarClienteExistente(Client, { email, phone }) {
  const condiciones = [];
  if (email) condiciones.push({ email: { [Op.iLike]: email } });
  if (phone) condiciones.push({ phone });
  if (condiciones.length === 0) return null;

  return Client.findOne({
    where: { [Op.or]: condiciones },
    attributes: ["id", "name", "email", "phone", "status"],
    order: [["createdAt", "ASC"]],
  });
}

/**
 * Construye el objeto de cliente a partir de la solicitud, sin tocar la base
 * de datos. Separado para poder probarlo y para que el endpoint pueda enseñar
 * una vista previa antes de aceptar.
 */
export function clienteDesdeSolicitud(form, submission) {
  const destinos = {};
  for (const respuesta of submission.answers || []) {
    const campo = (form?.fields || []).find((c) => c.key === respuesta.key);
    if (campo?.mapTo) destinos[campo.mapTo] = respuesta.value;
  }

  const customFields = {};
  if (destinos.age) customFields.edad = destinos.age;
  if (destinos.reason) customFields.motivo = destinos.reason;
  const extra = infoAdicional(form, submission.answers);
  if (extra) customFields.info_adicional = extra;
  // Trazabilidad: de qué solicitud salió esta ficha.
  customFields.origen = `Formulario web · ${submission.formTitle}`;

  return {
    type: "individual",
    name: destinos.name || submission.name || "Sin nombre",
    email: destinos.email || submission.email || null,
    phone: destinos.phone || submission.phone || null,
    status: "active",
    customFields,
  };
}

/**
 * Acepta la solicitud. Si `clientIdExistente` viene informado, NO crea ficha
 * nueva: enlaza la solicitud con esa y le añade lo que contó sin pisar lo que
 * ya hubiera escrito la nutricionista.
 *
 * Devuelve { client, creado, yaEstaba }.
 */
export async function aceptarSolicitud({
  sequelize,
  Client,
  FormSubmission,
  form,
  submission,
  clientIdExistente = null,
  handledBy = null,
  handledByTeamId = null,
}) {
  // Candado: ya se aceptó antes.
  if (submission.clientId) {
    const client = await Client.findByPk(submission.clientId);
    return { client, creado: false, yaEstaba: true };
  }

  const datos = clienteDesdeSolicitud(form, submission);

  const resultado = await sequelize.transaction(async (t) => {
    let client;
    let creado = false;

    if (clientIdExistente) {
      client = await Client.findByPk(clientIdExistente, { transaction: t });
      if (!client) throw new Error("La ficha indicada ya no existe");

      // Se completa lo que falte, nunca se pisa lo que ya hay: si la
      // nutricionista corrigió un teléfono, manda el suyo.
      const parche = {};
      if (!client.email && datos.email) parche.email = datos.email;
      if (!client.phone && datos.phone) parche.phone = datos.phone;
      parche.customFields = { ...(client.customFields || {}), ...datos.customFields };
      await client.update(parche, { transaction: t });
    } else {
      client = await Client.create(datos, { transaction: t });
      creado = true;
    }

    await FormSubmission.update(
      {
        status: "accepted",
        clientId: client.id,
        acceptedAt: new Date(),
        handledBy,
        handledByTeamId,
      },
      { where: { id: submission.id, clientId: null }, transaction: t }
    );

    return { client, creado };
  });

  return { ...resultado, yaEstaba: false };
}
