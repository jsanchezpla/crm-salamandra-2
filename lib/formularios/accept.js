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
import { infoAdicional, RELACION_ES_EL_PACIENTE, RELACION_A_TUTOR } from "./fields.js";
import { partirNombre } from "../clients/formularioAlta.js";
import { normalizeContactValue, validateContactValue, setPrimaryContactValue } from "../clients/contactMethods.js";

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
  /*
   * El parentesco de quien rellenó el formulario (08/08/2026).
   *
   * ⚠️ Y NO un tutor en `Client.guardians`, aunque sea tentador: quien rellena
   * el formulario es la persona TITULAR de la ficha (su nombre es `name`, su
   * DNI es `taxId`, su teléfono y su correo son los de la ficha). Crear un
   * tutor con esos mismos datos sería la misma persona escrita dos veces en
   * dos sitios que no se hablan —editar el teléfono en la ficha no tocaría el
   * del tutor— y, además, un tutor firmante cambia quién tiene que firmar el
   * contrato del portal: `effectiveSigners` deja de devolver al titular en
   * cuanto hay uno marcado. Aquí se guarda QUÉ es de la criatura, que es el
   * dato que falta, y el titular sigue siendo el titular.
   */
  const relacion = destinos.relationship;
  if (relacion && relacion !== RELACION_ES_EL_PACIENTE) {
    customFields.parentescoTitular = RELACION_A_TUTOR[relacion] ?? "otro";
  }
  const extra = infoAdicional(form, submission.answers);
  if (extra) customFields.info_adicional = extra;
  // Trazabilidad: de qué solicitud salió esta ficha.
  //
  // ⚠️ La clave es `origin`, con i (arreglo 2026-08-08). Se escribía `origen`
  // mientras la ficha pintaba `origin`, así que la procedencia se guardaba y no
  // se veía en ninguna parte; y como el PUT rellenaba `origin` con "manual"
  // cuando faltaba, la primera edición dejaba a una familia llegada por la web
  // registrada como alta a mano. Un script aparte repara las que ya están así.
  customFields.origin = `Formulario web · ${submission.formTitle}`;

  return {
    type: "individual",
    name: destinos.name || submission.name || "Sin nombre",
    email: destinos.email || submission.email || null,
    phone: destinos.phone || submission.phone || null,
    // DNI del tutor. Va a `taxId`, que es el campo de documento que la ficha ya
    // pinta y del que el contrato lee al firmar: pedirlo en el formulario y
    // dejarlo en `customFields` obligaría a copiarlo a mano antes de firmar.
    taxId: destinos.taxId || null,
    status: "active",
    customFields,
  };
}

/**
 * El PACIENTE que sale de la solicitud, o el motivo por el que no sale
 * ninguno (08/08/2026). Sin tocar la base de datos, para poder probarlo.
 *
 * Devuelve `{ paciente }` o `{ motivo }`, y el motivo se enseña a quien acepta:
 * un centro que no se entera de que a esa familia no se le ha creado el peque
 * lo descubre tres semanas después, cuando va a citarlo.
 *
 * Motivos posibles:
 *   sin_datos          — el formulario no pregunta por ningún menor
 *   es_el_titular      — contestó «soy yo quien necesita ayuda»
 *   sin_nombre         — dejó en blanco el nombre del peque
 *   nombre_incompleto  — puso solo el nombre, sin apellidos
 */
export function pacienteDesdeSolicitud(form, submission) {
  const destinos = {};
  for (const respuesta of submission.answers || []) {
    const campo = (form?.fields || []).find((c) => c.key === respuesta.key);
    if (campo?.mapTo) destinos[campo.mapTo] = respuesta.value;
  }

  const nombre = String(destinos.patientName ?? "").trim();
  const relacion = destinos.relationship;

  // Las respuestas se guardan con `value: ""` aunque el campo esté vacío, así
  // que «existe la clave» no vale como prueba de que hay un peque: hay que
  // mirar el contenido, o se crearían pacientes con el nombre en blanco (que
  // `allowNull: false` NO rechaza, porque "" no es null).
  if (!relacion && !nombre) return { motivo: "sin_datos" };
  if (relacion === RELACION_ES_EL_PACIENTE) return { motivo: "es_el_titular" };
  if (!nombre) return { motivo: "sin_nombre" };

  const { firstName, lastName } = partirNombre(nombre);
  // Misma regla que el alta de mostrador (`normalizarPacientes`): un paciente
  // necesita nombre y apellidos. Y NO se le prestan los de la familia: con
  // padres separados o apellidos distintos sería meter un dato falso en la
  // ficha de un menor.
  if (!firstName || !lastName) return { motivo: "nombre_incompleto" };

  const edad = Number.parseInt(String(destinos.patientAge ?? "").trim(), 10);

  return {
    paciente: {
      firstName: firstName.slice(0, 120),
      lastName: lastName.slice(0, 120),
      age: Number.isInteger(edad) && edad >= 0 && edad <= 120 ? edad : null,
      referralReason: destinos.reason ? String(destinos.reason).slice(0, 5000) : null,
    },
  };
}

