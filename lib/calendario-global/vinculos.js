/**
 * lib/calendario-global/vinculos.js — qué calendarios ve cada cuenta desde el
 * calendario global (03/09/2026, Rodrigo).
 *
 * (Carpeta nueva en /lib, regla #2: lo que hay aquí lo llaman cuatro endpoints
 * del host `calendar.`, el endpoint de salto del host del CRM, el script de
 * vincular y el back-office. Es exactamente el caso de «lo usan varios».)
 *
 * ── LA FILA ES LA AUTORIZACIÓN ──────────────────────────────────────────────
 * Una cuenta de `master.users` pertenece a UN tenant; el global lee varios. No
 * se deduce de nada: hay una fila en `master.calendario_global_vinculos` por
 * cada calendario que una cuenta puede ver, y sin fila no se lee ni se mueve
 * nada. Quien la pone es alguien de Salamandra (script o back-office), nunca
 * el propio usuario desde el global.
 */

import { getMasterModels } from "../db/masterDb.js";

/**
 * Paleta por orden para los calendarios sin color propio ni marca. Verdes y
 * tierras primero, que son los de Salamandra; nada de rojo, que en el
 * calendario ya significa «prioridad alta».
 */
export const PALETA = ["#1F3B34", "#3E5C57", "#D9B93E", "#2563EB", "#7C3AED", "#0891B2", "#EA580C", "#DB2777"];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Los calendarios que ve una cuenta, listos para la pantalla y para los
 * endpoints: uno por tenant activo con vínculo, con su nombre, su color y si
 * tiene el módulo `calendar` encendido (sin él se lista, pero apagado, para
 * que se vea POR QUÉ no salen sus eventos).
 *
 * Un tenant que ya no existe o no está activo se ignora sin fallar: la fila
 * no tiene FK a propósito (ver el modelo).
 */
export async function vinculosDe(usuarioId) {
  if (!usuarioId) return [];
  const { CalendarioGlobalVinculo, Tenant, TenantModule, User } = getMasterModels();

  const filas = await CalendarioGlobalVinculo.findAll({
    where: { usuarioId },
    order: [["orden", "ASC"], ["createdAt", "ASC"]],
  });
  if (!filas.length) return [];

  const tenantIds = filas.map((f) => f.tenantId);
  const [tenants, modulos, cuentas] = await Promise.all([
    Tenant.findAll({ where: { id: tenantIds, status: "active" } }),
    TenantModule.findAll({ where: { tenantId: tenantIds, moduleKey: "calendar" } }),
    User.findAll({
      where: { id: filas.map((f) => f.tenantUsuarioId).filter(Boolean) },
      attributes: ["id", "tenantId", "email", "soloBackoffice"],
    }),
  ]);
  const tenantPorId = new Map(tenants.map((t) => [t.id, t]));
  const calendarioPorTenant = new Map(modulos.map((m) => [m.tenantId, !!m.enabled]));
  const cuentaPorId = new Map(cuentas.map((u) => [u.id, u]));

  const out = [];
  filas.forEach((f, i) => {
    const tenant = tenantPorId.get(f.tenantId);
    if (!tenant) return;
    // La cuenta de salto tiene que SER de ese tenant y no ser de back-office:
    // si alguien cambió la fila a mano, el botón no sale y no se salta a nadie.
    const cuenta = f.tenantUsuarioId ? cuentaPorId.get(f.tenantUsuarioId) : null;
    const cuentaValida = !!cuenta && cuenta.tenantId === tenant.id && !cuenta.soloBackoffice;
    out.push({
      id: f.id,
      slug: tenant.slug,
      nombre: tenant.name,
      tenantId: tenant.id,
      color: colorDe(f, tenant, i),
      orden: f.orden,
      calendario: calendarioPorTenant.get(tenant.id) === true,
      tenantUsuarioId: cuentaValida ? cuenta.id : null,
      tenantUsuarioEmail: cuentaValida ? cuenta.email : null,
    });
  });
  return out;
}

function colorDe(fila, tenant, i) {
  if (fila.color && HEX.test(fila.color)) return fila.color;
  const marca = tenant.settings?.brand?.primaryColor;
  if (typeof marca === "string" && HEX.test(marca)) return marca;
  return PALETA[i % PALETA.length];
}

/** El vínculo concreto de una cuenta con un tenant, o null. */
export async function vinculoDe(usuarioId, slug) {
  const todos = await vinculosDe(usuarioId);
  return todos.find((v) => v.slug === slug) ?? null;
}

/**
 * Da de alta (o corrige) un vínculo. `emailTenant` es la cuenta CON LA QUE se
 * salta a ese tenant; se comprueba que exista y que sea de ese tenant, porque
 * una fila apuntando a una cuenta ajena es una sesión ajena a un clic.
 */
export async function vincular({ usuarioId, slug, emailTenant = null, color = null, orden = null }) {
  const { CalendarioGlobalVinculo, Tenant, User } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) throw new Error(`No existe el tenant '${slug}'`);

  let tenantUsuarioId = null;
  if (emailTenant) {
    const u = await User.findOne({
      where: { email: String(emailTenant).trim().toLowerCase() },
      attributes: ["id", "tenantId", "soloBackoffice"],
    });
    if (!u) throw new Error(`No existe la cuenta '${emailTenant}'`);
    if (u.tenantId !== tenant.id) throw new Error(`La cuenta '${emailTenant}' no es del tenant '${slug}'`);
    if (u.soloBackoffice) throw new Error(`La cuenta '${emailTenant}' es de back-office: no puede abrir sesión en el CRM`);
    tenantUsuarioId = u.id;
  }
  if (color && !HEX.test(color)) throw new Error(`Color inválido '${color}' (formato #RRGGBB)`);

  const [fila, creado] = await CalendarioGlobalVinculo.findOrCreate({
    where: { usuarioId, tenantId: tenant.id },
    defaults: { tenantUsuarioId, color, orden: orden ?? 0 },
  });
  if (!creado) {
    const cambios = {};
    if (emailTenant !== null) cambios.tenantUsuarioId = tenantUsuarioId;
    if (color !== null) cambios.color = color;
    if (orden !== null) cambios.orden = orden;
    if (Object.keys(cambios).length) await fila.update(cambios);
  }
  return { fila, creado };
}

/** Quita un vínculo. Devuelve cuántas filas se fueron (0 o 1). */
export async function desvincular({ usuarioId, slug }) {
  const { CalendarioGlobalVinculo, Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug }, attributes: ["id"] });
  if (!tenant) return 0;
  return CalendarioGlobalVinculo.destroy({ where: { usuarioId, tenantId: tenant.id } });
}
