/**
 * lib/email/remitentes.js — con qué dirección puede escribir cada persona.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint que los lista, el
 * que envía y el que los guarda. Resolver «qué from toca» en cada sitio es como
 * acaban tres pantallas mandando desde tres direcciones sin que nadie lo haya
 * decidido.)
 *
 * ── DOS COSAS DISTINTAS, Y ESA ES LA CLAVE ─────────────────────────────────
 * Rodrigo, 25/08/2026: «quiero tener la posibilidad de poner varias cuentas de
 * Resend (varios dominios) y también varios correos dentro del mismo dominio».
 *
 * Son dos ejes, no uno, y hasta hoy el CRM solo tenía el primero a medias:
 *
 *   CUENTA    = una clave de Resend. Normalmente, un dominio verificado.
 *               `lauraubeda.es` con su clave; `encalvedeindie.com` con la suya.
 *   REMITENTE = una DIRECCIÓN concreta que sale de esa cuenta.
 *               `booking@lauraubeda.es` y `prensa@lauraubeda.es` son dos
 *               remitentes de la MISMA cuenta.
 *
 * La primera versión (24/08) metía la clave dentro de cada remitente, y con eso
 * poner tres direcciones del mismo dominio obligaba a pegar la misma clave tres
 * veces —y a cambiarla en tres sitios el día que rotara—. Separarlo es lo que
 * hace que «varios correos dentro del mismo dominio» sea un botón y no una
 * copia.
 *
 * ── QUIÉN VE QUÉ ───────────────────────────────────────────────────────────
 *   · admin           → TODOS los remitentes.
 *   · no admin        → solo aquellos en cuyo `usuarios` esté su id.
 *   · `usuarios: []`  → remitente «del centro»: SOLO admin.
 *
 * Esto último es la parte que importa: la representante que tiene asignado
 * `booking@` no puede escribir desde `prensa@` ni desde el correo de dirección.
 * Se cumple en el SERVIDOR (`resolverRemitente` no lo encuentra y el envío
 * responde 422), no solo escondiendo el selector.
 *
 * ── LAS CLAVES NO SALEN DE AQUÍ ────────────────────────────────────────────
 * `listarRemitentes` y `listarCuentas` devuelven lo que se puede pintar y NUNCA
 * la clave. La clave solo la devuelve `resolverRemitente`, en el servidor y
 * justo antes de enviar.
 */

import { decryptSecret, encryptSecret } from "../crypto/secretBox.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_CUENTAS = 10;
export const MAX_REMITENTES = 40;
const ROLES_ADMIN = new Set(["admin", "owner", "superadmin"]);

/** La cuenta implícita: la clave única de siempre, para quien no ha migrado. */
export const CUENTA_HEREDADA = "__cuenta_del_centro__";

export function esEmail(v) {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

export function dominioDe(email) {
  return String(email || "").trim().toLowerCase().split("@")[1] ?? "";
}

/** Identificador estable a partir del nombre. Sin tildes, sin espacios. */
export function claveDeNombre(nombre) {
  return String(nombre || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/* ════════════════════════════════════════════════════════════════════════
 * CUENTAS
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Deja la lista de cuentas como se guarda.
 *
 * Una clave que llega vacía NO borra la que ya había: quien corrige el nombre
 * de una cuenta no debería quedarse sin poder enviar por ella.
 */
export function normalizarCuentas(valor, previas = [], cifrar = encryptSecret) {
  if (!Array.isArray(valor)) return { cuentas: [], descartadas: [] };

  const antes = new Map(previas.map((c) => [c.id, c]));
  const cuentas = [];
  const descartadas = [];
  const vistos = new Set();

  for (const bruto of valor) {
    const nombre = String(bruto?.nombre ?? "").trim().slice(0, 60);
    const id = String(bruto?.id ?? "").trim() || claveDeNombre(nombre);
    if (!id || !nombre) {
      descartadas.push(nombre || "(sin nombre)");
      continue;
    }
    if (vistos.has(id)) continue;
    if (cuentas.length >= MAX_CUENTAS) {
      descartadas.push(nombre);
      continue;
    }
    vistos.add(id);

    const clavePlana = String(bruto?.apiKey ?? "").trim();
    cuentas.push({
      id,
      nombre,
      // El dominio es informativo pero se usa para avisar de un remitente que
      // no cuadra con su cuenta, que es el error que Resend devuelve en frío
      // como un 403 sin explicar nada.
      dominio: String(bruto?.dominio ?? "").trim().toLowerCase().replace(/^@/, "").slice(0, 80) || null,
      apiKey: clavePlana ? cifrar(clavePlana) : (antes.get(id)?.apiKey ?? null),
    });
  }

  return { cuentas, descartadas };
}

function cuentasGuardadas(ctx) {
  const lista = ctx?.tenant?.settings?.integrations?.cuentasResend;
  return Array.isArray(lista) ? lista.filter((c) => c?.id && c?.nombre) : [];
}

/**
 * Las cuentas para pintar en Configuración. Nunca con la clave.
 *
 * Si no hay ninguna configurada pero SÍ está la clave única de siempre, se
 * devuelve como una cuenta heredada: así la pantalla enseña lo que hay de
 * verdad en vez de decir «no hay cuentas» a quien lleva meses enviando.
 */
export function listarCuentas(ctx) {
  const propias = cuentasGuardadas(ctx);
  if (propias.length) {
    return propias.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      dominio: c.dominio ?? null,
      tieneClave: !!c.apiKey,
      heredada: false,
    }));
  }

  const { apiKey, fromEmail } = getTenantResendConfig(ctx);
  if (!apiKey) return [];
  return [
    {
      id: CUENTA_HEREDADA,
      nombre: "Cuenta del centro",
      dominio: dominioDe(fromEmail) || null,
      tieneClave: true,
      heredada: true,
    },
  ];
}

