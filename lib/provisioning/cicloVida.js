/**
 * Ciclo de vida de un cliente: editar, cambiar módulos, suspender y reactivar.
 *
 * El alta ya existía; lo que faltaba era todo lo demás. Hasta ahora, activar un
 * módulo a un cliente en marcha, cambiarle el nombre o suspenderlo era entrar por
 * SSH y correr scripts a mano.
 *
 * ── TRES REGLAS QUE NO SE NEGOCIAN ──────────────────────────────────────────
 *
 * 1. EL IDENTIFICADOR NO SE TOCA. Es el nombre del schema de PostgreSQL
 *    (`crm_{slug}`) y está escrito dentro de datos, de URLs de widgets ya
 *    pegadas en webs de clientes y de secretos por-tenant del entorno. Cambiarlo
 *    no es renombrar: es mudarse.
 *
 * 2. DESACTIVAR UN MÓDULO NUNCA BORRA DATOS. Se apaga la fila de
 *    `tenant_modules` y sus tablas se quedan intactas. Si mañana lo reactivan,
 *    su histórico sigue ahí. Borrar tablas de un cliente no puede ser el efecto
 *    secundario de desmarcar una casilla.
 *
 * 3. PRIMERO LOS DATOS, DESPUÉS LA ESTRUCTURA. Al activar un módulo se escribe
 *    la fila y LUEGO se ponen al día las migraciones de su schema. Al revés
 *    —que es como se hizo una vez— el CRM ya ofrece el módulo mientras a su
 *    schema le faltan tablas, y toda lectura revienta con 42703. Ver la cabecera
 *    de scripts/enable-module.js.
 *
 * La baja DURA (borrar el schema y sus datos) NO está aquí a propósito: sigue
 * siendo un script que se corre a mano, mirando lo que se va a destruir. Un
 * botón que borra los datos de un cliente es un accidente esperando su turno.
 */

import { getMasterModels } from "../db/masterDb.js";
import { CLAVES_VALIDAS, moduloPorClave, resolverDependencias } from "./catalogo.js";
import { ponerSchemaAlDia } from "./altaTenant.js";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const colorValido = (v) => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim() : null);

/** Estados que puede tener un cliente. */
export const ESTADOS = ["active", "suspended"];

/**
 * Qué módulos ACTIVOS dependen de `clave`. Sirve para no dejar a un cliente con
 * Clínica encendida y Pacientes apagado, que es una combinación rota.
 */
function dependientesActivos(clave, activos) {
  return activos.filter((k) => (moduloPorClave(k)?.requiere || []).includes(clave));
}

/**
 * @param {string} slug
 * @param {object} cambios
 * @param {string} [cambios.nombre]
 * @param {string} [cambios.plan]
 * @param {string} [cambios.estado]        "active" | "suspended"
 * @param {object} [cambios.brand]         { primaryColor, secondaryColor, logoUrl }
 * @param {string[]} [cambios.modulos]     lista COMPLETA deseada de módulos activos
 * @returns {Promise<{ok:true, aplicado:object, avisos:string[]}|{error:string,status:number}>}
 */
