/**
 * lib/correo/quienEscribe.js — quién puede escribir desde /correo, y el
 * interruptor «aquí el correo lo manda oficina» (10/09/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: esta condición estaba COPIADA en los siete
 * endpoints de `/api/correo/*` —cuatro de ellos con la misma función
 * `puedeUsarCorreo(ctx)` escrita a mano— y otra vez en el menú. Copiada ocho
 * veces, el día que cambie se queda vieja en siete, y la que se quede vieja es
 * la que deja pasar de más.)
 *
 * ── DE DÓNDE VIENE ──────────────────────────────────────────────────────────
 * De abrirle Clientes a las terapeutas de Aumenta (ticket de Raquel Torralbo:
 * «nosotras no tenemos acceso a los clientes… se podría abrir, pero capado a
 * datos de carácter informativo»). Correo no tiene `moduleKey` propio: se ve
 * con `clients` O con `outreach`, así que dar Clientes a catorce terapeutas
 * les habría puesto de propina la pantalla de escribir a las 1.083 familias de
 * golpe. Rodrigo: eso lo manda oficina.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * · De fábrica, como siempre: quien tenga a quién escribir (`clients` o
 *   `outreach`) puede usar Correo. NO se cambia para nadie.
 * · Con el interruptor `clients.correoSoloOficina` puesto, además hay que ser
 *   OFICINA: dirección (admin) o quien lleve Facturación (`billing`).
 *
 * «Oficina» es la misma frontera que ya usan los bonos
 * (`lib/citas/quienDaBonos.js`) y por el mismo motivo: en un centro pequeño
 * quien administra no siempre dirige, así que se pregunta por el MÓDULO de
 * dinero y no por el cargo. Mandar un correo a doscientas familias es de la
 * misma familia de gestos que registrar un cobro: se responde de él ante el
 * centro entero.
 *
 * ── POR QUÉ UN INTERRUPTOR Y NO LA REGLA DE LA CASA (peldaño 3, regla #16) ──
 * Porque cerrarlo para todos se llevaría por delante a gente que HOY escribe:
 * en producción hay dos cuentas (una en `laura_ubeda`, otra en `nutri_laura`)
 * con Clientes y sin Facturación, y en una consulta de dos personas quien
 * escribe a las pacientes es justo esa. Quitárselo sin que lo pidan es la
 * regresión silenciosa de siempre. Es un «esto sí / esto no» del centro.
 *
 * ── CÓMO SE ENCIENDE ────────────────────────────────────────────────────────
 *   node scripts/correo-solo-oficina.js <slug> --poner   (o --quitar)
 *
 * Este fichero es PURO a propósito: lo importan el menú (navegador) y los
 * endpoints (servidor). Nada de base de datos aquí dentro.
 */

import { esAdmin } from "../auth/permisos.js";

/** La fila de `tenant_modules` que lleva la bandera. */
export const MODULO_CORREO = "clients";

/** La clave dentro de `tenant_modules.feature_flags`. */
export const FLAG_CORREO_SOLO_OFICINA = "correoSoloOficina";

/**
 * ¿Está puesto el interruptor en este centro?
 *
 * `flags` es el `hasFeatureFlag(moduleKey, flagKey)` del contexto (servidor) o
 * el JSONB `featureFlags` de la fila `clients` (menú). Sin bandera → no: el
 * correo lo usa quien tenga a quién escribir, como siempre.
 */
export function correoSoloOficina(flags) {
  if (typeof flags === "function") return !!flags(MODULO_CORREO, FLAG_CORREO_SOLO_OFICINA);
  return flags?.[FLAG_CORREO_SOLO_OFICINA] === true;
}

/**
 * ¿Es esta persona «oficina»? Dirección, o quien lleve Facturación.
 *
 * Se pregunta por `hasModule("billing")` y NUNCA por el rol a secas: es la
 * regla de `lib/auth/permisos.js` para todo lo que es dinero.
 */
export function esOficina({ role, hasModule }) {
  if (esAdmin(role)) return true;
  return typeof hasModule === "function" ? !!hasModule("billing") : false;
}

/**
 * ¿Puede esta persona usar Correo?
 *
 * @param role           su rol (`rolDe(request)` en el servidor, `user.role` en el menú)
 * @param hasModule      módulo del tenant ∩ acceso del usuario (la MISMA intersección
 *                       en los dos sitios: `ctx.hasModule` o `enabledModules.includes`)
 * @param hasFeatureFlag interruptores del centro
 * @param exigeFichas    true en los endpoints que además necesitan las fichas
 *                       (destinatarios, envíos, filtros, remitentes): ahí no
 *                       vale tener solo Captación
 */
export function puedeUsarCorreo({ role, hasModule, hasFeatureFlag, exigeFichas = false }) {
  const tiene = (k) => (typeof hasModule === "function" ? !!hasModule(k) : false);
  const tieneAQuienEscribir = exigeFichas ? tiene("clients") : tiene("clients") || tiene("outreach");
  if (!tieneAQuienEscribir) return false;
  if (!correoSoloOficina(hasFeatureFlag)) return true;
  return esOficina({ role, hasModule });
}

/**
 * Atajo para los endpoints: el rol, los módulos y los interruptores salen del
 * contexto que arma `withTenant`. Sin usuario (webhook, llamada interna) se
 * falla en cerrado en cuanto el interruptor está puesto.
 */
export function puedeUsarCorreoEnContexto(ctx, { exigeFichas = false } = {}) {
  return puedeUsarCorreo({
    role: ctx?.user?.role,
    hasModule: ctx?.hasModule,
    hasFeatureFlag: ctx?.hasFeatureFlag,
    exigeFichas,
  });
}

/** Lo que se le dice a quien no puede, cuando hay que decirle algo. */
export const MOTIVO_SOLO_OFICINA =
  "En este centro el correo a varias personas lo manda dirección o quien lleve Facturación";
