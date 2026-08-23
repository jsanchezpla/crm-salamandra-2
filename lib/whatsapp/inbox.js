/**
 * lib/whatsapp/inbox.js — de un payload de Meta a filas de `whatsapp_messages`.
 *
 * (Fichero nuevo en /lib, regla #2: `webhookAuth.js` decide QUIÉN puede
 * escribir, `whatsappConfig.js` sabe MANDAR, y esto sabe INTERPRETAR lo que
 * llega. El endpoint queda como lo que debe ser: firma, despacho y 200.)
 *
 * ── SE GUARDA TODO, SE INTERPRETA LO QUE SE PUEDA ────────────────────────────
 * WhatsApp tiene una docena larga de tipos de mensaje y Meta añade más. Aquí se
 * extrae el texto de los que sabemos leer y se deja el payload entero en `raw`
 * para el resto. Un mensaje de un tipo que no conocemos se guarda igual, con el
 * cuerpo vacío: perderlo por no saber pintarlo sería el fallo que este módulo
 * viene a evitar.
 *
 * Los ADJUNTOS no se descargan. Bajar una foto exige pedírsela a Meta con el
 * token del cliente y guardarla en disco con su cuota — eso es otro trabajo, y
 * hacerlo dentro del webhook lo dejaría colgado de una descarga mientras Meta
 * espera respuesta. Queda el id del medio en `raw` para ir a por él después.
 */

/** Solo dígitos. Meta manda `34689628353`; las fichas, cualquier cosa. */
export function soloDigitos(v) {
  return String(v ?? "").replace(/\D/g, "");
}

/**
 * ¿De quién es este teléfono?
 *
 * `Client.phone` es texto libre: ahí hay "+34 689 62 83 53", "689628353" y
 * "0034689628353". Se comparan los ÚLTIMOS 9 DÍGITOS, que es el número nacional
 * en España, normalizando los dos lados en la propia consulta.
 *
 * **Si casan dos fichas, devuelve null.** Un número compartido —una pareja, una
 * empresa familiar— no se resuelve adivinando: es preferible un mensaje sin
 * asignar, que se ve y se corrige, que un mensaje colgado de la ficha
 * equivocada, que es una fuga de datos entre pacientes. Mismo criterio que
 * `backfill-patients-client.js` con los pacientes ambiguos.
 */
/**
 * Nombre de tabla CUALIFICADO con su schema.
 *
 * ⚠️ Hace falta en todo SQL crudo. El `searchPath` de la instancia solo lo
 * aplica Sequelize a las consultas del MODELO: en SQL crudo la conexión no lo
 * lleva puesto y un `FROM clients` a secas falla con «no existe la relación».
 * Falló así al escribir esto, y en silencio —la búsqueda traga el error y
 * devuelve null—, o sea que el síntoma no era un 500 sino TODOS los mensajes
 * entrando sin paciente asignado.
 */
function tablaDe(modelo) {
  const t = modelo.getTableName();
  return typeof t === "string" ? `"${t}"` : `"${t.schema}"."${t.tableName}"`;
}

/** Ids de fichas cuyo teléfono acaba en `cola`, en una tabla concreta. */
async function candidatosEn(ctx, sql, cola) {
  try {
    const [filas] = await ctx.tenantSequelize.query(sql, { replacements: { cola } });
    return filas.map((f) => f.id);
  } catch (err) {
    // Un schema sin esa tabla (migración sin pasar) no debe tumbar la búsqueda
    // entera: se sigue con las demás fuentes.
    process.stderr.write(`[whatsapp:inbox] búsqueda de ficha: ${err.message}\n`);
    return [];
  }
}

