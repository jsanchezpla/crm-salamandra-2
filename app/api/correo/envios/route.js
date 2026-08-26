import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { assertNotDemoPaidCall } from "../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { sendEmail } from "../../../../lib/email/resendClient.js";
import { esEmail, formatearFrom, resolverRemitente } from "../../../../lib/email/remitentes.js";
import { componerContenido, validarAdjuntos } from "../../../../lib/correo/composicion.js";

/**
 * POST /api/correo/envios — mandar UN mensaje a VARIOS destinatarios.
 *
 * Pedido por Rodrigo el 24/08/2026: «poder unir la cantidad de correos que
 * quiera y elegir con qué correo quiero mandar el mensaje». Y ese mismo día,
 * después de verlo funcionando: «cuando se envíe un correo a un contratante
 * debe quedar reflejado en su ficha de cliente».
 *
 * ── UNO A UNO, NO UN «PARA» CON CIEN DIRECCIONES ───────────────────────────
 * Se manda un correo POR destinatario, aunque cueste más. Meterlos a todos en
 * el mismo `to` enseñaría a cada ayuntamiento la lista entera de los demás
 * —los competidores incluidos— y es, además, un problema de protección de
 * datos. Con copia oculta tampoco: un correo con 80 en oculto va a spam mucho
 * antes que 80 correos normales, y aquí lo que se juega es que la propuesta se
 * lea.
 *
 * ── QUEDA EN LA FICHA ──────────────────────────────────────────────────────
 * Cada envío que acierta con una ficha (el contratante, el cliente, la familia
 * — según el centro) deja una `Interaction` de tipo `email` en ella, con el
 * asunto y desde qué dirección salió. Así la
 * pestaña «Interacciones» de la ficha cuenta la historia completa sin que nadie
 * tenga que apuntarla a mano — que es justo lo que nadie hace.
 *
 * Se casa por correo, mirando tanto el de la ficha como el de sus contactos: en
 * un ayuntamiento se escribe al de Cultura, no al buzón general, y ese envío
 * tiene que aparecer igual en la ficha del ayuntamiento.
 *
 * ── NUNCA REVIENTA A MEDIAS ────────────────────────────────────────────────
 * Un fallo en el destinatario 12 no puede tirar los 40 restantes ni dejar a
 * quien envía sin saber cuáles salieron. Se envían todos, se recoge el
 * resultado de cada uno y se devuelve el desglose.
 *
 * ── EL DRY-RUN NO MIENTE ───────────────────────────────────────────────────
 * `sendEmail` devuelve `{ok:true, dryRun:true}` cuando no hay clave, y eso ya
 * hizo que una pantalla dijera «enviado» con el buzón vacío (03/08/2026). Aquí
 * el dry-run se responde como lo que es: `simulados`, nunca como enviados. Y
 * tampoco se apunta en la ficha: una interacción que dice «se le escribió» sin
 * que saliera nada es peor que no tener ninguna.
 */

const MAX_DESTINATARIOS = 200;
const MAX_ASUNTO = 200;
const MAX_CUERPO = 20000;

