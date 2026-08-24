/**
 * lib/email/remitentes.js — con qué dirección sale un correo del CRM.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint que lista los
 * remitentes, el que envía, y mañana cualquier pantalla que quiera mandar algo.
 * Resolver «qué from toca» en cada sitio es como acaban tres pantallas mandando
 * desde tres direcciones distintas sin que nadie lo haya decidido.)
 *
 * ── QUÉ RESUELVE ───────────────────────────────────────────────────────────
 * Hasta el 24/08/2026 un tenant tenía UN remitente: `integrations.resendFromEmail`,
 * con su `resendReplyTo`. Suficiente para avisos automáticos —una factura, un
 * recordatorio de cita— porque siempre salen «del centro».
 *
 * No lo es para escribirle a gente. Quien manda correos de verdad necesita
 * elegir: la representante escribe a un ayuntamiento desde `booking@`, a un
 * medio desde `prensa@`, y a veces desde su propia dirección porque quiere que
 * le contesten a ella. Pedirlo fue de Rodrigo (24/08/2026): «me gustaría poder
 * elegir con qué correo quiero mandar el mensaje».
 *
 * ── COMPATIBILIDAD HACIA ATRÁS ─────────────────────────────────────────────
 * Nadie tiene `remitentes` configurado todavía, así que si la lista está vacía
 * se DEVUELVE EL DE SIEMPRE como único remitente. Ningún tenant se queda sin
 * poder mandar por no haber tocado la configuración, y los envíos automáticos
 * que ya existen no pasan por aquí: siguen leyendo `getTenantResendConfig`.
 *
 * ── EL id ES EL CORREO ─────────────────────────────────────────────────────
 * No se generan UUID. El identificador de un remitente es su propia dirección
 * en minúsculas, porque es lo único que ya es único, no cambia solo, y hace que
 * guardar dos veces la misma lista no duplique nada. Si alguien edita la
 * dirección es OTRO remitente, que es exactamente lo que es.
 */

import { getTenantResendConfig } from "../outreach/resendConfig.js";

/** Muy permisiva a propósito: la validación de verdad la hace Resend al enviar. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_REMITENTES = 20;

export function esEmail(v) {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

/**
 * Deja la lista como se guarda: sin duplicados, sin basura y con un tope.
 *
 * Se usa al GUARDAR (endpoint de settings). Devuelve `{ remitentes, descartados }`
 * en vez de reventar: que una dirección mal escrita tire toda la configuración
 * sería peor que ignorarla, pero hay que poder decir cuál se ha caído.
 */
export function normalizarRemitentes(valor) {
  if (!Array.isArray(valor)) return { remitentes: [], descartados: [] };

  const remitentes = [];
  const descartados = [];
  const vistos = new Set();

  for (const bruto of valor) {
    const email = String(bruto?.email ?? "").trim().toLowerCase();
    if (!esEmail(email)) {
      descartados.push(String(bruto?.email ?? "(vacío)"));
      continue;
    }
    if (vistos.has(email)) continue;
    if (remitentes.length >= MAX_REMITENTES) {
      descartados.push(email);
      continue;
    }
    vistos.add(email);

    const replyTo = String(bruto?.replyTo ?? "").trim().toLowerCase();
    remitentes.push({
      id: email,
      // El nombre visible es opcional: sin él, Resend enseña la dirección.
      nombre: String(bruto?.nombre ?? "").trim().slice(0, 80) || null,
      email,
      replyTo: esEmail(replyTo) ? replyTo : null,
    });
  }

  return { remitentes, descartados };
}

/**
 * Los remitentes que puede usar este tenant, siempre al menos uno si hay algo
 * configurado. Lista vacía significa que no hay ni remitentes ni el de siempre:
 * la pantalla tiene que decirlo, no inventarse una dirección.
 */
export function listarRemitentes(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};
  const { remitentes } = normalizarRemitentes(integ.remitentes);

  if (remitentes.length) {
    // El primero es el de por defecto. Es una decisión de orden, no un campo
    // más: un booleano `porDefecto` se puede quedar en dos a la vez.
    return remitentes.map((r, i) => ({ ...r, porDefecto: i === 0 }));
  }

  // Sin lista propia: el remitente único de siempre, para no dejar a nadie sin
  // poder mandar por no haber configurado algo que hasta hoy no existía.
  const { fromEmail, replyTo } = getTenantResendConfig(ctx);
  if (!fromEmail) return [];
  const email = String(fromEmail).trim().toLowerCase();
  return [{ id: email, nombre: null, email, replyTo: replyTo || null, porDefecto: true }];
}

/**
 * El remitente elegido, o el de por defecto si no se eligió ninguno.
 *
 * Devuelve `null` cuando el id pedido NO está en la lista, y eso es a propósito:
 * quien llama debe responder 422 en vez de mandar desde otra dirección. Enviar
 * un correo desde un remitente que no era el que se pidió es peor que no
 * enviarlo — puede acabar en la bandeja equivocada de otra persona.
 */
export function resolverRemitente(ctx, id) {
  const lista = listarRemitentes(ctx);
  if (!lista.length) return null;
  if (!id) return lista[0];
  return lista.find((r) => r.id === String(id).trim().toLowerCase()) ?? null;
}

/** El `from` tal cual lo quiere Resend: «Nombre <correo>» o solo el correo. */
export function formatearFrom(remitente) {
  if (!remitente?.email) return null;
  return remitente.nombre ? `${remitente.nombre} <${remitente.email}>` : remitente.email;
}