export async function editarTenant(slug, cambios = {}) {
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) return { error: `No existe el cliente "${slug}"`, status: 404 };

  const avisos = [];
  const aplicado = {};
  const updates = {};

  // ── Nombre ────────────────────────────────────────────────────────────────
  if (cambios.nombre !== undefined) {
    const limpio = String(cambios.nombre || "").trim();
    if (!limpio) return { error: "El nombre no puede quedar vacío", status: 422 };
    if (limpio !== tenant.name) {
      updates.name = limpio;
      aplicado.nombre = { antes: tenant.name, ahora: limpio };
    }
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  if (cambios.plan !== undefined && cambios.plan !== tenant.plan) {
    const p = String(cambios.plan || "").trim();
    if (!p) return { error: "Plan inválido", status: 422 };
    updates.plan = p;
    aplicado.plan = { antes: tenant.plan, ahora: p };
  }

  // ── Estado ────────────────────────────────────────────────────────────────
  if (cambios.estado !== undefined && cambios.estado !== tenant.status) {
    if (!ESTADOS.includes(cambios.estado)) {
      return { error: `Estado inválido. Solo: ${ESTADOS.join(", ")}`, status: 422 };
    }
    updates.status = cambios.estado;
    aplicado.estado = { antes: tenant.status, ahora: cambios.estado };
    if (cambios.estado === "suspended") {
      // No es un ajuste cosmético: el resolutor de tenants solo carga los
      // 'active', así que sus usuarios dejan de poder entrar EN EL ACTO.
      avisos.push(
        "Suspendido: sus usuarios dejan de poder entrar de inmediato y sus widgets públicos dejan de responder. Los datos se conservan intactos."
      );
    } else {
      avisos.push("Reactivado: sus usuarios vuelven a poder entrar.");
    }
  }

  // ── Marca ─────────────────────────────────────────────────────────────────
  if (cambios.brand && typeof cambios.brand === "object") {
    const brandAntes = tenant.settings?.brand ?? {};
    const brandNuevo = { ...brandAntes };
    let tocado = false;
    for (const campo of ["primaryColor", "secondaryColor"]) {
      if (campo in cambios.brand) {
        const v = colorValido(cambios.brand[campo]);
        if (cambios.brand[campo] && !v) {
          return { error: `${campo}: se espera un color hex tipo #1B3A2D`, status: 422 };
        }
        if (v !== (brandAntes[campo] ?? null)) {
          if (v) brandNuevo[campo] = v;
          else delete brandNuevo[campo];
          tocado = true;
        }
      }
    }
    if ("logoUrl" in cambios.brand) {
      const v = typeof cambios.brand.logoUrl === "string" && cambios.brand.logoUrl.trim()
        ? cambios.brand.logoUrl.trim().slice(0, 500)
        : null;
      if (v !== (brandAntes.logoUrl ?? null)) {
        if (v) brandNuevo.logoUrl = v;
        else delete brandNuevo.logoUrl;
        tocado = true;
      }
    }
    if (tocado) {
      updates.settings = { ...(tenant.settings ?? {}), brand: brandNuevo };
      aplicado.marca = true;
    }
  }

  // ── Módulos ───────────────────────────────────────────────────────────────
  let porActivar = [];
  let porDesactivar = [];
  if (Array.isArray(cambios.modulos)) {
    const desconocidos = cambios.modulos.filter((k) => !CLAVES_VALIDAS.has(k));
    if (desconocidos.length) {
      return { error: `Módulos que no existen: ${desconocidos.join(", ")}`, status: 422 };
    }

    // Las dependencias se arrastran solas: pedir Clínica es pedir Pacientes.
    const deseados = new Set(resolverDependencias(cambios.modulos));
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    const activos = filas.filter((f) => f.enabled).map((f) => f.moduleKey);

    porActivar = [...deseados].filter((k) => !activos.includes(k));
    porDesactivar = activos.filter((k) => !deseados.has(k));

    const arrastrados = porActivar.filter((k) => !cambios.modulos.includes(k));
    if (arrastrados.length) {
      avisos.push(`Se activan además por dependencia: ${arrastrados.join(", ")}.`);
    }

    // Módulos que se pidió QUITAR pero que la resolución de dependencias vuelve
    // a meter, porque otro módulo activo los necesita. No es un error —el
    // resultado es seguro— pero callarlo dejaría al operador creyendo que quitó
    // algo que sigue encendido. Desmarcar Clientes con Clínica activa entra aquí.
    const pedidos = new Set(cambios.modulos);
    const devueltos = [...deseados].filter((k) => !pedidos.has(k) && activos.includes(k));
    if (devueltos.length) {
      const porQuien = devueltos.map((k) => {
        const quienes = dependientesActivos(k, [...deseados]);
        return quienes.length ? `${k} (lo necesita ${quienes.join(", ")})` : k;
      });
      avisos.push(`NO se han quitado: ${porQuien.join("; ")}. Quita antes el módulo que los necesita.`);
    }

    // 1) DATOS: filas de tenant_modules.
    for (const clave of porActivar) {
      const fila = filas.find((f) => f.moduleKey === clave);
      if (fila) await fila.update({ enabled: true });
      else await TenantModule.create({ tenantId: tenant.id, moduleKey: clave, enabled: true, version: 1 });
    }
    for (const clave of porDesactivar) {
      const fila = filas.find((f) => f.moduleKey === clave);
      if (fila) await fila.update({ enabled: false });
    }
    if (porActivar.length || porDesactivar.length) {
      aplicado.modulos = { activados: porActivar, desactivados: porDesactivar };
    }
    if (porDesactivar.length) {
      avisos.push(
        `Desactivados ${porDesactivar.join(", ")}: desaparecen del menú, pero sus datos se conservan y vuelven si se reactivan.`
      );
    }
  }

  if (Object.keys(updates).length) await tenant.update(updates);

  // ── 2) ESTRUCTURA: migraciones de los módulos recién activados ────────────
  // Va DESPUÉS de escribir las filas y nunca lanza: si falla, el módulo ya
  // aparece en el menú y hay que saber que su schema se quedó atrás.
  if (porActivar.length) {
    const res = await ponerSchemaAlDia(slug, porActivar);
    if (!res.ok) {
      avisos.push(
        `⚠ Las migraciones de ${porActivar.join(", ")} NO se completaron (${res.motivo}). ` +
          `El módulo ya está activo pero a su schema le pueden faltar tablas. ` +
          `Corre a mano: docker exec crm-salamandra-app-1 node scripts/ensure-tenant-schema.js ${slug}`
      );
    }
  }

  return { ok: true, aplicado, avisos };
}
