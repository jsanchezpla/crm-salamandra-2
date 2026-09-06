import { Op } from "sequelize";
import { puedeAvisar } from "../clients/comunicaciones.js";
import { normalizarEmail } from "./bajaToken.js";

/**
 * lib/mailing/audiencia.js — a QUIÉN se escribe. Es el único sitio por donde
 * se decide (plan 2.2), y por eso pasa por aquí el envío, la vista previa de
 * un segmento y el recuento de la lista.
 *
 * (Fichero nuevo en /lib, regla #2: si el endpoint de «previsualizar segmento»
 * contara con una regla y el envío con otra, el cliente vería «340 personas»
 * y el correo saldría a 290, o peor, a alguien que no debía.)
 *
 * ── DE DÓNDE SALE LA GENTE ─────────────────────────────────────────────────
 *
 *   clientes   Las fichas (`clients`) con correo Y con la casilla «novedades»
 *              marcada en `communication_prefs` (lib/clients/comunicaciones.js,
 *              `puedeAvisar`). NO se copia a ninguna lista: se lee de la ficha
 *              en el momento del envío. Se escribe SOLO al correo principal de
 *              la ficha: el consentimiento es de la familia y lo dio el titular;
 *              los correos de los tutores del JSONB `guardians` no llevan
 *              prueba propia y no se usan.
 *   contactos  Los correos sueltos de `mailing_contacts` en estado `activo`.
 *
 * ── LO QUE SIEMPRE SE QUITA ────────────────────────────────────────────────
 * `mailing_suppressions` se cruza al final, venga de donde venga la dirección.
 * Una baja, un rebote duro o una queja pesan más que cualquier casilla.
 *
 * ── LAS REGLAS DE UN SEGMENTO ──────────────────────────────────────────────
 *   { fuentes: ["clientes","contactos"], modulos: [...], estados: [...],
 *     ultimaCita: { tipo: "hace_menos"|"hace_mas"|"nunca", dias: N } }
 * Todas en Y. Las de módulo, estado y última cita solo afectan a los CLIENTES
 * (un correo suelto no tiene ficha); si el segmento las lleva y las fuentes
 * incluyen contactos, los contactos siguen entrando tal cual. «Última cita» es
 * la última cita PASADA que no se canceló ni fue una falta
 * (`bookings.scheduled_at < ahora`, estado ∉ cancelled/no_show).
 */

export const FUENTES = ["clientes", "contactos"];
export const ESTADOS_CLIENTE = ["active", "inactive", "prospect"];
export const TIPOS_ULTIMA_CITA = ["hace_menos", "hace_mas", "nunca"];
const MODULO_RE = /^[a-z0-9_]{1,50}$/;

/** Deja las reglas como se guardan: lista blanca y valores acotados. */
export function normalizarReglas(reglas) {
  const r = reglas && typeof reglas === "object" ? reglas : {};
  const fuentes = Array.isArray(r.fuentes) ? r.fuentes.filter((f) => FUENTES.includes(f)) : [];
  const modulos = Array.isArray(r.modulos)
    ? [...new Set(r.modulos.map((m) => String(m ?? "").trim()).filter((m) => MODULO_RE.test(m)))].slice(0, 10)
    : [];
  const estados = Array.isArray(r.estados) ? [...new Set(r.estados.filter((e) => ESTADOS_CLIENTE.includes(e)))] : [];
  let ultimaCita = null;
  if (r.ultimaCita && typeof r.ultimaCita === "object" && TIPOS_ULTIMA_CITA.includes(r.ultimaCita.tipo)) {
    const dias = Math.min(3650, Math.max(1, Math.round(Number(r.ultimaCita.dias) || 0)));
    ultimaCita = r.ultimaCita.tipo === "nunca" ? { tipo: "nunca" } : { tipo: r.ultimaCita.tipo, dias };
  }
  return {
    fuentes: fuentes.length ? fuentes : [...FUENTES],
    modulos,
    estados,
    ultimaCita,
  };
}

/** ¿Una ficha entra en la lista? Correo y casilla de novedades. */
export function clienteAceptaNovedades(client) {
  const email = normalizarEmail(client?.email);
  return !!(email && email.includes("@") && puedeAvisar(client, "novedades"));
}

/**
 * Aplica la regla de última cita a un cliente dado el instante de su última
 * cita (o null). Pura, para poder probarla.
 */
export function cumpleUltimaCita(regla, ultima, ahora = new Date()) {
  if (!regla) return true;
  if (regla.tipo === "nunca") return !ultima;
  if (!ultima) return false;
  const limite = new Date(ahora.getTime() - regla.dias * 86400000);
  return regla.tipo === "hace_menos" ? ultima >= limite : ultima < limite;
}

function esTablaAusente(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || code === "42703";
}

