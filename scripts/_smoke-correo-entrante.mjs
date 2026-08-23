/**
 * _smoke-correo-entrante.mjs — la segunda puerta del módulo Soporte.
 *
 * Soporte se vende con dos vías de entrada: el portal y el correo. El portal se
 * clica y se ve; el correo entra por un webhook que nadie mira, y hasta hoy no
 * había forma de saber si funcionaba sin montar el dominio de recepción entero
 * en Resend. Esto lo ejercita de punta a punta contra el endpoint REAL, con
 * cuerpos firmados como los firma Resend (svix), sin depender de que exista
 * ningún dominio ni ninguna cuenta.
 *
 * Lo que fija, caso por caso:
 *
 *   FIRMA      sin firma / firma falsa / firma vieja (>5 min) → 401 y nada entra.
 *   ENCAMINADO un correo a una captura de un tenant que no existe, o de uno sin
 *              el módulo, se ignora con 200 (Resend no debe reintentar nunca).
 *   ALTA       correo nuevo de un cliente → ABRE ticket, canal "email".
 *   HILO       la respuesta del mismo remitente cae en SU ticket, no en uno nuevo.
 *   ASUNTO     "TK-0007" en el asunto manda sobre el remitente.
 *   EQUIPO     si escribe alguien del equipo, el mensaje es del EQUIPO, marca la
 *              primera respuesta y deja el ticket esperando al cliente.
 *   REPETIDO   el mismo correo dos veces (reintento del webhook) no duplica.
 *   CITA       la cadena citada del reply no se guarda.
 *
 * Requiere el servidor de desarrollo levantado y, en `.env.local`,
 * RESEND_WEBHOOK_SECRET y RESEND_INBOUND_DOMAIN (los valores no importan: solo
 * tienen que existir y coincidir con los del servidor).
 *
 * Uso:  node --env-file=.env.local scripts/_smoke-correo-entrante.mjs [slug]
 *
 * Limpia lo que crea: al terminar borra sus tickets y su miembro de equipo.
 */

import { createHmac, randomUUID } from "node:crypto";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { captureAddress } from "../lib/support/notify.js";

const SLUG = process.argv[2] || "demo"; // antes «sandbox», que no existe ni en local ni en prod (19/08/2026)
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const RUTA = "/api/webhooks/resend-inbound";

const SECRETO = process.env.RESEND_WEBHOOK_SECRET || "";
const DOMINIO = (process.env.RESEND_INBOUND_DOMAIN || "").trim().toLowerCase();

// Marca para reconocer y borrar lo que crea esta prueba.
const MARCA = `smoke-entrante-${Date.now()}`;
const CLIENTE = `${MARCA}@example.com`;
const DEL_EQUIPO = `${MARCA}-equipo@example.com`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

/**
 * Firma igual que svix: HMAC-SHA256 sobre "id.timestamp.cuerpo" con el secreto
 * decodificado de base64. Es la misma cuenta que hace el endpoint al verificar,
 * escrita aquí aparte a propósito: si algún día una de las dos cambia, esto
 * salta.
 */
function firmar({ id, ts, cuerpo }) {
  const key = Buffer.from(SECRETO.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${cuerpo}`).digest("base64");
  return `v1,${sig}`;
}

/** Entrega un correo al endpoint. `romper` altera la firma a propósito. */
async function entregar(email, { romper = null } = {}) {
  const cuerpo = JSON.stringify({ type: "email.received", data: email });
  const id = `msg_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  let ts = Math.floor(Date.now() / 1000);
  if (romper === "viejo") ts -= 600; // 10 min: fuera de la ventana de ±5

  let firma = firmar({ id, ts, cuerpo });
  if (romper === "falsa") firma = "v1,ZmFsc2FmYWxzYWZhbHNhZmFsc2FmYWxzYWZhbHNhZmE=";

  const headers = { "content-type": "application/json" };
  if (romper !== "sin-firma") {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = String(ts);
    headers["svix-signature"] = firma;
  }

  const r = await fetch(BASE + RUTA, { method: "POST", headers, body: cuerpo });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: r.status, json };
}

