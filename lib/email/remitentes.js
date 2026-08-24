/**
 * lib/email/remitentes.js — con qué dirección puede escribir cada persona.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint que lista los
 * remitentes, el que envía y el que los guarda. Resolver «qué from toca» en
 * cada sitio es como acaban tres pantallas mandando desde tres direcciones
 * distintas sin que nadie lo haya decidido.)
 *
 * ── QUÉ RESUELVE ───────────────────────────────────────────────────────────
 * Hasta el 24/08/2026 un tenant tenía UNA cuenta de correo:
 * `integrations.resendApiKey` con su `resendFromEmail`. Suficiente para avisos
 * automáticos —una factura, un recordatorio— porque siempre salen «del centro».
 *
 * No lo es para escribirle a gente. Pedido de Rodrigo (24/08/2026):
 *
 *   «Ahora mismo solo se permite que las claves de Resend sean de una única
 *    cuenta. Deberíamos poder poner más, y que admin pueda elegir qué correo
 *    usar y que el equipo que tenga un correo asignado solo pueda usar el suyo.»
 *
 * O sea DOS cosas que antes no existían:
 *   1. Cada remitente lleva SU PROPIA clave de Resend (cuentas distintas, no
 *      solo direcciones distintas sobre la misma cuenta).
 *   2. Cada remitente se asigna a personas concretas del equipo.
 *
 * ── QUIÉN VE QUÉ ───────────────────────────────────────────────────────────
 *   · admin           → TODOS los remitentes.
 *   · no admin        → solo aquellos en cuyo `usuarios` esté su id.
 *   · `usuarios: []`  → remitente «del centro»: SOLO admin.
 *
 * Esto último es deliberado y es la parte que importa: la representante que
 * tiene asignado `booking@` no puede escribir desde `prensa@` ni desde el
 * correo de dirección. Se cumple en el SERVIDOR (`resolverRemitente` no lo
 * encuentra y el envío responde 422), no solo escondiendo el selector.
 *
 * ── EL id ES EL CORREO ─────────────────────────────────────────────────────
 * No se generan UUID: la dirección ya es única, no cambia sola, y guardar dos
 * veces la misma lista no duplica nada. Editar la dirección es OTRO remitente,
 * que es exactamente lo que es.
 *
 * ── LAS CLAVES NO SALEN DE AQUÍ ────────────────────────────────────────────
 * `listarRemitentes` devuelve lo que se puede pintar en pantalla y NUNCA la
 * clave. La clave solo la devuelve `resolverRemitente`, que se usa en el
 * servidor justo antes de enviar.
 */

import { decryptSecret, encryptSecret } from "../crypto/secretBox.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_REMITENTES = 20;
const ROLES_ADMIN = new Set(["admin", "owner", "superadmin"]);

export function esEmail(v) {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

/** Un id de usuario tal cual lo guarda master.users (UUID). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deja la lista como se guarda: sin duplicados, sin basura y con un tope.
 *
 * `cifrar` se inyecta para poder probar esto sin claves de verdad. Una clave
 * que llega vacía NO borra la que ya había: quien edita el nombre de un
 * remitente no debería quedarse sin poder enviar por él.
 */
export function normalizarRemitentes(valor, previos = [], cifrar = encryptSecret) {
  if (!Array.isArray(valor)) return { remitentes: [], descartados: [] };

  const antes = new Map(previos.map((r) => [r.id, r]));
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
    const clavePlana = String(bruto?.apiKey ?? "").trim();

    remitentes.push({
      id: email,
      nombre: String(bruto?.nombre ?? "").trim().slice(0, 80) || null,
      email,
      replyTo: esEmail(replyTo) ? replyTo : null,
      // Clave nueva → se cifra. Sin clave nueva → se conserva la de antes.
      apiKey: clavePlana ? cifrar(clavePlana) : (antes.get(email)?.apiKey ?? null),
      usuarios: Array.isArray(bruto?.usuarios)
        ? [...new Set(bruto.usuarios.map((u) => String(u)).filter((u) => UUID_RE.test(u)))]
        : (antes.get(email)?.usuarios ?? []),
    });
  }

  return { remitentes, descartados };
}

