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
      // customFields: RESPETA lo existente (arreglo 2026-07-23). Antes el spread
      // de datos.customFields iba al final y machacaba en silencio un motivo/edad
      // ya editados por la nutricionista. Ahora solo se rellenan las claves que
      // falten o esten vacias; `origen` sí se actualiza siempre.
      const previos = client.customFields || {};
      const fusion = { ...previos };
      for (const [k, v] of Object.entries(datos.customFields || {})) {
        const vacio = previos[k] === undefined || previos[k] === null || previos[k] === "";
        if (k === "origen" || vacio) fusion[k] = v;
      }
      parche.customFields = fusion;
      await client.update(parche, { transaction: t });
    } else {
      client = await Client.create(datos, { transaction: t });
      creado = true;
    }

    // Candado de concurrencia (arreglo 2026-07-23): el UPDATE solo afecta si la
    // solicitud SIGUE sin cliente. Si otra peticion (doble clic, dos pestañas)
    // la enlazo primero, afecta 0 filas → lanzamos para hacer ROLLBACK y deshacer
    // el Client.create duplicado. Sin esto se creaban DOS fichas de la misma
    // persona (con su motivo de consulta TCA), una huerfana.
    const [afectadas] = await FormSubmission.update(
      {
        status: "accepted",
        clientId: client.id,
        acceptedAt: new Date(),
        handledBy,
        handledByTeamId,
      },
      { where: { id: submission.id, clientId: null }, transaction: t }
    );
    if (afectadas === 0) {
      const err = new Error("SOLICITUD_YA_ACEPTADA");
      err.code = "SOLICITUD_YA_ACEPTADA";
      throw err; // rollback: deshace el Client.create de esta transaccion perdedora
    }

    return { client, creado };
  }).catch(async (err) => {
    // La transaccion perdedora del doble-clic: releer la ficha ya enlazada y
    // devolverla como "ya estaba", en vez de propagar el error.
    if (err?.code === "SOLICITUD_YA_ACEPTADA") {
      const fresca = await FormSubmission.findByPk(submission.id, { attributes: ["clientId"] });
      const client = fresca?.clientId ? await Client.findByPk(fresca.clientId) : null;
      return { client, creado: false, yaGanada: true };
    }
    throw err;
  });

  return { ...resultado, yaEstaba: Boolean(resultado.yaGanada) };
}