export async function buscarClientePorTelefono(ctx, telefono) {
  const cola = soloDigitos(telefono).slice(-9);
  if (cola.length < 9) return null;

  const { Client, ClientContactMethod } = ctx?.tenantModels ?? {};
  if (!Client) return null;

  const ids = new Set();

  // 1) El teléfono principal de la ficha.
  for (const id of await candidatosEn(
    ctx,
    `SELECT id FROM ${tablaDe(Client)}
      WHERE phone IS NOT NULL
        AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = :cola
      LIMIT 3`,
    cola
  )) ids.add(id);

  // 2) Y sus teléfonos SECUNDARIOS. Sin esto, asignar una conversación a mano
  //    no serviría de nada: el siguiente mensaje del mismo número volvería a
  //    entrar sin ficha, y la bandeja de sin asignar sería una noria.
  if (ClientContactMethod) {
    for (const id of await candidatosEn(
      ctx,
      `SELECT DISTINCT client_id AS id FROM ${tablaDe(ClientContactMethod)}
        WHERE kind = 'phone' AND value IS NOT NULL
          AND right(regexp_replace(value, '\\D', '', 'g'), 9) = :cola
        LIMIT 3`,
      cola
    )) ids.add(id);
  }

  return ids.size === 1 ? [...ids][0] : null;
}

/** La marca de tiempo de Meta (segundos unix, en texto) → Date. */
function fechaDe(ts) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/**
 * El texto legible de un mensaje, según su tipo. Devuelve null cuando no hay
 * nada que leer (una foto sin pie, por ejemplo): el mensaje se guarda igual.
 */
export function textoDe(m) {
  if (!m || typeof m !== "object") return null;
  switch (m.type) {
    case "text":
      return m.text?.body ?? null;
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return m[m.type]?.caption ?? m[m.type]?.filename ?? null;
    case "button":
      return m.button?.text ?? null;
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case "reaction":
      return m.reaction?.emoji ?? null;
    case "location":
      return [m.location?.name, m.location?.address].filter(Boolean).join(" · ") || null;
    case "contacts":
      return (m.contacts ?? []).map((c) => c?.name?.formatted_name).filter(Boolean).join(", ") || null;
    case "order":
      return "(pedido)";
    case "system":
      return m.system?.body ?? null;
    default:
      return null;
  }
}

/**
 * Guarda un mensaje. Idempotente por `wamId`: un reintento de Meta choca contra
 * el UNIQUE y se ignora en silencio, que es justo lo que queremos.
 *
 * @returns "guardado" | "duplicado" | "error"
 */
export async function guardarMensaje(ctx, { mensaje, direction, origin, telefono }) {
  const { WhatsappMessage } = ctx.tenantModels;
  const wamId = mensaje?.id;
  if (!wamId) return "error";

  const phone = soloDigitos(telefono);
  const clientId = await buscarClientePorTelefono(ctx, phone);

  try {
    await WhatsappMessage.create({
      wamId,
      direction,
      origin,
      phone,
      clientId,
      type: mensaje.type || "text",
      body: textoDe(mensaje),
      // Un entrante no tiene estado de entrega: ya está aquí.
      status: direction === "in" ? null : "sent",
      sentAt: fechaDe(mensaje.timestamp),
      raw: mensaje,
    });
    return "guardado";
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") return "duplicado";
    process.stderr.write(`[whatsapp:inbox] no se pudo guardar ${wamId}: ${err.message}\n`);
    return "error";
  }
}

/**
 * Acuse de entrega de algo que mandamos (sent → delivered → read, o failed).
 *
 * Si el mensaje no está en la tabla, se CREA la fila con lo que sabemos. Pasa
 * de verdad: hoy `enviarWhatsapp` manda y no guarda nada, así que el primer
 * rastro de un recordatorio va a ser justo este acuse. Tirarlo por no encontrar
 * el original dejaría sin registro precisamente los envíos que fallan, que son
 * los únicos que hay que mirar.
 */
