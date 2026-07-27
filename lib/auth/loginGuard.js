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
 * DOS CERROJOS, a propósito:
 *   1. Por CUENTA — frena el ataque contra una víctima concreta aunque rote IPs.
 *   2. Por IP — frena el barrido que prueba muchas cuentas desde un sitio.
 *      Su umbral es más alto justo porque tras una IP hay una oficina entera.
 *
 * Estado en memoria (un solo contenedor Next en producción, como el resto de
 * rate-limit del CRM). Se pierde al reiniciar: aceptable, un atacante que
 * fuerce reinicios tiene otros problemas delante.
 */

import { getClientIp } from "../utils/rateLimit.js";
import { getMasterModels } from "../db/masterDb.js";

export const VENTANA_MS = 15 * 60_000;
export const MAX_FALLOS_CUENTA = 6;
export const MAX_FALLOS_IP = 25;

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

  const porCuenta = leer(`cuenta:${clave}`, ahora);
  if (porCuenta.fallos >= MAX_FALLOS_CUENTA) {
    return {
      bloqueado: true,
      motivo: "cuenta",
      retryAfter: Math.max(1, Math.ceil((porCuenta.hasta - ahora) / 1000)),
      ip,
    };
  }

  const porIp = leer(`ip:${ip}`, ahora);
  if (porIp.fallos >= MAX_FALLOS_IP) {
    return {
      bloqueado: true,
      motivo: "ip",
      retryAfter: Math.max(1, Math.ceil((porIp.hasta - ahora) / 1000)),
      ip,
    };
  }

  return { bloqueado: false, ip };
}

/** Suma un fallo a la cuenta y a la IP. Se llama SOLO cuando falla de verdad. */
export function registrarFalloLogin(ip, email) {
  const ahora = Date.now();
  for (const clave of [`cuenta:${String(email || "").slice(0, 120)}`, `ip:${ip}`]) {
    const c = leer(clave, ahora);
    contadores.set(clave, { fallos: c.fallos + 1, hasta: c.hasta });
  }
}

/** Entrar bien limpia el contador de la cuenta (no el de la IP: ahí puede
 *  haber un barrido en curso contra otras cuentas). */
export function limpiarFallosLogin(email) {
  contadores.delete(`cuenta:${String(email || "").slice(0, 120)}`);
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