/** La clave descifrada de una cuenta. Solo servidor. */
function claveDeCuenta(ctx, cuentaId) {
  if (!cuentaId || cuentaId === CUENTA_HEREDADA) return getTenantResendConfig(ctx).apiKey;
  const cuenta = cuentasGuardadas(ctx).find((c) => c.id === cuentaId);
  if (!cuenta?.apiKey) return null;
  try {
    return decryptSecret(cuenta.apiKey).trim() || null;
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * REMITENTES
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Deja la lista de remitentes como se guarda: sin duplicados y con tope.
 *
 * `cuentaId` se conserva si no llega, igual que las claves: editar el nombre de
 * un remitente no puede desengancharlo de su cuenta.
 */
export function normalizarRemitentes(valor, previos = []) {
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
    remitentes.push({
      id: email,
      nombre: String(bruto?.nombre ?? "").trim().slice(0, 80) || null,
      email,
      replyTo: esEmail(replyTo) ? replyTo : null,
      cuentaId: String(bruto?.cuentaId ?? "").trim() || antes.get(email)?.cuentaId || null,
      usuarios: Array.isArray(bruto?.usuarios)
        ? [...new Set(bruto.usuarios.map((u) => String(u)).filter((u) => UUID_RE.test(u)))]
        : (antes.get(email)?.usuarios ?? []),
    });
  }

  return { remitentes, descartados };
}

function remitentesGuardados(ctx) {
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
  const lista = remitentesGuardados(ctx);
  const admin = esAdmin(ctx);
  const yo = String(ctx?.user?.id ?? "");
  const cuentas = new Map(listarCuentas(ctx).map((c) => [c.id, c]));

  if (lista.length) {
    const mios = admin ? lista : lista.filter((r) => (r.usuarios ?? []).includes(yo));
    return mios.map((r, i) => {
      const cuenta = cuentas.get(r.cuentaId ?? CUENTA_HEREDADA) ?? null;
      const dom = cuenta?.dominio ?? null;
      return {
        id: String(r.email).toLowerCase(),
        nombre: r.nombre ?? null,
        email: String(r.email).toLowerCase(),
        replyTo: r.replyTo ?? null,
        porDefecto: i === 0,
        cuentaId: r.cuentaId ?? null,
        cuentaNombre: cuenta?.nombre ?? null,
        tieneClave: !!cuenta?.tieneClave,
        // Resend rechaza enviar desde un dominio que no está verificado en esa
        // cuenta, y lo hace con un 403 que no explica nada. Avisarlo aquí
        // ahorra media tarde.
        dominioCuadra: !dom || dominioDe(r.email) === dom,
        ...(admin ? { usuarios: r.usuarios ?? [] } : {}),
      };
    });
  }

  // Sin lista propia: la dirección única de siempre, y SOLO para admin. Un
  // usuario normal sin remitente asignado no hereda el correo del centro.
  if (!admin) return [];
  const { fromEmail, replyTo, apiKey } = getTenantResendConfig(ctx);
  if (!fromEmail) return [];
  const email = String(fromEmail).trim().toLowerCase();
  return [
    {
      id: email,
      nombre: null,
      email,
      replyTo: replyTo || null,
      porDefecto: true,
      cuentaId: CUENTA_HEREDADA,
      cuentaNombre: "Cuenta del centro",
      tieneClave: !!apiKey,
      dominioCuadra: true,
      usuarios: [],
    },
  ];
}

/**
 * El remitente elegido CON la clave de SU cuenta, listo para enviar.
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

  return { ...elegido, apiKey: claveDeCuenta(ctx, elegido.cuentaId) };
}

/** El `from` tal cual lo quiere Resend: «Nombre <correo>» o solo el correo. */
export function formatearFrom(remitente) {
  if (!remitente?.email) return null;
  return remitente.nombre ? `${remitente.nombre} <${remitente.email}>` : remitente.email;
}
