/**
 * lib/calendario-global/salto.js — del calendario global al tenant sin volver
 * a teclear la contraseña (03/09/2026, Rodrigo: «que ese subdominio tuviera la
 * sesión iniciada automáticamente de los tenants afectados»).
 *
 * ── POR QUÉ UN PASE Y NO UNA COOKIE COMPARTIDA ──────────────────────────────
 * La cookie de sesión del CRM es de host único y en modo estricto
 * (lib/auth/jwt.js), y eso es una decisión de seguridad que no se toca: una
 * sesión de `calendar.` no viaja a `crm.` y al revés. Lo que hace falta es que
 * `crm.` ABRA su propia sesión al llegar desde el global, y para eso el
 * global le da un pase:
 *
 *   1. El global emite un token firmado, de UN SOLO USO y que caduca en
 *      sesenta segundos, que dice «abre sesión con la cuenta X del tenant Y y
 *      ve al evento Z». Solo se emite si hay vínculo y ese vínculo tiene
 *      cuenta de salto (`tenantUsuarioId`).
 *   2. El CRM lo canjea en /api/auth/saltar: comprueba firma, caducidad, que
 *      no se haya usado, que la cuenta siga existiendo y siendo de ese tenant,
 *      firma la sesión normal (los mismos tokens que el login) y redirige.
 *
 * El secreto de firma es distinto del de las sesiones: un pase nunca vale
 * como cookie ni al revés.
 *
 * ── UN SOLO USO, EN MEMORIA ─────────────────────────────────────────────────
 * Los `jti` canjeados se guardan en memoria del proceso hasta que caducan.
 * La app corre en UN contenedor, así que vale; el día que haya dos, esto tiene
 * que ir a master. La caducidad de sesenta segundos acota el daño de todos
 * modos: un pase robado del historial del navegador no sirve un minuto después.
 */

import { SignJWT, jwtVerify } from "jose";
import { getMasterModels } from "../db/masterDb.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errorTypes.js";
import { vinculoDe } from "./vinculos.js";

const SEGUNDOS = 60;
const PROPOSITO = "calendario-global:salto";

function secreto() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET no configurado");
  return new TextEncoder().encode(process.env.JWT_SECRET + "_salto");
}

/** Dónde vive el CRM de los clientes, para construir la URL del pase. */
export function urlBaseCrm() {
  const v = (process.env.CRM_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!v) throw new Error("CRM_PUBLIC_URL no configurada: el calendario global no sabe a dónde saltar");
  return v;
}

// jti canjeados → instante en que caducan (ms). Se limpian al pasar por aquí.
const canjeados = new Map();
function limpiar() {
  const ahora = Date.now();
  for (const [jti, hasta] of canjeados) if (hasta <= ahora) canjeados.delete(jti);
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Emite el pase. Devuelve la URL completa a la que mandar al navegador.
 * `taskId`/`fecha` son opcionales: sin ellos se aterriza en /calendario.
 */
export async function emitirSalto({ usuarioId, slug, taskId = null, fecha = null }) {
  const vinculo = await vinculoDe(usuarioId, slug);
  if (!vinculo) throw new ForbiddenError("Ese calendario no está vinculado a tu cuenta");
  if (!vinculo.tenantUsuarioId) {
    throw new ForbiddenError("Este calendario no tiene cuenta de salto: pide que se vincule una cuenta de ese cliente");
  }
  if (taskId && !UUID.test(taskId)) throw new ForbiddenError("Evento inválido");
  if (fecha && !FECHA.test(fecha)) throw new ForbiddenError("Fecha inválida");

  const jti = crypto.randomUUID();
  const token = await new SignJWT({
    p: PROPOSITO,
    slug,
    taskId: taskId || null,
    fecha: fecha || null,
    // Quién lo pidió, para la auditoría del canje.
    desde: usuarioId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(vinculo.tenantUsuarioId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SEGUNDOS}s`)
    .sign(secreto());

  const url = new URL("/api/auth/saltar", urlBaseCrm());
  url.searchParams.set("t", token);
  return { url: url.toString(), caducaEn: SEGUNDOS };
}

/**
 * Canjea el pase. Devuelve la cuenta con la que abrir sesión, su tenant y la
 * ruta de destino. Lanza `UnauthorizedError` ante cualquier duda: un pase
 * malo se trata igual que una contraseña mala.
 */
export async function canjearSalto(token) {
  if (!token || typeof token !== "string") throw new UnauthorizedError("Pase inválido");

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secreto(), { maxTokenAge: `${SEGUNDOS}s` }));
  } catch {
    throw new UnauthorizedError("Pase caducado o inválido");
  }
  if (payload.p !== PROPOSITO || !payload.jti || !payload.sub) throw new UnauthorizedError("Pase inválido");

  limpiar();
  if (canjeados.has(payload.jti)) throw new UnauthorizedError("Ese pase ya se usó");
  canjeados.set(payload.jti, (payload.exp ?? 0) * 1000 || Date.now() + SEGUNDOS * 1000);

  const { User, Tenant } = getMasterModels();
  const user = await User.findByPk(payload.sub);
  if (!user || user.soloBackoffice) throw new UnauthorizedError("La cuenta de salto ya no vale");
  const tenant = await Tenant.findOne({ where: { id: user.tenantId, status: "active" } });
  if (!tenant || tenant.slug !== payload.slug) throw new UnauthorizedError("La cuenta de salto ya no es de ese cliente");

  const destino = new URL("/calendario", "http://x");
  if (payload.taskId && UUID.test(payload.taskId)) destino.searchParams.set("evento", payload.taskId);
  if (payload.fecha && FECHA.test(payload.fecha)) destino.searchParams.set("fecha", payload.fecha);

  return {
    user,
    tenant,
    destino: destino.pathname + destino.search,
    desde: typeof payload.desde === "string" ? payload.desde : null,
  };
}
