/**
 * IA del módulo Soporte (Claude, clave BYOK del tenant): resumen del hilo,
 * borrador de respuesta y clasificación de tickets nuevos. Mismo patrón que el
 * resto del CRM (outreach/clínica): proveedor compartido `complete()`, pedir
 * SOLO lo necesario, parsear defensivo, nunca romper el flujo del caller.
 *
 * Nada de esto se dispara solo, con UNA excepción documentada: la
 * clasificación automática de tickets del portal cuando el tenant activa
 * `support_settings.auto_classify` (opt-in explícito, default apagado).
 */

import { complete } from "../outreach/analysis/anthropic.js";

function stripFences(s) {
  return String(s ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/** Hilo en texto plano para los prompts (con notas internas marcadas). */
function threadAsText(ticket, messages, { includeInternal = true } = {}) {
  const lines = [
    `Asunto: ${ticket.title}`,
    ticket.description ? `Descripción inicial: ${ticket.description}` : null,
    "",
  ];
  for (const m of messages) {
    if (m.isInternal && !includeInternal) continue;
    const who =
      m.authorType === "client"
        ? `CLIENTE (${m.authorName || "sin nombre"})`
        : m.authorType === "system"
          ? "SISTEMA"
          : `EQUIPO (${m.authorName || "agente"})`;
    lines.push(`${who}${m.isInternal ? " [NOTA INTERNA]" : ""}: ${m.body}`, "");
  }
  return lines.filter((l) => l !== null).join("\n").slice(0, 24_000);
}

/** Resumen breve del hilo, para abrir un ticket largo sin leerlo entero. */
export async function ticketAiSummary({ ticket, messages, apiKey, model }) {
  const raw = await complete({
    system:
      "Eres el asistente de un equipo de soporte. Resume el hilo de un ticket en español, en 3-5 frases: qué pide el cliente, qué se ha hecho ya y qué falta. Sin markdown, sin encabezados, texto plano directo. No inventes nada que no esté en el hilo.",
    user: threadAsText(ticket, messages),
    model,
    maxTokens: 700,
    apiKey,
  });
  return String(raw).trim();
}

/** Borrador de respuesta al cliente. El agente lo revisa SIEMPRE antes de enviar. */
export async function ticketAiDraft({ ticket, messages, apiKey, model }) {
  const raw = await complete({
    system:
      "Eres un agente de soporte al cliente. Escribe en español un borrador de respuesta al cliente para el último mensaje pendiente del hilo. Tono profesional y cercano, tuteo, directo al grano. Solo el cuerpo del mensaje: sin asunto, sin firma, sin markdown. Si en el hilo falta información para resolver, la respuesta debe pedir exactamente lo que falta. No prometas plazos ni compensaciones que no aparezcan en el hilo.",
    user: threadAsText(ticket, messages),
    model,
    maxTokens: 900,
    apiKey,
  });
  return String(raw).trim();
}

/**
 * ── MODO DEMO (simulado) ────────────────────────────────────────────────────
 * La demo pública enseña la IA sin llamar a la API real (demoForcesFakeAi,
 * mismo patrón que outreach/fake.js): respuestas deterministas construidas con
 * los datos reales del ticket. Sin coste, sin clave, sin 401.
 */

export function fakeTicketAiSummary({ ticket, messages }) {
  const publicos = messages.filter((m) => !m.isInternal && m.authorType !== "system");
  const delCliente = publicos.filter((m) => m.authorType === "client").length;
  const delEquipo = publicos.filter((m) => m.authorType === "team").length;
  const quien = ticket.requesterName || "El cliente";
  const partes = [
    `${quien} pide ayuda con: ${ticket.title.toLowerCase().replace(/\.$/, "")}.`,
    ticket.description ? `Detalla que ${String(ticket.description).slice(0, 140).toLowerCase()}${ticket.description.length > 140 ? "…" : ""}` : null,
    delEquipo > 0
      ? `El equipo ha respondido ${delEquipo === 1 ? "una vez" : `${delEquipo} veces`} y hay ${delCliente} ${delCliente === 1 ? "mensaje" : "mensajes"} del cliente.`
      : "Todavía no hay respuesta del equipo: ese es el siguiente paso.",
    ticket.status === "waiting" ? "Ahora mismo la pelota está en el tejado del cliente." : null,
  ];
  return partes.filter(Boolean).join(" ");
}

export function fakeTicketAiDraft({ ticket }) {
  const nombre = (ticket.requesterName || "").split(" ")[0] || "hola";
  return [
    `Hola ${nombre === "hola" ? "" : nombre},`.replace(" ,", ","),
    "",
    `Gracias por escribirnos sobre "${ticket.title}". Lo hemos revisado y ya estamos con ello.`,
    "",
    "Para avanzar más rápido nos ayudaría que nos confirmaras desde cuándo pasa y, si puedes, una captura de pantalla de lo que ves.",
    "",
    "En cuanto lo tengamos te decimos algo por aquí mismo.",
  ].join("\n");
}

export function fakeTicketAiClassify({ ticket, categories }) {
  const texto = `${ticket.title} ${ticket.description || ""}`.toLowerCase();
  const porNombre = (frag) => (categories || []).find((c) => c.name.toLowerCase().includes(frag))?.id ?? null;
  let categoryId = null;
  if (/factur|cobro|cargo|recibo|cuota/.test(texto)) categoryId = porNombre("factur");
  else if (/error|fallo|no funciona|no conecta|ca[ií]d/.test(texto)) categoryId = porNombre("cnica");
  else if (/pedido|entrega|env[ií]o/.test(texto)) categoryId = porNombre("pedido");
  if (!categoryId) categoryId = porNombre("consulta");
  const priority = /urgente|ca[ií]d|bloquea|no podemos|par[oa]d/.test(texto)
    ? "high"
    : /duda|consulta|pregunta|descuento/.test(texto)
      ? "low"
      : "medium";
  return { priority, categoryId };
}

/**
 * Clasifica un ticket nuevo: prioridad + categoría (de las del tenant).
 * Devuelve { priority, categoryId } con null donde no haya criterio; el caller
 * decide si aplicar. Falla → null (el ticket se queda como estaba).
 */
export async function ticketAiClassify({ ticket, categories, apiKey, model }) {
  const cats = (categories || []).map((c) => ({ id: c.id, name: c.name }));
  try {
    const raw = await complete({
      system: `Clasificas tickets de soporte. Devuelve SOLO un JSON válido (sin texto alrededor, sin markdown) con esta forma exacta:
{"priority": "low|medium|high|critical", "categoryId": "<id de la lista o null>"}

Criterio de prioridad: critical = servicio caído o impacto grave inmediato; high = bloquea trabajo pero hay rodeo; medium = molesta pero se puede trabajar; low = duda, mejora o consulta. Si dudas entre dos, elige la menor. categoryId debe ser EXACTAMENTE uno de los ids dados, o null si ninguna encaja.`,
      user: `Categorías disponibles:\n${JSON.stringify(cats)}\n\nTicket:\nAsunto: ${ticket.title}\nDescripción: ${ticket.description || "(sin descripción)"}`,
      model,
      maxTokens: 200,
      apiKey,
    });
    const parsed = JSON.parse(stripFences(raw));
    const priority = ["low", "medium", "high", "critical"].includes(parsed?.priority) ? parsed.priority : null;
    const categoryId = cats.some((c) => c.id === parsed?.categoryId) ? parsed.categoryId : null;
    return { priority, categoryId };
  } catch {
    return null;
  }
}