export async function guardarEstado(ctx, estado) {
  const { WhatsappMessage } = ctx.tenantModels;
  const wamId = estado?.id;
  if (!wamId) return "error";

  const error = Array.isArray(estado.errors) ? estado.errors[0] : null;
  const errorMessage = error
    ? [error.title, error.message, error.error_data?.details].filter(Boolean).join(" — ").slice(0, 2000)
    : null;

  try {
    const fila = await WhatsappMessage.findOne({ where: { wamId } });
    if (fila) {
      // Los estados pueden llegar desordenados. `read` no debe retroceder a
      // `delivered` porque un reintento llegue tarde.
      const orden = { sent: 1, delivered: 2, read: 3 };
      const actual = orden[fila.status] ?? 0;
      const nuevo = orden[estado.status] ?? 0;
      if (estado.status === "failed" || nuevo >= actual) {
        await fila.update({ status: estado.status, errorMessage: errorMessage ?? fila.errorMessage });
      }
      return "actualizado";
    }

    const phone = soloDigitos(estado.recipient_id);
    await WhatsappMessage.create({
      wamId,
      direction: "out",
      origin: "api",
      phone,
      clientId: await buscarClientePorTelefono(ctx, phone),
      type: "unknown",
      body: null,
      status: estado.status || null,
      errorMessage,
      sentAt: fechaDe(estado.timestamp),
      raw: estado,
    });
    return "creado";
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") return "duplicado";
    process.stderr.write(`[whatsapp:inbox] estado ${wamId}: ${err.message}\n`);
    return "error";
  }
}

/**
 * Deja constancia de un mensaje que ACABAMOS de mandar desde el CRM.
 *
 * Se llama justo después de que Meta acepte el envío, con el `wamid` que
 * devuelve. Sin esto, el primer rastro de un recordatorio sería su acuse de
 * entrega —que llega segundos después y crea una fila coja, sin texto— y el
 * hilo del paciente saldría lleno de huecos donde el CRM ha escrito.
 *
 * El `clientId` viene DADO por quien manda (la cita ya sabe de quién es), no se
 * busca por teléfono: así funciona igual desde el script del recordatorio, que
 * monta su contexto a mano y no trae `tenantSequelize`.
 *
 * Best-effort: si no se puede guardar, el mensaje YA ha salido. Devolver un
 * error aquí haría creer que no se envió, y lo peor que se puede hacer con un
 * aviso es mandarlo dos veces.
 */
export async function registrarEnviado(ctx, { wamId, telefono, clientId = null, tipo = "template", texto = null }) {
  const WhatsappMessage = ctx?.tenantModels?.WhatsappMessage;
  if (!WhatsappMessage || !wamId) return false;
  try {
    await WhatsappMessage.create({
      wamId,
      direction: "out",
      origin: "api",
      phone: soloDigitos(telefono),
      clientId,
      type: tipo,
      body: texto,
      status: "sent",
      sentAt: new Date(),
    });
    return true;
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") return true;
    process.stderr.write(`[whatsapp:inbox] no se pudo registrar el envío ${wamId}: ${err.message}\n`);
    return false;
  }
}

/**
 * Los mensajes del historial de la coexistencia (los 180 días que Meta
 * sincroniza al conectar una cuenta).
 *
 * La forma del payload se recorre **a la defensiva**: Meta lo entrega por
 * hilos y por fases, y esta parte no se ha podido probar todavía contra un
 * envío real. Se aceptan las dos anidaciones documentadas y lo que no encaje
 * queda registrado en el log con su forma, para poder ajustarlo con un caso
 * real delante en vez de adivinando.
 */
export function mensajesDelHistorial(value) {
  const bloques = Array.isArray(value?.history) ? value.history : [];
  const salida = [];
  for (const bloque of bloques) {
    if (Array.isArray(bloque?.threads)) {
      for (const hilo of bloque.threads) {
        for (const m of hilo?.messages ?? []) salida.push({ mensaje: m, hilo: hilo?.id ?? null });
      }
    } else if (Array.isArray(bloque?.messages)) {
      for (const m of bloque.messages) salida.push({ mensaje: m, hilo: null });
    }
  }
  return salida;
}
