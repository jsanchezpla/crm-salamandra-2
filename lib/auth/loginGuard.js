/**
 * lib/auth/loginGuard.js — cerrojo de la puerta de entrada.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el login y su auditoría, y
 * concentra una decisión de seguridad que no debe repetirse a mano.)
 *
 * QUÉ RESUELVE: hasta ahora `/api/auth/login` no tenía NINGÚN límite de
 * intentos ni dejaba rastro de los fallos, contra lo que exige el propio
 * CLAUDE.md ("Rate limiting en endpoints de auth", "Registrar en AuditLog
 * accesos fallidos"). Cualquiera podía probar contraseñas sin parar contra los
 * logins reales (nombre_aumenta, la cuenta de Laura) sin que nadie lo viera.
 *
 * SE CUENTAN FALLOS, NO INTENTOS. Es la diferencia entre un cerrojo y un
 * problema: Aumenta son 15 personas saliendo por la MISMA IP de la clínica; si
 * se contaran los intentos, un lunes por la mañana el décimo en entrar se
 * encontraría la puerta cerrada. Entrando bien no se gasta nada, y un login
 * correcto borra el contador de esa cuenta.
 *
 * TRES CERROJOS, a propósito (revisado 2026-07-28 tras la auditoría):
 *   1. Por CUENTA+IP — el cerrojo duro. Frena a quien está probando
 *      contraseñas, y lo frena SOLO A ÉL: la víctima sigue pudiendo entrar
 *      desde su casa o desde la clínica.
 *   2. Por IP — frena el barrido que prueba muchas cuentas desde un sitio.
 *      Su umbral es más alto justo porque tras una IP hay una oficina entera.
 *   3. Por CUENTA (global a todas las IPs) — solo para el ataque DISTRIBUIDO,
 *      por eso su umbral (30) está POR ENCIMA del de IP (25): una sola IP se
 *      queda bloqueada por el cerrojo 2 antes de poder cerrarle la cuenta a
 *      nadie. Hacen falta varias IPs coordinadas, que es exactamente el caso
 *      en que sí quieres cerrar la cuenta.
 *
 * POR QUÉ NO UN CERROJO DE CUENTA GLOBAL A 6: lo tenía y era un agujero. Los
 * logins de Aumenta son adivinables (nombre_aumenta) y el 429 salta ANTES de
 * comprobar la contraseña, así que con 6 peticiones cada 15 minutos —gratis y
 * sin autenticarse— cualquiera dejaba fuera del CRM a una persona concreta
 * para siempre, sin forma de desbloquearla salvo reiniciar el contenedor.
 *
 * Estado en memoria (un solo contenedor Next en producción, como el resto de
 * rate-limit del CRM). Se pierde al reiniciar: aceptable, un atacante que
 * fuerce reinicios tiene otros problemas delante.
 */

import { getClientIp } from "../utils/rateLimit.js";
import { getMasterModels } from "../db/masterDb.js";

export const VENTANA_MS = 15 * 60_000;
export const MAX_FALLOS_CUENTA = 6; // por cuenta Y IP (cerrojo duro)
export const MAX_FALLOS_IP = 25;
// A propósito por ENCIMA de MAX_FALLOS_IP: una sola IP nunca llega aquí.
export const MAX_FALLOS_CUENTA_GLOBAL = 30;

// clave → { fallos, hasta }
const contadores = new Map();
let ultimaLimpieza = 0;

function limpiar(ahora) {
  if (ahora - ultimaLimpieza < 5 * 60_000) return;
  ultimaLimpieza = ahora;
  for (const [k, v] of contadores) if (v.hasta <= ahora) contadores.delete(k);
}

function leer(clave, ahora) {
  const c = contadores.get(clave);
  if (!c || c.hasta <= ahora) return { fallos: 0, hasta: ahora + VENTANA_MS };
  return c;
}

/**
 * ¿Se deja pasar este intento? No consume nada: solo mira los fallos previos.
 * Devuelve { bloqueado, retryAfter, motivo, ip }.
 */
export function comprobarIntentoLogin(request, email) {
  const ahora = Date.now();
  limpiar(ahora);
  const ip = getClientIp(request);
  const clave = String(email || "").slice(0, 120);

  // 1. Cerrojo duro: esta cuenta desde ESTA IP.
  const porCuentaIp = leer(`cuenta-ip:${clave}|${ip}`, ahora);
  if (porCuentaIp.fallos >= MAX_FALLOS_CUENTA) {
    return {
      bloqueado: true,
      motivo: "cuenta",
      retryAfter: Math.max(1, Math.ceil((porCuentaIp.hasta - ahora) / 1000)),
      ip,
    };
  }

  // 2. Barrido: muchas cuentas desde el mismo sitio.
  const porIp = leer(`ip:${ip}`, ahora);
  if (porIp.fallos >= MAX_FALLOS_IP) {
    return {
      bloqueado: true,
      motivo: "ip",
      retryAfter: Math.max(1, Math.ceil((porIp.hasta - ahora) / 1000)),
      ip,
    };
  }

  // 3. Ataque distribuido contra una persona concreta (varias IPs a la vez).
  const porCuenta = leer(`cuenta:${clave}`, ahora);
  if (porCuenta.fallos >= MAX_FALLOS_CUENTA_GLOBAL) {
    return {
      bloqueado: true,
      motivo: "cuenta-global",
      retryAfter: Math.max(1, Math.ceil((porCuenta.hasta - ahora) / 1000)),
      ip,
    };
  }

  return { bloqueado: false, ip };
}

