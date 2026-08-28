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
import { CLAVES_VALIDAS, moduloPorClave } from "./catalogo.js";
import { validarSeleccion, fraseDeExigencia } from "./dependencias.js";
import { ponerSchemaAlDia } from "./altaTenant.js";
import { normalizarContacto } from "./contactoCliente.js";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const colorValido = (v) => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim() : null);

/** Estados que puede tener un cliente. */
export const ESTADOS = ["active", "suspended"];

/*
 * `dependientesActivos()` vivía aquí y se ha ido (10/08/2026). Servía para
 * volver a encender en silencio lo que el operador había desmarcado y que otro
 * módulo necesitaba, y avisar después. Ahora eso se rechaza de frente en
 * `validarSeleccion()`, con el motivo, y no queda a quién avisar.
 */

/**
 * @param {string} slug
 * @param {object} cambios
 * @param {string} [cambios.nombre]
 * @param {string} [cambios.plan]
 * @param {string} [cambios.estado]        "active" | "suspended"
 * @param {object} [cambios.brand]         { primaryColor, secondaryColor, logoUrl }
 * @param {object} [cambios.contacto]      { email, nombre, telefono } — a quién
 *                                         se le escribe, NO con quién entra
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
  /** ¿Este guardado saca al cliente de la nevera? (ver «Estructura» abajo) */
  let reactivado = false;

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
      // Y con ellos vuelve su schema, que puede venir con meses de retraso: ver
      // el bloque de más abajo.
      reactivado = true;
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
    // `logoUrl` y su hermano `isotipoUrl` (28/08/2026): el isotipo es la marca
    // sin el texto, y cierra la última página del informe clínico. Misma
    // validación y mismo tope que el logo, y ninguno de los dos es obligatorio.
    for (const campo of ["logoUrl", "isotipoUrl"]) {
      if (!(campo in cambios.brand)) continue;
      const bruto = cambios.brand[campo];
      const v = typeof bruto === "string" && bruto.trim() ? bruto.trim().slice(0, 500) : null;
      if (v !== (brandAntes[campo] ?? null)) {
        if (v) brandNuevo[campo] = v;
        else delete brandNuevo[campo];
        tocado = true;
      }
    }
    if (tocado) {
      updates.settings = { ...(tenant.settings ?? {}), brand: brandNuevo };
      aplicado.marca = true;
    }
  }

  // ── Contacto ──────────────────────────────────────────────────────────────
  // A quién se le ESCRIBE, que no es el `adminEmail` con el que entra: ver
  // lib/provisioning/contactoCliente.js. Se parte de `updates.settings` si la
  // marca ya lo tocó, o se perdería uno de los dos cambios.
  if (cambios.contacto !== undefined) {
    const r = normalizarContacto(cambios.contacto, tenant.settings?.contacto ?? {});
    if (r.error) return { error: r.error, status: 422 };
    const antes = tenant.settings?.contacto ?? null;
    if (JSON.stringify(antes) !== JSON.stringify(r.contacto)) {
      const settings = { ...(updates.settings ?? tenant.settings ?? {}) };
      if (r.contacto) settings.contacto = r.contacto;
      else delete settings.contacto;
      updates.settings = settings;
      aplicado.contacto = r.contacto ?? "borrado";
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

    // La lista que llega es la que se aplica: ni se completa ni se corrige.
    //
    // Antes se arrastraban las dependencias en silencio, y de ahí salían dos
    // avisos que ya no hacen falta —«se activan además por dependencia…» y «NO
    // se han quitado…»—: los dos describían cosas que el sistema hacía por su
    // cuenta contra lo que el operador acababa de marcar. Aquí eso pesa más que
    // en el alta, porque esto se ejecuta sobre un cliente EN MARCHA: activar de
    // más le prepara tablas y le aparece un módulo en el menú; quitar de menos
    // le deja pagando algo que creía haber quitado.
    //
    // Quitar Clientes con Clínica encendida ya no «no se hace»: se rechaza con
    // el motivo, y el operador quita antes lo que lo necesita.
    const { modulos: validos, problemas } = validarSeleccion(cambios.modulos);
    if (problemas.length) {
      const nombreDe = (k) => moduloPorClave(k)?.nombre ?? k;
      return { error: problemas.map((p) => fraseDeExigencia(p, nombreDe)).join(" "), status: 422 };
    }

    const deseados = new Set(validos);
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    const activos = filas.filter((f) => f.enabled).map((f) => f.moduleKey);

    porActivar = [...deseados].filter((k) => !activos.includes(k));

    /*
     * ⚠️ ESTE EDITOR SOLO MANDA SOBRE EL CATÁLOGO DE VENTA (11/08/2026).
     *
     * `deseados` sale de `validarSeleccion()`, que filtra por `CLAVES_VALIDAS`
     * — o sea, por lo que se puede vender desde el alta. Un módulo INTERNO, que
     * no está en el catálogo, nunca puede estar en `deseados`, así que sin este
     * filtro caía siempre en `porDesactivar` y se apagaba al guardar.
     *
     * Hoy el único es `provisioning`, y lo tiene salamandra_solutions: o sea
     * NOSOTROS. Guardar cualquier cambio de módulos en nuestra propia ficha
     * apagaba `provisioning` y con él los tres candados de TODO el back-office
     * (`ctx.hasModule("provisioning")`), incluida la pantalla desde la que
     * acababas de guardar. Para volver a entrar hacía falta SSH y un UPDATE a
     * mano. Y no había forma de verlo venir: como no está en el catálogo, no
     * tiene casilla, así que parecía que solo estabas tocando los otros seis.
     *
     * El editor apaga lo que se vende. Lo que no se vende no es cosa suya.
     */
    porDesactivar = activos.filter((k) => !deseados.has(k) && CLAVES_VALIDAS.has(k));

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
  //
  // ⚠️ Y TAMBIÉN AL REACTIVAR (12/08/2026). Suspender apaga al cliente de
  // verdad, así que mientras está apagado nadie choca con nada… y su schema se
  // queda congelado el día que se apagó: hasta el 12/08 las migraciones que se
  // enumeran solas filtraban por `status = 'active'`. Cuando se encontró, en
  // producción, `quality_energy` llevaba 22 columnas de retraso en 7 tablas y
  // `abarcaia` 20 en 6. El daño no lo hace la suspensión: lo hace el día que
  // se reactiva, porque vuelve a estar vivo con un schema viejo y lo que se
  // lleva el golpe es la primera pantalla que lea una columna que no existe.
  //
  // Se lanza DESPUÉS del `tenant.update()` de arriba a propósito: para entonces
  // ya está en `active`, que es lo que las migraciones miran para dejarse
  // acotar por `ONLY_SCHEMAS`. Al revés no haría nada.
  const modulosAPonerAlDia = reactivado
    ? (await TenantModule.findAll({ where: { tenantId: tenant.id } }))
        .filter((f) => f.enabled)
        .map((f) => f.moduleKey)
    : porActivar;

  if (modulosAPonerAlDia.length) {
    const res = await ponerSchemaAlDia(slug, modulosAPonerAlDia);
    if (!res.ok) {
      avisos.push(
        `⚠ Las migraciones de ${modulosAPonerAlDia.join(", ")} NO se completaron (${res.motivo}). ` +
          `El módulo ya está activo pero a su schema le pueden faltar tablas. ` +
          `Corre a mano: docker exec crm-salamandra-app-1 node scripts/ensure-tenant-schema.js ${slug}`
      );
    } else if (reactivado) {
      avisos.push("Su schema se ha puesto al día con las migraciones que le tocaban.");
    }
  }

  return { ok: true, aplicado, avisos };
}
