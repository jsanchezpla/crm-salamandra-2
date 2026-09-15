/**
 * lib/buzon/destinatarios.js — a quién le podemos escribir desde el Buzón.
 *
 * (Fichero nuevo en /lib, regla #2: lo usa `/api/admin/buzon/escribir` para
 * los dos desplegables —cliente y persona— y para comprobar en el POST que la
 * persona elegida es de verdad de ese cliente.)
 *
 * 15/09/2026, Rodrigo: «poder escribir a cada empleado de cada tenant desde el
 * buzón de Salamandra sin necesidad de que me hayan abierto un ticket».
 *
 * ── LOS NOMBRES SALEN DE SU SCHEMA, Y SOLO SE LEEN ──────────────────────────
 * `master.users` no tiene nombre: solo el usuario de entrada. El nombre de la
 * persona está en la ficha de equipo de SU schema (`team_members.display_name`,
 * lo mismo que usa `quienEscribe.js` cuando es ella la que nos escribe). Es
 * una LECTURA best-effort: si el cliente no tiene tabla de equipo o su schema
 * no responde, la lista sale con el usuario de entrada y se le puede escribir
 * igual. La única escritura del panel en un schema ajeno sigue siendo la
 * campana de `avisarEnSuCrm.js`.
 */

import { Op } from "sequelize";

import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { esSlugDemo } from "../demo/demos.js";

/** Nosotros no somos un cliente al que escribir. */
const NO_ES_CLIENTE = new Set(["salamandra_solutions"]);

/** Los clientes activos, sin demos ni nosotros, por nombre. */
export async function clientesParaEscribir() {
  const { Tenant } = getMasterModels();
  const filas = await Tenant.findAll({
    where: { status: "active" },
    attributes: ["id", "slug", "name"],
    order: [["name", "ASC"]],
  });
  return filas
    .filter((t) => !NO_ES_CLIENTE.has(t.slug) && !esSlugDemo(t.slug))
    .map((t) => ({ id: t.id, slug: t.slug, nombre: t.name || t.slug }));
}

/** Un cliente de los de arriba, o null. */
export async function clienteParaEscribir(tenantId) {
  const { Tenant } = getMasterModels();
  const t = await Tenant.findOne({ where: { id: tenantId, status: "active" } });
  if (!t || NO_ES_CLIENTE.has(t.slug) || esSlugDemo(t.slug)) return null;
  return t;
}

/**
 * Las personas con cuenta en ese cliente, con su nombre si tiene ficha de
 * equipo. Se dejan fuera las cuentas que solo entran por el back-office: no
 * tienen CRM donde leer el aviso.
 */
export async function personasDelCliente(tenant) {
  const { User } = getMasterModels();
  const usuarios = await User.findAll({
    where: { tenantId: tenant.id, soloBackoffice: { [Op.not]: true } },
    attributes: ["id", "email", "emailContacto", "role"],
  });

  const nombres = new Map();
  try {
    const { models } = getTenantDb(tenant.slug);
    if (models?.TeamMember && usuarios.length) {
      const fichas = await models.TeamMember.findAll({
        where: { userId: usuarios.map((u) => u.id) },
        attributes: ["userId", "displayName"],
      });
      for (const f of fichas) if (f.displayName) nombres.set(f.userId, f.displayName);
    }
  } catch {
    /* sin ficha de equipo se le escribe igual, con su usuario de entrada */
  }

  return usuarios
    .map((u) => ({
      id: u.id,
      nombre: nombres.get(u.id) ?? null,
      usuario: u.email,
      correo: u.emailContacto ?? null,
      rol: u.role,
    }))
    .sort((a, b) => (a.nombre ?? a.usuario).localeCompare(b.nombre ?? b.usuario, "es"));
}