/**
 * Suma un fallo a los contadores. Se llama SOLO cuando falla de verdad.
 *
 * ── `barrido: false`, Y POR QUÉ HACE FALTA (24/08/2026) ────────────────────
 * El contador `ip:` existe para cazar un BARRIDO: alguien probando muchas
 * cuentas distintas desde una IP. Por eso `limpiarFallosLogin` no lo borra
 * nunca al acertar — el barrido puede seguir contra otras cuentas.
 *
 * Eso está bien en el login, donde quien llama no ha probado quién es. En el
 * cambio de contraseña NO: ahí la identidad ya viene probada por el JWT, no se
 * puede tantear ninguna cuenta ajena, y las erratas son de gente que está
 * dentro. Sumarlas al cubo de la IP tiene una consecuencia concreta y mala:
 * Aumenta son 15 personas detrás de la MISMA IP, así que 25 erratas repartidas
 * entre varias en un cuarto de hora dejarían a todo el centro sin poder hacer
 * login —incluida la gente que no ha abierto esa pantalla—, y sin recuperación
 * de contraseña por la que salir.
 *
 * Con `barrido: false` se suman los dos contadores que sí son de esa cuenta y
 * se deja el de la IP en paz.
 */
export function registrarFalloLogin(ip, email, { barrido = true } = {}) {
  const ahora = Date.now();
  const clave = String(email || "").slice(0, 120);
  const cubos = [`cuenta-ip:${clave}|${ip}`, `cuenta:${clave}`];
  if (barrido) cubos.push(`ip:${ip}`);
  for (const k of cubos) {
    const c = leer(k, ahora);
    contadores.set(k, { fallos: c.fallos + 1, hasta: c.hasta });
  }
}

/**
 * Entrar bien limpia los contadores de la cuenta —el global y el de la IP desde
 * la que acaba de acertar—, no el de la IP a secas: ahí puede haber un barrido
 * en curso contra OTRAS cuentas.
 */
export function limpiarFallosLogin(email, ip = null) {
  const clave = String(email || "").slice(0, 120);
  contadores.delete(`cuenta:${clave}`);
  if (ip) contadores.delete(`cuenta-ip:${clave}|${ip}`);
}

/**
 * Un bloqueo se registra UNA SOLA VEZ por ventana y cuenta. Sin esto, el propio
 * ataque llenaría a base de intentos la tabla de auditoría que comparten todos
 * los clientes.
 */
const bloqueosAvisados = new Map();
export function bloqueoYaAvisado(email) {
  const clave = String(email || "").slice(0, 120);
  const ahora = Date.now();
  const hasta = bloqueosAvisados.get(clave);
  if (hasta && hasta > ahora) return true;
  bloqueosAvisados.set(clave, ahora + VENTANA_MS);
  if (bloqueosAvisados.size > 500) {
    for (const [k, v] of bloqueosAvisados) if (v <= ahora) bloqueosAvisados.delete(k);
  }
  return false;
}

/**
 * Resuelve el tenant de un email SOLO para poder auditar el bloqueo dentro del
 * cliente correcto (si no, el aviso no saldría en su pantalla de Actividad).
 * Esta información NO se filtra al atacante: la respuesta HTTP no cambia.
 */
export async function tenantDeEmail(email) {
  try {
    const { User } = getMasterModels();
    const u = await User.findOne({ where: { email }, attributes: ["id", "tenantId"] });
    return u ? { userId: u.id, tenantId: u.tenantId } : null;
  } catch {
    return null;
  }
}

/**
 * Deja rastro del intento en master.audit_logs. Best-effort: un fallo de
 * auditoría nunca puede impedir (ni permitir) un login.
 *
 * NUNCA registra la contraseña. `tenantId`/`userId` van solo cuando se conocen
 * (en un fallo con email inexistente, no hay ninguno de los dos).
 */
export async function auditarLogin({ action, email, ip, userId = null, tenantId = null, motivo = null }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId,
      userId,
      action,
      entity: "Auth",
      entityId: null,
      before: null,
      after: { email: String(email || "").slice(0, 190), ...(motivo ? { motivo } : {}) },
      ip: ip || null,
    });
  } catch {
    /* auditoría best-effort */
  }
}

/** Solo para tests. */
export function _resetLoginGuard() {
  contadores.clear();
  bloqueosAvisados.clear();
}
