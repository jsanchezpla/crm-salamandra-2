/**
 * lib/calendario-global/acceso.js — qué clientes ve cada cuenta en el
 * calendario global y con qué cuenta se abre su CRM (12/09/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo llaman los endpoints del host
 * `calendar.` —calendario y proyectos—, `eventos.js`, `salto.js` y el canje de
 * `/api/auth/saltar`. Es la puerta de TODO lo que el global lee o escribe, y una
 * puerta copiada en cinco sitios acaba con cinco cerraduras distintas.)
 *
 * ── LO QUE PIDIÓ ────────────────────────────────────────────────────────────
 * «No puedo seleccionar los calendarios que quiera ver (debería tener acceso a
 * todos los tenants y ver el calendario que quiera) […] Debería tener acceso a
 * los proyectos también.» Y al preguntarle: abrir el CRM de un cliente sin
 * cuenta vinculada, como su admin y auditado, solo para admins de Salamandra.
 * El porqué entero en
 * docs/decisions/2026-09-12-el-calendario-global-ve-todos-y-los-proyectos.md.
 *
 * ── DOS FORMAS DE ENTRAR EN LA LISTA ────────────────────────────────────────
 *   · `via: "vinculo"` — la fila de `master.calendario_global_vinculos`, como
 *     desde el 03/09. Para cualquier cuenta sigue siendo la autorización.
 *   · `via: "todos"` — la cuenta es ADMIN DE SALAMANDRA (ver
 *     `cumpleAdminSalamandra`): ve todos los clientes en marcha, sin demos.
 *     Si además tiene filas, estas le aportan color, orden y cuenta de salto.
 *
 * `vinculosDe` (vinculos.js) NO cambia: el back-office y el script de vincular
 * siguen enseñando las filas reales, no la lista ampliada. Esta es la lista
 * del GLOBAL.
 *
 * ── CON QUÉ CUENTA SE SALTA ─────────────────────────────────────────────────
 *   1. La cuenta de salto de la fila, si es de ese tenant y no es de
 *      back-office → `"cuenta"` (lo de siempre).
 *   2. Si el cliente es el tenant PROPIO de quien mira (salamandra_solutions
 *      para un admin de Salamandra) → `"cuenta"` con SU propia cuenta. Sin
 *      esto, el paso 3 entraría en nuestro CRM como el admin más antiguo, que
 *      puede ser un compañero: nadie tiene que hacerse pasar por Jorge para
 *      abrir su propio CRM.
 *   3. Admin de Salamandra, cliente que no es demo y con una cuenta admin que
 *      no es de back-office → `"admin"`, con la más antigua (la del alta).
 *   4. Si no, `null`: no hay botón y `emitirSalto` lo rechaza.
 *
 * Nada de aquí importa `next/server`: la prueba ligera
 * `_smoke-calendario-global.mjs` lo carga con Node suelto.
 */

import { getMasterModels } from "../db/masterDb.js";
import { whereClientesVisibles } from "../provisioning/clientesVisibles.js";
import { esSlugDemo } from "../demo/demos.js";
import { colorDe } from "./vinculos.js";

/**
 * Nuestro tenant. Mismo valor que `NOSOTROS` de lib/provisioning/bajaTenant.js,
 * copiado a propósito: aquel fichero arrastra `fs` y el volcado de schemas, y
 * esto lo carga una prueba ligera.
 */
export const NOSOTROS = "salamandra_solutions";

