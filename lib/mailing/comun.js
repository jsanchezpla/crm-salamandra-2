import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errorTypes.js";
import { normalizarEmail } from "./bajaToken.js";

/**
 * lib/mailing/comun.js — lo que repiten los ~25 endpoints de /api/mailing:
 * la puerta del módulo, leer el cuerpo, validar ids y correos, y cómo se
 * serializa cada cosa hacia la pantalla.
 *
 * (Fichero nuevo en /lib, regla #2: un módulo con tantas rutas como este, con
 * la puerta copiada en cada una, acaba con una ruta que se olvida de mirar el
 * módulo. Importa de `errorTypes.js` y no de `errors.js` para que lo puedan
 * cargar las pruebas y los scripts sin arrastrar Next.)
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MODULO = "mailing";

/** Toda ruta de /api/mailing empieza aquí. */
export function exigirMailing(ctx) {
  if (!ctx.hasModule(MODULO)) throw new ForbiddenError("Este centro no tiene el módulo de Mailing");
}

export function esAdmin(ctx) {
  const rol = String(ctx?.user?.role ?? "");
  return rol === "admin" || rol === "superadmin";
}

export async function leerBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new ValidationError("Body inválido");
  }
}

export async function idDeRuta(rc, nombre = "id") {
  const params = await rc.params;
  const id = String(params?.[nombre] ?? "");
  if (!UUID_RE.test(id)) throw new ValidationError("Identificador inválido");
  return id;
}

/** Quién hace la petición, para `created_by`: el correo del JWT. */
export function autorDe(request) {
  return request.headers.get("x-user-email") || null;
}

export function esEmail(v) {
  return EMAIL_RE.test(String(v ?? "").trim());
}

/** Un correo válido y normalizado, o ValidationError. */
export function emailValido(v, que = "El correo") {
  const email = normalizarEmail(v);
  if (!esEmail(email)) throw new ValidationError(`${que} no es válido`);
  return email;
}

export function texto(v, max, { requerido = false, nombre = "El texto" } = {}) {
  const s = String(v ?? "").trim().slice(0, max);
  if (requerido && !s) throw new ValidationError(`${nombre} no puede quedar vacío`);
  return s || null;
}

export async function buscarOFallar(Modelo, id, que = "Eso") {
  const fila = await Modelo.findByPk(id);
  if (!fila) throw new NotFoundError(`${que} ya no existe`);
  return fila;
}

// ── Serialización hacia la pantalla ─────────────────────────────────────────

export function serializarContacto(c) {
  return {
    id: c.id,
    email: c.email,
    nombre: c.nombre ?? null,
    origen: c.origen,
    estado: c.estado,
    consentimiento: c.consentimiento ?? {},
    confirmadoAt: c.confirmadoAt,
    confirmacionEnviadaAt: c.confirmacionEnviadaAt,
    notas: c.notas ?? null,
    creadoPor: c.createdBy ?? null,
    creadoEn: c.createdAt,
  };
}

export function serializarSegmento(s, extra = {}) {
  return {
    id: s.id,
    nombre: s.nombre,
    descripcion: s.descripcion ?? null,
    reglas: s.reglas ?? {},
    creadoPor: s.createdBy ?? null,
    actualizadoEn: s.updatedAt,
    ...extra,
  };
}

export function serializarCampana(c, extra = {}) {
  return {
    id: c.id,
    nombre: c.nombre,
    asunto: c.asunto ?? "",
    preheader: c.preheader ?? "",
    bloques: Array.isArray(c.bloques) ? c.bloques : [],
    audiencia: c.audiencia,
    segmentId: c.segmentId ?? null,
    segmento: c.segment ? { id: c.segment.id, nombre: c.segment.nombre } : null,
    replyTo: c.replyTo ?? null,
    estado: c.estado,
    programadaPara: c.programadaPara,
    empezadaAt: c.empezadaAt,
    terminadaAt: c.terminadaAt,
    totalDestinatarios: c.totalDestinatarios ?? 0,
    enviados: c.enviados ?? 0,
    fallidos: c.fallidos ?? 0,
    suprimidos: c.suprimidos ?? 0,
    ultimoError: c.ultimoError ?? null,
    creadoPor: c.createdBy ?? null,
    creadoEn: c.createdAt,
    actualizadoEn: c.updatedAt,
    // Sprint 2
    tipo: c.tipo ?? "campana",
    sequenceId: c.sequenceId ?? null,
    periodo: c.periodo ?? null,
    asuntoB: c.asuntoB ?? "",
    abPorcentaje: c.abPorcentaje ?? null,
    abEsperaHoras: c.abEsperaHoras ?? null,
    abGanador: c.abGanador ?? null,
    abDecididoAt: c.abDecididoAt ?? null,
    ritmoPorHora: c.ritmoPorHora ?? null,
    ...extra,
  };
}

export function serializarSecuencia(s, extra = {}) {
  return {
    id: s.id,
    nombre: s.nombre,
    evento: s.evento,
    activa: !!s.activa,
    activadaDesde: s.activadaDesde ?? null,
    dias: s.dias,
    hora: s.hora,
    asunto: s.asunto ?? "",
    preheader: s.preheader ?? "",
    bloques: Array.isArray(s.bloques) ? s.bloques : [],
    replyTo: s.replyTo ?? null,
    creadoPor: s.createdBy ?? null,
    creadoEn: s.createdAt,
    actualizadoEn: s.updatedAt,
    ...extra,
  };
}

export function serializarPlantilla(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    tipo: p.tipo,
    asunto: p.asunto ?? "",
    preheader: p.preheader ?? "",
    bloques: Array.isArray(p.bloques) ? p.bloques : [],
    creadoPor: p.createdBy ?? null,
    actualizadoEn: p.updatedAt,
  };
}

/** Los estados desde los que una campaña se puede EDITAR. */
export const EDITABLES = new Set(["borrador", "programada", "pausada", "cancelada"]);

export function exigirEditable(campana) {
  if (!EDITABLES.has(campana.estado)) {
    throw new ValidationError(
      campana.estado === "enviando"
        ? "La campaña se está enviando: páusala antes de tocarla"
        : "Una campaña ya enviada no se edita: duplícala"
    );
  }
}