/**
 * Materializa un valor como método de contacto PRINCIPAL. Se usa solo con
 * fichas RECIÉN creadas.
 *
 * ⚠️ Los dos tipos o ninguno. `setPrimaryContactValue` termina llamando a
 * `syncClientMirror`, que recalcula `clients.email` Y `clients.phone` a partir
 * de las filas que haya: materializar solo el correo pondría el teléfono a
 * NULL. Por eso esta función recibe los dos juntos y no se puede invocar a
 * medias por descuido.
 */
async function materializarContactos({ client, ClientContactMethod, email, phone, etiqueta, transaction }) {
  const hecho = { email: false, phone: false };
  if (!ClientContactMethod) return hecho;
  for (const [kind, bruto] of [["email", email], ["phone", phone]]) {
    const value = normalizeContactValue(kind, bruto);
    if (!value) continue;
    // Un correo con una errata en la ficha es un incordio; una FILA con una
    // errata es peor, porque el portal busca por ahí. Si no valida, se queda
    // en la columna y no se materializa.
    if (validateContactValue(kind, value)) continue;
    await setPrimaryContactValue({ client, ClientContactMethod, kind, value, label: etiqueta, transaction });
    hecho[kind] = true;
  }
  return hecho;
}

/**
 * Acepta la solicitud. Si `clientIdExistente` viene informado, NO crea ficha
 * nueva: enlaza la solicitud con esa y le añade lo que contó sin pisar lo que
 * ya hubiera escrito la nutricionista.
 *
 * Devuelve { client, creado, yaEstaba, resultado }.
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
  /**
   * Con qué profesional va esta paciente (06/08/2026, Rodrigo). Se elige al
   * aceptar porque es el momento en que alguien mira el caso y decide; y a
   * partir de ahí la agenda pública le enseña solo los huecos de esa persona.
   *
   * `null` = sin asignar, que es lo que pasa en una consulta de una sola
   * profesional o si quien acepta no lo decide todavía. Nadie queda bloqueado
   * por no elegir: sin asignar se ve la agenda del centro, como siempre.
   */
  asignarA = null,
  /**
   * Modelos OPCIONALES que el endpoint pasa solo si el cliente los tiene
   * (08/08/2026). Van como parámetro y no se resuelven aquí a propósito:
   *
   *   · `ClientContactMethod` — sin él la ficha nace con el correo y el
   *     teléfono en su columna pero sin filas, y la sección «Contactos» de la
   *     ficha sale vacía, porque lee las filas y no la columna.
   *   · `Patient` — el MODELO está registrado en todos los clientes, pero la
   *     TABLA solo existe donde está el módulo `pacientes`. Si se resolviera
   *     aquí dentro, un cliente sin la tabla reventaría con 42P01 DENTRO de la
   *     transacción y se perdería la aceptación entera. El endpoint lo pasa
   *     solo tras comprobar `hasModule("pacientes")`, ANTES de abrir nada.
   */
  ClientContactMethod = null,
  Patient = null,
}) {
  // Candado: ya se aceptó antes.
  if (submission.clientId) {
    const client = await Client.findByPk(submission.clientId);
    return { client, creado: false, yaEstaba: true };
  }

  const datos = clienteDesdeSolicitud(form, submission);
  if (asignarA) datos.assignedTeamMemberId = asignarA;

  const delPaciente = pacienteDesdeSolicitud(form, submission);

  const resultado = await sequelize.transaction(async (t) => {
    let client;
    let creado = false;
    const parte = {
      contactos: { email: false, phone: false },
      paciente: { creado: false, motivo: null },
    };

    if (clientIdExistente) {
      client = await Client.findByPk(clientIdExistente, { transaction: t });
      if (!client) throw new Error("La ficha indicada ya no existe");

      // Se completa lo que falte, nunca se pisa lo que ya hay: si la
      // nutricionista corrigió un teléfono, manda el suyo.
      const parche = {};
      // La profesional SÍ se pisa si viene elegida: quien acepta la solicitud
      // la acaba de decidir mirando el caso, y es más reciente que lo que
      // hubiera. El resto de campos siguen la regla de solo rellenar huecos.
      if (asignarA) parche.assignedTeamMemberId = asignarA;
      if (!client.email && datos.email) parche.email = datos.email;
      if (!client.phone && datos.phone) parche.phone = datos.phone;
      if (!client.taxId && datos.taxId) parche.taxId = datos.taxId;
      // customFields: RESPETA lo existente (arreglo 2026-07-23). Antes el spread
      // de datos.customFields iba al final y machacaba en silencio un motivo/edad
      // ya editados por la nutricionista. Ahora solo se rellenan las claves que
      // falten o esten vacias; `origin` sí se actualiza siempre.
      const previos = client.customFields || {};
      const fusion = { ...previos };
      for (const [k, v] of Object.entries(datos.customFields || {})) {
        const vacio = previos[k] === undefined || previos[k] === null || previos[k] === "";
        if (k === "origin" || vacio) fusion[k] = v;
      }
      parche.customFields = fusion;
      await client.update(parche, { transaction: t });

      /*
       * ⚠️ AQUÍ NO SE MATERIALIZA NADA, y es la decisión importante de este
       * bloque. `setPrimaryContactValue` no AÑADE: actualiza el valor del
       * método principal y después `syncClientMirror` reescribe con él la
       * columna de la ficha. En una ficha que ya existe eso contradice la
       * regla de tres líneas más arriba —«nunca se pisa lo que ya hay»— y no
       * es cosmético: `clients.email` es la llave del área privada de la
       * familia (lib/citas/portalClient.js). Una paciente que reenvía el
       * formulario con su correo antiguo se quedaría fuera del portal, y quien
       * aceptó la solicitud no tendría forma de saber que ha sido él.
       *
       * Su motivo va en el parte, para que quien acepta lo lea en pantalla.
       */
      parte.contactos.motivo = "ficha_existente";
      parte.paciente.motivo = "ficha_existente";
    } else {
      client = await Client.create(datos, { transaction: t });
      creado = true;

      // Ficha NUEVA: no hay nada que pisar, así que el correo y el teléfono se
      // materializan como métodos principales. Sin esto la sección «Contactos»
      // de la ficha nace vacía aunque el dato esté en su columna.
      parte.contactos = await materializarContactos({
        client,
        ClientContactMethod,
        email: datos.email,
        phone: datos.phone,
        etiqueta: "Formulario web",
        transaction: t,
      });

      // El paciente, solo donde hay módulo `pacientes` (lo decide el endpoint
      // pasando o no el modelo) y solo con nombre y apellidos de verdad.
      if (!Patient) {
        parte.paciente.motivo = "sin_modulo";
      } else if (delPaciente.motivo) {
        parte.paciente.motivo = delPaciente.motivo;
      } else {
        await Patient.create({ ...delPaciente.paciente, clientId: client.id }, { transaction: t });
        parte.paciente.creado = true;
      }
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

    return { client, creado, parte };
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

/**
 * El parte en cristiano, para enseñárselo a quien acaba de aceptar. Aceptar ya
 * no hace UNA cosa (crear la ficha) sino cuatro, y algunas pueden no ocurrir
 * por motivos legítimos: hay que decirlo en el momento, no dejar que se
 * descubra el día que alguien va a citar a un peque que no existe.
 */
export function frasesDelParte(parte) {
  if (!parte) return [];
  const frases = [];

  if (parte.contactos?.email || parte.contactos?.phone) {
    const cuales = [parte.contactos.email && "el correo", parte.contactos.phone && "el teléfono"]
      .filter(Boolean)
      .join(" y ");
    frases.push(`Se ha guardado ${cuales} en sus contactos.`);
  }

  const motivosPaciente = {
    sin_modulo: null, // este cliente no lleva pacientes: no hay nada que decir
    ficha_existente: "Se ha usado una ficha que ya existía, así que no se ha creado ningún paciente nuevo.",
    sin_datos: null, // el formulario no pregunta por menores
    es_el_titular: "No se ha creado paciente: dijo que viene para sí misma.",
    sin_nombre: "No se ha creado paciente: dejó en blanco el nombre del peque. Hay que añadirlo a mano.",
    nombre_incompleto: "No se ha creado paciente: puso el nombre del peque sin apellidos. Hay que añadirlo a mano.",
  };

  if (parte.paciente?.creado) {
    frases.push("Se ha creado la ficha del paciente.");
  } else if (parte.paciente?.motivo && motivosPaciente[parte.paciente.motivo]) {
    frases.push(motivosPaciente[parte.paciente.motivo]);
  }

  return frases;
}