/** Los roles que cuentan como administrador, aquí y en el cliente. */
export const ROLES_ADMIN = ["admin", "superadmin"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Es esta cuenta un admin de Salamandra? PURA: recibe lo leído de master y
 * decide, para poder probarla sin base de datos.
 *
 * Hacen falta TODAS a la vez:
 *   · cuenta del CRM (no de back-office) con rol admin o superadmin;
 *   · de nuestro tenant, `salamandra_solutions`, y en marcha;
 *   · con `provisioning` encendido en ese tenant (lo que abre el back-office);
 *   · y con acceso a él: superadmin, o `moduleAccess` con "all" o
 *     "provisioning" (lo mismo que exige `ctx.hasModule("provisioning")` en el
 *     candado del back-office).
 *
 * El slug se exige además del módulo porque `provisioning` se puede encender a
 * mano con `enable-module.js` en otro tenant, y un superadmin lo pasa siempre:
 * ver todos los clientes no puede depender de un solo interruptor.
 */
export function cumpleAdminSalamandra({ user, tenant, provisioningActivo } = {}) {
  if (!user || user.soloBackoffice) return false;
  if (!ROLES_ADMIN.includes(user.role)) return false;
  if (!tenant || tenant.slug !== NOSOTROS || tenant.status !== "active") return false;
  // La cuenta tiene que SER de ese tenant (si los dos traen id para comparar).
  if (user.tenantId != null && tenant.id != null && user.tenantId !== tenant.id) return false;
  if (provisioningActivo !== true) return false;
  if (user.role === "superadmin") return true;
  const acceso = Array.isArray(user.moduleAccess) ? user.moduleAccess : [];
  return acceso.includes("all") || acceso.includes("provisioning");
}

/** Cuenta, tenant y `provisioning` de quien mira, leídos FRESCOS de master. */
async function leerQuienMira(usuarioId) {
  const vacio = { user: null, tenant: null, provisioningActivo: false };
  if (typeof usuarioId !== "string" || !UUID.test(usuarioId)) return vacio;
  const { User, Tenant, TenantModule } = getMasterModels();
  const user = await User.findByPk(usuarioId, {
    attributes: ["id", "email", "role", "tenantId", "moduleAccess", "soloBackoffice"],
  });
  if (!user?.tenantId) return { ...vacio, user: user ?? null };
  const [tenant, provisioning] = await Promise.all([
    Tenant.findByPk(user.tenantId, { attributes: ["id", "slug", "status"] }),
    TenantModule.findOne({
      where: { tenantId: user.tenantId, moduleKey: "provisioning" },
      attributes: ["enabled"],
    }),
  ]);
  return { user, tenant, provisioningActivo: provisioning?.enabled === true };
}

/**
 * ¿Es admin de Salamandra AHORA? Sin caché a propósito, como el rol fresco de
 * `withTenant`: degradar a alguien le quita todos los clientes al instante.
 */
export async function esAdminDeSalamandra(usuarioId) {
  return cumpleAdminSalamandra(await leerQuienMira(usuarioId));
}

/**
 * La cuenta admin con la que se entraría en un cliente «como admin»: la más
 * antigua que no sea de back-office (la del alta, `altaTenant.js`), o null.
 * Determinista a propósito: quién aparece como autor en su CRM no puede
 * cambiar de un clic a otro.
 */
export async function cuentaAdminDelCliente(tenantId) {
  if (!tenantId) return null;
  const { User } = getMasterModels();
  return User.findOne({
    where: { tenantId, role: ROLES_ADMIN, soloBackoffice: false },
    attributes: ["id", "email", "role", "tenantId", "createdAt"],
    order: [["createdAt", "ASC"]],
  });
}

/**
 * Con qué cuenta se salta a un tenant (los cuatro pasos de la cabecera). PURA.
 *
 * @param {object} p
 * @param {{id,slug}} p.tenant        el cliente
 * @param {object|null} p.cuentaVinculo la cuenta de salto de su fila, si hay
 * @param {object|null} p.yo           la cuenta de quien mira
 * @param {boolean} p.todos            ¿es admin de Salamandra?
 * @param {object|null} p.adminCliente la cuenta admin más antigua del cliente
 * @returns {{ saltoComo: "cuenta"|"admin"|null, saltoUsuarioId: string|null, saltoEmail: string|null }}
 */
export function decidirSalto({ tenant, cuentaVinculo = null, yo = null, todos = false, adminCliente = null }) {
  const con = (saltoComo, u) => ({ saltoComo, saltoUsuarioId: u.id, saltoEmail: u.email ?? null });
  if (cuentaVinculo && cuentaVinculo.tenantId === tenant.id && !cuentaVinculo.soloBackoffice) {
    return con("cuenta", cuentaVinculo);
  }
  if (todos && yo && yo.tenantId === tenant.id && !yo.soloBackoffice) return con("cuenta", yo);
  if (todos && !esSlugDemo(tenant.slug) && adminCliente && adminCliente.tenantId === tenant.id) {
    return con("admin", adminCliente);
  }
  return { saltoComo: null, saltoUsuarioId: null, saltoEmail: null };
}

/**
 * Colores de reserva cuando el de un cliente se confunde con otro ya usado
 * (12/09/2026, Rodrigo). Sobrios y sin rojo puro, que en el calendario es
 * «prioridad alta». Parte de la lista que propuso se cambió
 * (#0369A1 → #0891B2, #6D28D9 → #86198F, #A16207 → #78350F, #334155 →
 * #64748B) porque cada uno de esos quedaba a menos de `UMBRAL_PARECIDO` de
 * otro de la MISMA paleta, y entonces nunca se habría podido elegir con el
 * otro ya puesto. Así, los doce están a 60 o más entre sí.
 */
export const PALETA_RESERVA = [
  "#1F3B34", "#B7791F", "#2563EB", "#7C3AED", "#0F766E", "#C2410C",
  "#BE185D", "#4D7C0F", "#0891B2", "#86198F", "#78350F", "#64748B",
];

/** Por debajo de esta distancia RGB euclídea, dos colores cuentan como el mismo. */
export const UMBRAL_PARECIDO = 60;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Distancia RGB euclídea entre dos `#RRGGBB` (mayúsculas o minúsculas). */
export function distanciaColor(a, b) {
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/**
 * El color de cada cliente en el global, en el orden de la lista. PURA y
 * determinista: la misma lista da los mismos colores en cada carga.
 *
 * POR QUÉ (12/09/2026, Rodrigo): el color salía de `colorDe` cliente a
 * cliente, sin mirar a los demás, y muchos clientes llevan de marca el verde
 * de Salamandra (#1B3A2D) que se les pone por defecto. Con todos los clientes
 * a la vez, media semana era del mismo verde y no se sabía de quién era cada
 * cosa, que es justo la pregunta que el color responde en el global.
 *
 * @param {Array<{ explicito?: string|null, propuesto?: string|null }>} candidatos
 *   `explicito`: el color de la fila del vínculo (lo eligió alguien a mano).
 *   `propuesto`: el de la marca del cliente o, sin marca, el de la paleta.
 * @returns {string[]} un color por candidato, en el mismo orden.
 *
 * Reglas:
 *   1. El explícito se respeta SIEMPRE, aunque se parezca a otro. Y se reserva
 *      antes de repartir los demás: si no, un cliente de más arriba se quedaría
 *      con ese color por marca y el elegido a mano acabaría repetido.
 *   2. El propuesto vale si no se parece (`UMBRAL_PARECIDO`) a ninguno ya
 *      usado; si se parece, el primero de `PALETA_RESERVA` que no se parezca.
 *   3. Si ya no queda ninguno libre (más clientes que colores), el de la
 *      reserva más lejano de los usados y, a igualdad, el que menos se ha
 *      repetido: se reparten por turnos en vez de caer todos en el primero.
 */
export function repartirColores(candidatos) {
  const lista = Array.isArray(candidatos) ? candidatos : [];
  const valido = (c) => typeof c === "string" && HEX.test(c);
  const usados = lista.map((c) => c?.explicito).filter(valido);
  const seParece = (color) => usados.some((u) => distanciaColor(color, u) < UMBRAL_PARECIDO);

  const elMenosRepetido = () => {
    let mejor = null;
    for (const color of PALETA_RESERVA) {
      const distancias = usados.map((u) => distanciaColor(color, u));
      const cerca = Math.min(...distancias);
      const veces = distancias.filter((d) => d < UMBRAL_PARECIDO).length;
      if (!mejor || cerca > mejor.cerca || (cerca === mejor.cerca && veces < mejor.veces)) {
        mejor = { color, cerca, veces };
      }
    }
    return mejor.color;
  };

  return lista.map((c) => {
    if (valido(c?.explicito)) return c.explicito;
    let color;
    if (valido(c?.propuesto) && !seParece(c.propuesto)) color = c.propuesto;
    else color = PALETA_RESERVA.find((r) => !seParece(r)) ?? elMenosRepetido();
    usados.push(color);
    return color;
  });
}

/**
 * Los calendarios (clientes) que ve una cuenta en el global.
 *
 * @returns {Promise<{ todos: boolean, calendarios: Array<{
 *   slug: string, nombre: string, tenantId: string, color: string,
 *   orden: number|null,            // el de la fila; null si entra por `todos`
 *   calendario: boolean,           // módulo calendar encendido
 *   proyectos: boolean,            // módulo projects encendido
 *   via: "vinculo"|"todos",
 *   saltoComo: "cuenta"|"admin"|null,
 *   saltoUsuarioId: string|null,
 *   saltoEmail: string|null,
 * }> }>}
 *
 * Orden: primero los que tienen fila (por `orden` y fecha de la fila), luego el
 * resto por nombre. El color de reserva (`PALETA[i]`) usa la posición en ESTA
 * lista, que no depende de lo que la pantalla tenga seleccionado: un cliente
 * no cambia de color al ocultar otro. Desde el 12/09/2026 los colores se
 * reparten sobre esta lista entera con `repartirColores`, para que dos
 * clientes con la misma marca no salgan iguales; por lo mismo, ocultar uno
 * tampoco cambia el de los demás.
 */
export async function calendariosDe(usuarioId) {
  if (!usuarioId) return { todos: false, calendarios: [] };
  const { CalendarioGlobalVinculo, Tenant, TenantModule, User } = getMasterModels();

  const [quien, filas] = await Promise.all([
    leerQuienMira(usuarioId),
    CalendarioGlobalVinculo.findAll({
      where: { usuarioId },
      order: [["orden", "ASC"], ["createdAt", "ASC"]],
    }),
  ]);
  const todos = cumpleAdminSalamandra(quien);

  let tenants = [];
  if (todos) {
    // Activos y sin demos; incluye salamandra_solutions (en local no tiene
    // schema: su lectura sale con `fallo`, y así se ve).
    tenants = await Tenant.findAll({ where: whereClientesVisibles() });
  } else if (filas.length) {
    // Como hasta hoy: los vinculados que estén en marcha, demos incluidas si
    // alguien las vinculó a mano.
    tenants = await Tenant.findAll({ where: { id: filas.map((f) => f.tenantId), status: "active" } });
  }
  if (!tenants.length) return { todos, calendarios: [] };

  const tenantPorId = new Map(tenants.map((t) => [t.id, t]));
  const filaPorTenant = new Map();
  const ordenados = [];
  for (const f of filas) {
    const t = tenantPorId.get(f.tenantId);
    if (!t || filaPorTenant.has(t.id)) continue;
    filaPorTenant.set(t.id, f);
    ordenados.push(t);
  }
  ordenados.push(
    ...tenants
      .filter((t) => !filaPorTenant.has(t.id))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "es"))
  );
  const ids = ordenados.map((t) => t.id);

  const idsCuentaVinculo = [...filaPorTenant.values()].map((f) => f.tenantUsuarioId).filter(Boolean);
  const [modulos, cuentasVinculo, admins] = await Promise.all([
    TenantModule.findAll({
      where: { tenantId: ids, moduleKey: ["calendar", "projects"] },
      attributes: ["tenantId", "moduleKey", "enabled"],
    }),
    idsCuentaVinculo.length
      ? User.findAll({ where: { id: idsCuentaVinculo }, attributes: ["id", "tenantId", "email", "soloBackoffice"] })
      : [],
    // Una sola consulta para todos los clientes, no una por cliente: la primera
    // de cada tenant (orden por antigüedad) es su `cuentaAdminDelCliente`.
    todos
      ? User.findAll({
          where: { tenantId: ids, role: ROLES_ADMIN, soloBackoffice: false },
          attributes: ["id", "email", "tenantId", "createdAt"],
          order: [["createdAt", "ASC"]],
        })
      : [],
  ]);

  const encendido = new Set(modulos.filter((m) => m.enabled === true).map((m) => `${m.tenantId}:${m.moduleKey}`));
  const cuentaPorId = new Map(cuentasVinculo.map((u) => [u.id, u]));
  const adminPorTenant = new Map();
  for (const u of admins) if (!adminPorTenant.has(u.tenantId)) adminPorTenant.set(u.tenantId, u);

  // El color de la fila es el explícito; `colorDe` sin fila da el de la marca
  // o el de la paleta por posición, que es el propuesto (ver `repartirColores`).
  const colores = repartirColores(
    ordenados.map((tenant, i) => ({
      explicito: filaPorTenant.get(tenant.id)?.color ?? null,
      propuesto: colorDe({}, tenant, i),
    }))
  );

  const calendarios = ordenados.map((tenant, i) => {
    const fila = filaPorTenant.get(tenant.id) ?? null;
    const salto = decidirSalto({
      tenant,
      cuentaVinculo: fila?.tenantUsuarioId ? cuentaPorId.get(fila.tenantUsuarioId) ?? null : null,
      yo: quien.user,
      todos,
      adminCliente: adminPorTenant.get(tenant.id) ?? null,
    });
    return {
      slug: tenant.slug,
      nombre: tenant.name,
      tenantId: tenant.id,
      color: colores[i],
      orden: fila ? fila.orden : null,
      calendario: encendido.has(`${tenant.id}:calendar`),
      proyectos: encendido.has(`${tenant.id}:projects`),
      via: fila ? "vinculo" : "todos",
      ...salto,
    };
  });
  return { todos, calendarios };
}

/**
 * La entrada de UN cliente para esa cuenta, o null. Es la autorización de todo
 * lo que el global escribe (mover eventos, tarjetas, hitos) y del salto.
 */
export async function calendarioDe(usuarioId, slug) {
  if (!slug) return null;
  const { calendarios } = await calendariosDe(usuarioId);
  return calendarios.find((c) => c.slug === slug) ?? null;
}

/**
 * Lo que de una entrada puede salir hacia la pantalla. Sin `tenantId`, sin
 * `saltoUsuarioId` y sin `via`: el navegador no necesita ids de master para
 * nada, y el correo de la cuenta de salto sí (la pantalla avisa «Entrarás como…»).
 */
export function fichaPublica(entrada) {
  return {
    slug: entrada.slug,
    nombre: entrada.nombre,
    color: entrada.color,
    calendario: !!entrada.calendario,
    proyectos: !!entrada.proyectos,
    saltoComo: entrada.saltoComo ?? null,
    saltoEmail: entrada.saltoEmail ?? null,
  };
}