/** Fecha de hoy en local, que es la que espera `Interaction.date` (DATEONLY). */
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const POST = withTenant(async (request, _ctxRuta, ctx) => {
  // Escribir a gente exige tener a quién: sin Clientes no hay agenda que valga.
  if (!ctx.hasModule("clients")) throw new ForbiddenError();

  // La demo pública da sesión de admin a cualquiera y el destinatario, asunto y
  // cuerpo vienen en el body: con una clave de Resend puesta, esto sería un
  // relé de spam abierto.
  assertNotDemoPaidCall(ctx, "El envío de correos");

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const asunto = String(body?.asunto ?? "").trim();
  const cuerpo = String(body?.cuerpo ?? "").trim();
  const remitenteId = body?.remitenteId ?? null;

  if (!asunto) throw new ValidationError("El asunto no puede quedar vacío");
  if (asunto.length > MAX_ASUNTO) throw new ValidationError(`El asunto no puede pasar de ${MAX_ASUNTO} caracteres`);
  if (!cuerpo) throw new ValidationError("El mensaje no puede quedar vacío");
  if (cuerpo.length > MAX_CUERPO) throw new ValidationError("El mensaje es demasiado largo");

  // ── Adjuntos (26/08/2026): imágenes y PDF ─────────────────────────────────
  // Un adjunto malo tumba el envío ENTERO antes de mandar nada: mejor que
  // descubrir a mitad de tanda que media lista recibió el correo sin el PDF.
  const adj = validarAdjuntos(body?.adjuntos);
  if (adj.error) throw new ValidationError(adj.error);

  // ── Firma (26/08/2026): el pie de QUIEN ENVÍA, añadido solo ───────────────
  // La casilla de la pantalla manda (`conFirma: false` la quita en un envío
  // concreto), pero por defecto, si esa persona tiene firma guardada, va.
  let firma = null;
  if (body?.conFirma !== false && ctx.user?.id) {
    try {
      const fila = await ctx.tenantModels.CorreoFirma.findOne({ where: { userId: ctx.user.id } });
      if (fila) firma = { html: fila.html, texto: fila.texto, imagen: fila.imagen };
    } catch {
      // Sin firma se puede enviar igual: el pie es un extra, no un requisito.
    }
  }

  // ── Destinatarios: limpiar antes de mirar nada más ────────────────────────
  if (!Array.isArray(body?.destinatarios)) throw new ValidationError("«destinatarios» tiene que ser una lista");

  const vistos = new Set();
  const validos = [];
  const invalidos = [];
  for (const bruto of body.destinatarios) {
    const email = String(typeof bruto === "string" ? bruto : (bruto?.email ?? "")).trim().toLowerCase();
    if (!esEmail(email)) {
      if (email) invalidos.push(email);
      continue;
    }
    if (vistos.has(email)) continue;
    vistos.add(email);
    validos.push({ email, nombre: typeof bruto === "object" ? (bruto?.nombre ?? null) : null });
  }

  if (!validos.length) throw new ValidationError("No hay ni un destinatario válido al que escribir");
  if (validos.length > MAX_DESTINATARIOS) {
    throw new ValidationError(
      `Son ${validos.length} destinatarios y el tope por envío es ${MAX_DESTINATARIOS}. Pártelo en varias tandas.`
    );
  }

  // ── Remitente: el elegido, y si no puede usarlo, se para ──────────────────
  const remitente = resolverRemitente(ctx, remitenteId);
  if (!remitente) {
    throw new ValidationError(
      remitenteId
        ? "No puedes enviar desde esa dirección. Elige una de las que tienes asignadas."
        : "No tienes ninguna dirección de envío asignada. Pídele a administración que te asigne una."
    );
  }
  if (!remitente.apiKey) {
    throw new AppError(
      `El remitente ${remitente.email} no tiene clave de Resend configurada. Se pone en Configuración → Conexiones.`,
      400
    );
  }

  // ── A qué ficha pertenece cada correo ─────────────────────────────────────
  // Se resuelve ANTES de enviar, en dos consultas, y no una por destinatario:
  // con 200 destinatarios serían 400 viajes a la base por gusto.
  const { Client, Contact, Interaction } = ctx.tenantModels;
  const correos = validos.map((d) => d.email);
  const fichaDe = new Map();
  try {
    const clientes = await Client.findAll({
      where: { email: { [Op.in]: correos } },
      attributes: ["id", "email", "name"],
    });
    for (const c of clientes) if (c.email) fichaDe.set(c.email.toLowerCase(), { id: c.id, name: c.name });

    const contactos = await Contact.findAll({
      where: { email: { [Op.in]: correos } },
      attributes: ["id", "email", "name", "clientId"],
      include: [{ model: Client, as: "client", attributes: ["id", "name"], required: true }],
    });
    // La ficha del cliente manda sobre la del contacto solo si no había ya una:
    // escribir al de Cultura de un ayuntamiento se apunta en el ayuntamiento.
    for (const c of contactos) {
      const k = String(c.email).toLowerCase();
      if (!fichaDe.has(k)) fichaDe.set(k, { id: c.client.id, name: c.client.name, persona: c.name });
    }
  } catch {
    // Si esto falla el correo SIGUE saliendo: apuntar en la ficha es un extra,
    // no un requisito para poder escribirle a alguien.
  }

  // ── Envío, uno a uno ──────────────────────────────────────────────────────
  // El contenido es el MISMO para todos, así que se compone UNA vez: el cuerpo
  // en texto y, si hay firma, además en HTML (con la imagen del pie embebida
  // como `cid:`). Los adjuntos van en cada correo.
  const contenido = componerContenido({ cuerpo, firma });
  const attachments = [...adj.adjuntos, ...contenido.adjuntosFirma];

  const enviados = [];
  const simulados = [];
  const fallidos = [];
  const apuntados = [];

  for (const d of validos) {
    let r;
    try {
      r = await sendEmail({
        to: d.email,
        subject: asunto,
        text: contenido.text,
        html: contenido.html || undefined,
        from: formatearFrom(remitente) || undefined,
        replyTo: remitente.replyTo || undefined,
        apiKey: remitente.apiKey,
        tags: [{ name: "module", value: "correo" }],
        attachments: attachments.length ? attachments : undefined,
      });
    } catch (err) {
      // `sendEmail` promete no propagar, pero si algún día lo hace, un envío
      // masivo a medias no puede quedarse sin contar.
      r = { ok: false, error: err?.message || "error inesperado" };
    }

    const ficha = fichaDe.get(d.email) ?? null;

    if (!r.ok) {
      fallidos.push({ email: d.email, nombre: d.nombre, motivo: r.error || "desconocido" });
      continue;
    }
    if (r.dryRun) {
      simulados.push({ email: d.email, nombre: d.nombre });
      continue;
    }

    enviados.push({ email: d.email, nombre: d.nombre, id: r.id ?? null, ficha: ficha?.name ?? null });

    // Solo lo que SALIÓ DE VERDAD se apunta en la ficha.
    if (ficha) {
      try {
        await Interaction.create({
          clientId: ficha.id,
          type: "email",
          date: hoyISO(),
          createdBy: ctx.user?.email ?? null,
          content:
            `Correo enviado desde ${remitente.email}` +
            (ficha.persona ? ` a ${ficha.persona} <${d.email}>` : ` a ${d.email}`) +
            `\nAsunto: ${asunto}` +
            (adj.adjuntos.length
              ? `\nAdjuntos: ${adj.adjuntos.map((a) => a.filename).join(", ")}`
              : "") +
            `\n\n${cuerpo}`,
        });
        apuntados.push(ficha.name);
      } catch {
        // Que no se pueda apuntar no deshace un correo ya enviado.
      }
    }
  }

  // Auditoría: quién escribió, desde qué dirección, a cuántos. NO se guarda el
  // cuerpo — puede llevar datos de la persona y el registro de auditoría se
  // consulta para otra cosa. El asunto sí: es lo que reconoce el envío.
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId: ctx.tenant.id,
      userId: ctx.user?.id ?? null,
      action: "correo.envio_masivo",
      entity: "correo",
      entityId: null,
      before: null,
      after: {
        remitente: remitente.email,
        asunto,
        total: validos.length,
        enviados: enviados.length,
        simulados: simulados.length,
        fallidos: fallidos.length,
        apuntadosEnFicha: apuntados.length,
        adjuntos: adj.adjuntos.length,
        conFirma: !!(firma && (firma.html || firma.imagen)),
      },
    });
  } catch {
    // La auditoría nunca rompe un envío que ya ha salido.
  }

  return ok({
    remitente: { email: remitente.email, nombre: remitente.nombre },
    total: validos.length,
    enviados,
    simulados,
    fallidos,
    // Cuántos quedaron reflejados en una ficha. Se devuelve para que la pantalla
    // pueda decir «38 enviados, 31 apuntados en su ficha»: los 7 que faltan son
    // direcciones sueltas que no son de nadie, y eso es información útil.
    apuntadosEnFicha: apuntados.length,
    // Direcciones que venían mal escritas y ni se intentaron.
    invalidos,
    adjuntos: adj.adjuntos.length,
    conFirma: !!(firma && (firma.html || firma.imagen)),
    dryRun: simulados.length > 0 && enviados.length === 0,
  });
});