/** Lo que hay guardado, ya normalizado en forma pero sin tocar las claves. */
function guardados(ctx) {
  const lista = ctx?.tenant?.settings?.integrations?.remitentes;
  return Array.isArray(lista) ? lista.filter((r) => esEmail(r?.email)) : [];
}

function esAdmin(ctx) {
  return ROLES_ADMIN.has(String(ctx?.user?.role ?? ""));
}

/**
 * Los remitentes que puede usar QUIEN HACE LA PETICIÓN. Nunca lleva la clave.
 *
 * Lista vacía significa que esa persona no puede escribir desde ninguna
 * dirección — y la pantalla tiene que decirlo, no inventarse una.
 */
export function listarRemitentes(ctx) {
  const lista = guardados(ctx);
  const admin = esAdmin(ctx);
  const yo = String(ctx?.user?.id ?? "");

  if (lista.length) {
    const mios = admin ? lista : lista.filter((r) => (r.usuarios ?? []).includes(yo));
    return mios.map((r, i) => ({
      id: String(r.email).toLowerCase(),
      nombre: r.nombre ?? null,
      email: String(r.email).toLowerCase(),
      replyTo: r.replyTo ?? null,
      porDefecto: i === 0,
      // Para que el admin vea de un vistazo qué está a medias. Sin la clave:
      // solo si la hay o no.
      tieneClave: !!r.apiKey,
      // Cuántas personas lo tienen asignado. Solo se le enseña al admin: a un
      // usuario normal no le importa quién más escribe desde ahí.
      ...(admin ? { usuarios: r.usuarios ?? [] } : {}),
    }));
  }

  // Sin lista propia: la cuenta única de siempre, y SOLO para admin. Un usuario
  // normal sin remitente asignado no hereda el correo del centro por accidente.
  if (!admin) return [];
  const { fromEmail, replyTo } = getTenantResendConfig(ctx);
  if (!fromEmail) return [];
  const email = String(fromEmail).trim().toLowerCase();
  return [{ id: email, nombre: null, email, replyTo: replyTo || null, porDefecto: true, tieneClave: true, usuarios: [] }];
}

/**
 * El remitente elegido CON su clave descifrada, listo para enviar.
 *
 * Devuelve `null` cuando el id no está entre los que esa persona puede usar, y
 * eso es lo que impide que alguien mande desde el correo de otro cambiando un
 * campo del formulario. Nunca cae al de por defecto: enviar desde una dirección
 * distinta de la pedida es peor que no enviar.
 */
export function resolverRemitente(ctx, id) {
  const permitidos = listarRemitentes(ctx);
  if (!permitidos.length) return null;

  const elegido = id ? permitidos.find((r) => r.id === String(id).trim().toLowerCase()) : permitidos[0];
  if (!elegido) return null;

  // La clave: la propia del remitente si la tiene; si no, la de la cuenta única
  // del tenant, que es como sigue funcionando quien no ha configurado nada.
  const crudo = guardados(ctx).find((r) => String(r.email).toLowerCase() === elegido.id);
  let apiKey = null;
  if (crudo?.apiKey) {
    try {
      apiKey = decryptSecret(crudo.apiKey).trim() || null;
    } catch {
      apiKey = null;
    }
  }
  if (!apiKey) apiKey = getTenantResendConfig(ctx).apiKey;

  return { ...elegido, apiKey };
}

/** El `from` tal cual lo quiere Resend: «Nombre <correo>» o solo el correo. */
export function formatearFrom(remitente) {
  if (!remitente?.email) return null;
  return remitente.nombre ? `${remitente.nombre} <${remitente.email}>` : remitente.email;
}