/** Última cita pasada y válida por cliente. Map<clientId, Date>. (Lo usan también las secuencias.) */
export async function ultimasCitasPorCliente(ctx, clientIds) {
  const { Booking } = ctx.tenantModels;
  if (!Booking || !clientIds.length) return new Map();
  try {
    const filas = await Booking.findAll({
      attributes: ["clientId", [ctx.tenantSequelize.fn("max", ctx.tenantSequelize.col("scheduled_at")), "ultima"]],
      where: {
        clientId: { [Op.in]: clientIds },
        scheduledAt: { [Op.lt]: new Date() },
        status: { [Op.notIn]: ["cancelled", "no_show"] },
      },
      group: ["client_id"],
      raw: true,
    });
    const mapa = new Map();
    for (const f of filas) {
      const d = f.ultima ? new Date(f.ultima) : null;
      if (d && !Number.isNaN(d.getTime())) mapa.set(f.clientId ?? f.client_id, d);
    }
    return mapa;
  } catch (err) {
    if (esTablaAusente(err)) return new Map(); // centro sin citas: nadie tiene cita
    throw err;
  }
}

/** Clientes con alguno de esos módulos asignados (y activos). Set<clientId>. */
async function clientesConModulo(ctx, modulos) {
  const { ClientModuleAssignment } = ctx.tenantModels;
  try {
    const filas = await ClientModuleAssignment.findAll({
      attributes: ["clientId"],
      where: { moduleKey: { [Op.in]: modulos }, enabled: true },
      raw: true,
    });
    return new Set(filas.map((f) => f.clientId ?? f.client_id));
  } catch (err) {
    if (esTablaAusente(err)) return new Set();
    throw err;
  }
}

/** Todas las direcciones suprimidas, en minúsculas. */
export async function emailsSuprimidos(ctx) {
  const filas = await ctx.tenantModels.MailingSuppression.findAll({ attributes: ["email"], raw: true });
  return new Set(filas.map((f) => normalizarEmail(f.email)));
}

/**
 * Resuelve las reglas a la lista de destinatarios.
 *
 * @returns {Promise<{
 *   destinatarios: Array<{ email: string, nombre: string|null, origen: "cliente"|"contacto", origenId: string }>,
 *   total: number, clientes: number, contactos: number, suprimidos: number, sinCasilla: number,
 * }>}
 */
export async function resolverAudiencia(ctx, reglasCrudas, { conClientes = true } = {}) {
  const reglas = normalizarReglas(reglasCrudas);
  const suprimidos = await emailsSuprimidos(ctx);
  const vistos = new Set();
  const destinatarios = [];
  let clientes = 0;
  let contactos = 0;
  let quitados = 0;
  let sinCasilla = 0;

  if (conClientes && reglas.fuentes.includes("clientes") && ctx.tenantModels.Client) {
    const where = {};
    if (reglas.estados.length) where.status = { [Op.in]: reglas.estados };
    let filas = [];
    try {
      filas = await ctx.tenantModels.Client.findAll({
        attributes: ["id", "name", "email", "status", "communicationPrefs"],
        where,
        order: [["name", "ASC"]],
      });
    } catch (err) {
      if (!esTablaAusente(err)) throw err;
    }

    const aceptan = filas.filter((c) => {
      const ok = clienteAceptaNovedades(c);
      if (!ok && c.email) sinCasilla++;
      return ok;
    });

    let candidatos = aceptan;
    if (reglas.modulos.length) {
      const con = await clientesConModulo(ctx, reglas.modulos);
      candidatos = candidatos.filter((c) => con.has(c.id));
    }
    if (reglas.ultimaCita) {
      const ultimas = await ultimasCitasPorCliente(ctx, candidatos.map((c) => c.id));
      const ahora = new Date();
      candidatos = candidatos.filter((c) => cumpleUltimaCita(reglas.ultimaCita, ultimas.get(c.id) ?? null, ahora));
    }

    for (const c of candidatos) {
      const email = normalizarEmail(c.email);
      if (vistos.has(email)) continue;
      if (suprimidos.has(email)) {
        quitados++;
        continue;
      }
      vistos.add(email);
      clientes++;
      destinatarios.push({ email, nombre: c.name || null, origen: "cliente", origenId: c.id });
    }
  }

  if (reglas.fuentes.includes("contactos")) {
    const filas = await ctx.tenantModels.MailingContact.findAll({
      attributes: ["id", "email", "nombre"],
      where: { estado: "activo" },
      order: [["createdAt", "ASC"]],
    });
    for (const f of filas) {
      const email = normalizarEmail(f.email);
      if (!email || vistos.has(email)) continue;
      if (suprimidos.has(email)) {
        quitados++;
        continue;
      }
      vistos.add(email);
      contactos++;
      destinatarios.push({ email, nombre: f.nombre || null, origen: "contacto", origenId: f.id });
    }
  }

  return { destinatarios, total: destinatarios.length, clientes, contactos, suprimidos: quitados, sinCasilla, reglas };
}

/** Lo mismo pero sin la lista entera: recuento y una muestra para la pantalla. */
export async function contarAudiencia(ctx, reglas, opciones) {
  const r = await resolverAudiencia(ctx, reglas, opciones);
  return {
    total: r.total,
    clientes: r.clientes,
    contactos: r.contactos,
    suprimidos: r.suprimidos,
    sinCasilla: r.sinCasilla,
    muestra: r.destinatarios.slice(0, 8).map((d) => ({ email: d.email, nombre: d.nombre, origen: d.origen })),
    reglas: r.reglas,
  };
}
