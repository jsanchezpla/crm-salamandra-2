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
 *      ve a Z». Solo se emite si la cuenta tiene acceso a ese cliente y hay
 *      con qué cuenta entrar (`calendarioDe` → `saltoComo`).
 *   2. El CRM lo canjea en /api/auth/saltar: comprueba firma, caducidad, que
 *      no se haya usado, que la cuenta siga existiendo y siendo de ese tenant,
 *      firma la sesión y redirige.
 *
 * El secreto de firma es distinto del de las sesiones: un pase nunca vale
 * como cookie ni al revés.
 *
 * ── UN SOLO USO, EN MEMORIA ─────────────────────────────────────────────────
 * Los `jti` canjeados se guardan en memoria del proceso hasta que caducan.
 * La app corre en UN contenedor, así que vale; el día que haya dos, esto tiene
 * que ir a master. La caducidad de sesenta segundos acota el daño de todos
 * modos: un pase robado del historial del navegador no sirve un minuto después.
 *
 * ── 12/09/2026: A DÓNDE, Y «COMO ADMIN» ─────────────────────────────────────
 * · El destino ya no es solo /calendario: también la ficha de un proyecto o su
 *   tablero. Va en el pase como una LISTA BLANCA (`a` + un UUID), nunca como
 *   ruta libre: un pase que dijera «ve a /admin/…» sería una puerta. Lo monta
 *   `destinoDelPase`, pura, con su prueba.
 * · Un admin de Salamandra puede entrar en un cliente sin cuenta vinculada,
 *   con la cuenta admin más antigua del cliente (`como: "admin"`). El canje lo
 *   revalida TODO otra vez —la cuenta sigue siendo admin de ese cliente, el
 *   cliente no es demo y quien lo pidió sigue siendo admin de Salamandra—,
 *   porque en sesenta segundos se puede degradar a alguien. Qué hace la ruta
 *   distinto en ese caso (sin refresh, sin `lastLoginAt`, auditado en el
 *   cliente) está en app/api/auth/saltar/route.js. El porqué, en
 *   docs/decisions/2026-09-12-el-calendario-global-ve-todos-y-los-proyectos.md.
 */

import { SignJWT, jwtVerify } from "jose";
import { getMasterModels } from "../db/masterDb.js";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../utils/errorTypes.js";
import { esSlugDemo } from "../demo/demos.js";
import { calendarioDe, esAdminDeSalamandra, ROLES_ADMIN } from "./acceso.js";

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

const esUuid = (v) => typeof v === "string" && UUID.test(v);
const esFecha = (v) => typeof v === "string" && FECHA.test(v);

/**
 * La ruta del CRM a la que aterriza un pase. PURA y de lista blanca:
 *
 *   a: "proyecto" + projectId UUID → /proyectos/<uuid>
 *   a: "tablero"  + projectId UUID → /proyectos/<uuid>/board
 *   cualquier otra cosa (o `a` ausente, pases de antes del 12/09)
 *                                  → /calendario[?evento=<uuid>][&fecha=YYYY-MM-DD]
 *
 * Nada del pase se copia a la ruta sin pasar por la regex: ni `..`, ni un
 * host, ni parámetros sueltos.
 */
export function destinoDelPase(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  if (p.a === "proyecto" && esUuid(p.projectId)) return `/proyectos/${p.projectId.toLowerCase()}`;
  if (p.a === "tablero" && esUuid(p.projectId)) return `/proyectos/${p.projectId.toLowerCase()}/board`;
  const destino = new URL("/calendario", "http://x");
  if (esUuid(p.taskId)) destino.searchParams.set("evento", p.taskId.toLowerCase());
  if (esFecha(p.fecha)) destino.searchParams.set("fecha", p.fecha);
  return destino.pathname + destino.search;
}

/** Texto o null: lo que llega del cuerpo puede ser cualquier cosa. */
const texto = (v) => (v == null || v === "" ? null : String(v));

/**
 * Valida el destino pedido y lo deja en los tres campos del pase. Se hace
 * ANTES de mirar la base: un destino malo no gasta consultas.
 */
function normalizarDestino(destino) {
  const d = destino && typeof destino === "object" ? destino : {};
  const tipo = d.tipo ?? "calendario";
  if (tipo === "proyecto" || tipo === "tablero") {
    const projectId = texto(d.projectId);
    if (!esUuid(projectId)) throw new ValidationError("Proyecto inválido");
    return { a: tipo, taskId: null, fecha: null, projectId };
  }
  if (tipo !== "calendario") throw new ValidationError("Destino inválido");
  const taskId = texto(d.taskId);
  const fecha = texto(d.fecha);
  if (taskId && !esUuid(taskId)) throw new ValidationError("Evento inválido");
  if (fecha && !esFecha(fecha)) throw new ValidationError("Fecha inválida");
  return { a: "calendario", taskId, fecha, projectId: null };
}

/**
 * Emite el pase. Devuelve la URL completa a la que mandar al navegador, con
 * qué cuenta se entrará (`como`, `email`) para que la pantalla lo diga.
 *
 * `destino` = { tipo: "calendario", taskId?, fecha? } | { tipo: "proyecto",
 * projectId } | { tipo: "tablero", projectId }. Se sigue aceptando la forma
 * vieja `{ taskId, fecha }` sueltos, que es un destino de calendario.
 */
export async function emitirSalto({ usuarioId, slug, destino = null, taskId = null, fecha = null }) {
  const d = normalizarDestino(destino ?? { tipo: "calendario", taskId, fecha });

  const entrada = await calendarioDe(usuarioId, slug);
  if (!entrada) throw new ForbiddenError("No tienes acceso a ese cliente");
  if (!entrada.saltoComo || !entrada.saltoUsuarioId) {
    throw new ForbiddenError("No hay cuenta con la que entrar en ese cliente");
  }

  const jti = crypto.randomUUID();
  const token = await new SignJWT({
    p: PROPOSITO,
    slug,
    a: d.a,
    taskId: d.taskId,
    fecha: d.fecha,
    projectId: d.projectId,
    // Quién lo pidió, para la auditoría del canje (y, «como admin», para
    // volver a comprobar que sigue siéndolo).
    desde: usuarioId,
    como: entrada.saltoComo,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(entrada.saltoUsuarioId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SEGUNDOS}s`)
    .sign(secreto());

  const url = new URL("/api/auth/saltar", urlBaseCrm());
  url.searchParams.set("t", token);
  return { url: url.toString(), caducaEn: SEGUNDOS, como: entrada.saltoComo, email: entrada.saltoEmail };
}

/**
 * Canjea el pase. Devuelve la cuenta con la que abrir sesión, su tenant, la
 * ruta de destino, quién lo pidió y `como` ("cuenta" | "admin"). Lanza
 * `UnauthorizedError` ante cualquier duda: un pase malo se trata igual que una
 * contraseña mala.
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

  const desde = typeof payload.desde === "string" ? payload.desde : null;
  const como = payload.como === "admin" ? "admin" : "cuenta";
  if (como === "admin") {
    // Entrar en la cuenta de OTRO solo vale si todo sigue igual que al emitir.
    if (!ROLES_ADMIN.includes(user.role)) throw new UnauthorizedError("La cuenta de salto ya no es admin");
    if (esSlugDemo(tenant.slug)) throw new UnauthorizedError("No se entra como admin en una demo");
    if (!desde || !(await esAdminDeSalamandra(desde))) {
      throw new UnauthorizedError("Quien pidió el pase ya no es admin de Salamandra");
    }
  }

  return { user, tenant, destino: destinoDelPase(payload), desde, como };
}