/** Un correo mínimo con lo que manda Resend. */
function correo({ de, deNombre = null, para, asunto, texto }) {
  return {
    from: deNombre ? { email: de, name: deNombre } : de,
    to: [para],
    subject: asunto,
    text: texto,
  };
}

async function main() {
  process.stdout.write(`\n═══ Smoke: correo entrante de Soporte (${SLUG}) ═══\n`);

  if (!SECRETO || !DOMINIO) {
    process.stderr.write(
      "\n✗ Faltan RESEND_WEBHOOK_SECRET y/o RESEND_INBOUND_DOMAIN en el entorno.\n" +
        "  Sin ellas el endpoint contesta 503 y no hay nada que probar.\n\n"
    );
    process.exit(1);
  }

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ No existe el tenant "${SLUG}" en esta base de datos.\n\n`);
    process.exit(1);
  }

  const { models } = getTenantDb(SLUG);
  const { Ticket, TicketMessage, TeamMember } = models;

  const captura = `soporte-${SLUG}@${DOMINIO}`;
  process.stdout.write(`  dirección de captura: ${captura}\n`);

  // Alguien del equipo con correo conocido, para el caso del remitente interno.
  await TeamMember.create({ displayName: "Smoke Entrante", email: DEL_EQUIPO });

  const creados = [];

  try {
    // ── 0. Media configuración no vale ─────────────────────────────────────
    //
    // Es el estado peligroso: con solo el dominio puesto, la configuración de
    // Soporte le enseña al cliente su dirección de captura y le pide que
    // reenvíe ahí su buzón, mientras el webhook contesta 503 a cada entrega.
    // El correo se pierde entero y en silencio.
    paso("Con media configuración, la dirección de captura NO se publica");
    {
      const dominio = process.env.RESEND_INBOUND_DOMAIN;
      const secreto = process.env.RESEND_WEBHOOK_SECRET;
      esperar(!!captureAddress(SLUG), "con las dos variables, sí hay dirección");

      delete process.env.RESEND_WEBHOOK_SECRET;
      esperar(captureAddress(SLUG) === null, "sin el secreto del webhook, no hay dirección", String(captureAddress(SLUG)));
      process.env.RESEND_WEBHOOK_SECRET = secreto;

      delete process.env.RESEND_INBOUND_DOMAIN;
      esperar(captureAddress(SLUG) === null, "sin el dominio, tampoco", String(captureAddress(SLUG)));
      process.env.RESEND_INBOUND_DOMAIN = dominio;
    }

    // ── 1. La firma ────────────────────────────────────────────────────────
    paso("Sin una firma buena no entra nada");
    {
      const base = correo({ de: CLIENTE, para: captura, asunto: "Intento", texto: "hola" });
      for (const [modo, titulo] of [
        ["sin-firma", "sin cabeceras de firma"],
        ["falsa", "con una firma inventada"],
        ["viejo", "con una firma de hace 10 minutos (replay)"],
      ]) {
        const r = await entregar(base, { romper: modo });
        esperar(r.status === 401, `${titulo} → 401`, `salió ${r.status}`);
      }
      const cuantos = await Ticket.count({ where: { requesterEmail: CLIENTE } });
      esperar(cuantos === 0, "y ninguno de los tres ha creado ticket", `hay ${cuantos}`);
    }

    // ── 2. A quién va dirigido ─────────────────────────────────────────────
    paso("Un correo mal dirigido se ignora, pero con un 200");
    {
      const sinCaptura = correo({ de: CLIENTE, para: "otra-cosa@example.com", asunto: "X", texto: "y" });
      const r1 = await entregar(sinCaptura);
      esperar(r1.status === 200 && r1.json?.data?.processed === false, "sin dirección de captura → 200 e ignorado", JSON.stringify(r1.json));

      const inventado = correo({ de: CLIENTE, para: `soporte-no_existe_jamas@${DOMINIO}`, asunto: "X", texto: "y" });
      const r2 = await entregar(inventado);
      esperar(r2.status === 200 && r2.json?.data?.processed === false, "tenant que no existe → 200 e ignorado", JSON.stringify(r2.json));

      // Un 4xx/5xx aquí pondría a Resend a reintentar para siempre correos que
      // nunca vamos a querer. Por eso el 200 es la respuesta correcta.
      ok("(el 200 es a propósito: un error deja a Resend reintentando eternamente)");
    }

    // ── 3. Email-to-ticket ─────────────────────────────────────────────────
    paso("Un correo de un cliente ABRE su ticket");
    let ticket;
    {
      const r = await entregar(
        correo({
          de: CLIENTE,
          deNombre: "Familia de prueba",
          para: captura,
          asunto: "No puedo entrar en el portal",
          texto: "Buenos días:\n\nLlevo dos días sin poder entrar.\n\nGracias.",
        })
      );
      esperar(r.status === 200 && r.json?.data?.action === "ticket_creado", "se abre el ticket", JSON.stringify(r.json));

      ticket = await Ticket.findOne({ where: { requesterEmail: CLIENTE }, order: [["createdAt", "DESC"]] });
      if (!ticket) {
        mal("no aparece el ticket en la base de datos");
        return;
      }
      creados.push(ticket.id);
      esperar(ticket.channel === "email", "queda marcado como canal «email»", ticket.channel);
      esperar(ticket.status === "open", "y abierto", ticket.status);
      esperar(ticket.title === "No puedo entrar en el portal", "con el asunto como título", ticket.title);
      esperar(ticket.requesterName === "Familia de prueba", "y el nombre de quien escribe", String(ticket.requesterName));
      esperar(!!ticket.portalToken, "con su enlace de portal, para poder seguirlo sin correo");
      esperar(!!ticket.firstResponseDueAt && !!ticket.resolutionDueAt, "y con los plazos de SLA puestos");
    }

    // ── 4. La respuesta cae en el hilo ─────────────────────────────────────
    paso("Lo siguiente que escriba cae en SU hilo, no en otro ticket");
    {
      const r = await entregar(
        correo({
          de: CLIENTE,
          para: captura,
          asunto: "Re: No puedo entrar en el portal",
          texto:
            "Ya lo he probado y sigue igual.\n\n" +
            "El lun, 14 ago 2026 a las 9:12, Soporte escribió:\n> ¿Has probado a reiniciar?",
        })
      );
      esperar(r.status === 200 && r.json?.data?.action === "respuesta_cliente", "entra como respuesta del cliente", JSON.stringify(r.json));

      const cuantos = await Ticket.count({ where: { requesterEmail: CLIENTE } });
      esperar(cuantos === 1, "y NO ha abierto un segundo ticket", `hay ${cuantos}`);

      const ultimo = await TicketMessage.findOne({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]] });
      esperar(ultimo?.authorType === "client", "el autor es el cliente", String(ultimo?.authorType));
      esperar(ultimo?.via === "email", "y consta que llegó por correo", String(ultimo?.via));
      esperar(
        !!ultimo && !ultimo.body.includes("¿Has probado a reiniciar?"),
        "la cadena citada del reply NO se guarda",
        String(ultimo?.body)
      );
    }

    // ── 5. Reintento del webhook ───────────────────────────────────────────
    paso("El mismo correo dos veces no se apunta dos veces");
    {
      const igual = correo({ de: CLIENTE, para: captura, asunto: "Re: otra vez", texto: "Este texto se manda dos veces seguidas." });
      const primero = await entregar(igual);
      const antes = await TicketMessage.count({ where: { ticketId: ticket.id } });
      const segundo = await entregar(igual);
      const despues = await TicketMessage.count({ where: { ticketId: ticket.id } });
      esperar(primero.json?.data?.processed === true, "el primero entra");
      esperar(segundo.json?.data?.reason === "duplicado", "el segundo se reconoce como duplicado", JSON.stringify(segundo.json));
      esperar(antes === despues, "y no deja mensaje nuevo", `${antes} → ${despues}`);
    }

    // ── 6. El número del asunto manda ──────────────────────────────────────
    paso("El número del ticket en el asunto manda sobre el remitente");
    {
      const otro = await Ticket.create({
        title: `${MARCA} otro hilo`,
        description: "creado por la prueba",
        priority: "medium",
        status: "open",
        channel: "portal",
        portalToken: randomUUID().replace(/-/g, ""),
        requesterName: "Otra persona",
        requesterEmail: `${MARCA}-otro@example.com`,
        lastMessageAt: new Date(),
      });
      creados.push(otro.id);

      const r = await entregar(
        correo({
          de: CLIENTE, // el remitente tiene SU propio ticket abierto...
          para: captura,
          asunto: `Re: [TK-${String(otro.number).padStart(4, "0")}] lo del número`,
          texto: "Esto tiene que caer en el ticket del asunto.",
        })
      );
      esperar(r.status === 200, "el correo entra", String(r.status));
      const cuantos = await TicketMessage.count({ where: { ticketId: otro.id } });
      esperar(cuantos === 1, "…y cae en el ticket del ASUNTO, no en el del remitente", `${cuantos} mensajes`);
    }

    // ── 7. Cuando quien escribe es del equipo ──────────────────────────────
    paso("Si contesta alguien del equipo desde su buzón, se nota");
    {
      const r = await entregar(
        correo({
          de: DEL_EQUIPO,
          para: captura,
          asunto: `Re: [TK-${String(ticket.number).padStart(4, "0")}] No puedo entrar en el portal`,
          texto: "Buenos días, ya le hemos restablecido el acceso.",
        })
      );
      esperar(r.json?.data?.action === "respuesta_equipo", "entra como respuesta del EQUIPO", JSON.stringify(r.json));

      const ultimo = await TicketMessage.findOne({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]] });
      esperar(ultimo?.authorType === "team", "el autor es el equipo", String(ultimo?.authorType));
      esperar(ultimo?.authorEmail === DEL_EQUIPO, "con su correo a la vista, para saber quién escribió", String(ultimo?.authorEmail));

      await ticket.reload();
      esperar(!!ticket.firstResponseAt, "cuenta como primera respuesta del SLA");
      esperar(ticket.status === "waiting", "y el ticket queda esperando al cliente", ticket.status);
    }

    paso("Un correo interno suelto NO abre ticket");
    {
      const antes = await Ticket.count();
      const r = await entregar(
        correo({ de: DEL_EQUIPO, para: captura, asunto: `${MARCA} copia interna`, texto: "Os reenvío esto para que conste." })
      );
      const despues = await Ticket.count();
      esperar(r.json?.data?.processed === false, "se ignora", JSON.stringify(r.json));
      esperar(antes === despues, "y no crea ruido en la bandeja", `${antes} → ${despues}`);
    }

    // ── 8. Reabrir ─────────────────────────────────────────────────────────
    paso("Si el cliente vuelve a escribir, el ticket se REABRE");
    {
      await ticket.update({ status: "resolved", resolvedAt: new Date() });
      await entregar(
        correo({ de: CLIENTE, para: captura, asunto: "Re: sigue pasando", texto: "Pues me ha vuelto a pasar esta mañana." })
      );
      await ticket.reload();
      esperar(ticket.status === "open", "vuelve a estar abierto", ticket.status);
      esperar(ticket.resolvedAt === null, "y deja de constar como resuelto", String(ticket.resolvedAt));
    }
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    paso("Limpieza");
    const suyos = await Ticket.findAll({
      where: { requesterEmail: [CLIENTE, `${MARCA}-otro@example.com`] },
      attributes: ["id"],
    });
    const ids = [...new Set([...creados, ...suyos.map((t) => t.id)])];
    if (ids.length) {
      await TicketMessage.destroy({ where: { ticketId: ids } });
      await Ticket.destroy({ where: { id: ids } });
    }
    await TeamMember.destroy({ where: { email: DEL_EQUIPO } });
    ok(`borrados ${ids.length} ticket(s) de prueba y el miembro de equipo`);
  }
}

main()
  .then(async () => {
    process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
    await closeAllConnections().catch(() => {});
    await getMasterDb().close().catch(() => {});
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    process.stderr.write(`\n✗ Se ha roto: ${err.stack || err.message}\n\n`);
    await closeAllConnections().catch(() => {});
    process.exit(1);
  });
