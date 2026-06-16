import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { verifyHmacSignature } from "../../../../../lib/training/webhookAuth.js";
import { enforceRateLimit, getClientIp } from "../../../../../lib/utils/rateLimit.js";
import { logTrainingAudit } from "../../../../../lib/training/audit.js";

/**
 * POST /api/webhooks/retorika/registro-curso
 *
 * El alumno envía el formulario inicial del curso. Crea CourseRegistration
 * en el tenant, auto-vinculando TrainingUser (por email) y Company (por NIF).
 *
 * DOS MODOS DE AUTH:
 *
 *   Modo 1 — Browser (sin HMAC):
 *     - El form HTML en asesoriaretorika.com hace POST directo desde el
 *       browser. El secret HMAC no puede vivir en JS público.
 *     - Validamos: header x-tenant=retorika + Origin/Referer con hostname
 *       en {asesoriaretorika.com, www.asesoriaretorika.com} + rate limit
 *       10/min por IP.
 *
 *   Modo 2 — Server-to-server (HMAC):
 *     - Header X-Retorika-Signature presente → validación HMAC normal
 *       sobre el rawBody. Útil para futuras integraciones o reenvíos
 *       desde WP. Rate limit 60/min por IP (defensa en profundidad).
 *
 * Idempotencia: si ya existe un CourseRegistration con el mismo
 * (email, wpProductId), devolvemos { ok: true, alreadyExists: true,
 * registrationId } sin crear duplicado.
 */

const ALLOWED_HOSTS = new Set(["asesoriaretorika.com", "www.asesoriaretorika.com"]);

function originAllowed(request) {
  const candidates = [request.headers.get("origin"), request.headers.get("referer")]
    .filter(Boolean)
    .map((u) => { try { return new URL(u).hostname; } catch { return null; } })
    .filter(Boolean);
  if (candidates.length === 0) return false;
  return candidates.some((h) => ALLOWED_HOSTS.has(h));
}

/**
 * Validación estricta del payload. Cada error apunta el campo concreto
 * para que el form de WP pueda mostrar feedback útil.
 */
function validatePayload(body) {
  const errors = [];
  const isStr = (v) => typeof v === "string" && v.trim() !== "";
  const isInt = (v) => Number.isInteger(v) && v > 0;
  const isArr = (v) => Array.isArray(v);

  if (!body || typeof body !== "object") {
    return ["body inválido"];
  }

  if (!isStr(body.userEmail) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.userEmail)) {
    errors.push("userEmail inválido");
  }
  if (body.userWpId != null && !isInt(body.userWpId)) errors.push("userWpId inválido");
  if (!isInt(body.courseWpId)) errors.push("courseWpId obligatorio (entero positivo)");
  if (!isInt(body.productWpId)) errors.push("productWpId obligatorio (entero positivo)");

  const center = body.center;
  if (!center || typeof center !== "object") {
    errors.push("center obligatorio");
  } else {
    if (!isStr(center.type)) errors.push("center.type obligatorio");
    if (!isStr(center.name)) errors.push("center.name obligatorio");
    const addr = center.address;
    if (!addr || typeof addr !== "object") errors.push("center.address obligatorio");
    else {
      if (!isStr(addr.street)) errors.push("center.address.street obligatorio");
      if (!isStr(addr.city)) errors.push("center.address.city obligatorio");
      if (!isStr(addr.state)) errors.push("center.address.state obligatorio");
      if (!isStr(addr.postalCode)) errors.push("center.address.postalCode obligatorio");
      if (!isStr(addr.country)) errors.push("center.address.country obligatorio");
    }
  }

  const teacher = body.teacher;
  if (!teacher || typeof teacher !== "object") {
    errors.push("teacher obligatorio");
  } else {
    if (teacher.yearsOfExperience != null && typeof teacher.yearsOfExperience !== "number") {
      errors.push("teacher.yearsOfExperience debe ser numérico");
    }
    for (const k of ["positions", "coursesTeaching", "subjects", "topicsOfInterest"]) {
      if (!isArr(teacher[k])) errors.push(`teacher.${k} debe ser array`);
    }
  }

  if (!body.diagnosis || typeof body.diagnosis !== "object") {
    errors.push("diagnosis obligatorio");
  }

  return errors;
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-retorika-signature");
    const ip = getClientIp(request);

    let authMode;
    let origin = null;

    if (signature) {
      // ── Modo 2 — HMAC ────────────────────────────────────────────────
      if (!verifyHmacSignature(rawBody, signature)) {
        return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
      }
      authMode = "hmac";
      // Rate limit suave: defensa en profundidad si el secret se filtra.
      const limited = enforceRateLimit(request, {
        key: "retorika-registro-submit-hmac",
        limit: 60,
        windowMs: 60_000,
      });
      if (limited) return limited;
    } else {
      // ── Modo 1 — Browser ─────────────────────────────────────────────
      const tenantHeader = request.headers.get("x-tenant");
      if (tenantHeader !== "retorika") {
        return NextResponse.json(
          { ok: false, error: "Acceso denegado" },
          { status: 401 }
        );
      }
      if (!originAllowed(request)) {
        return NextResponse.json(
          { ok: false, error: "Origen no autorizado" },
          { status: 401 }
        );
      }
      const limited = enforceRateLimit(request, {
        key: "retorika-registro-submit-browser",
        limit: 10,
        windowMs: 60_000,
      });
      if (limited) return limited;
      authMode = "browser";
      // Capturar el origin que pasó la validación, para audit log.
      const originHeader = request.headers.get("origin") ?? request.headers.get("referer");
      try { origin = originHeader ? new URL(originHeader).hostname : null; } catch { origin = null; }
    }

    // ── Parsear body ───────────────────────────────────────────────────
    let payload;
    try { payload = JSON.parse(rawBody); }
    catch { return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 }); }

    // ── Validar payload ────────────────────────────────────────────────
    const errors = validatePayload(payload);
    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Validación fallida", details: errors },
        { status: 400 }
      );
    }

    // ── Resolver tenant + check módulo ─────────────────────────────────
    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("training")) {
      return NextResponse.json({ ok: false, error: "Módulo training no activo" }, { status: 403 });
    }

    const { Course, TrainingUser, Company, CourseRegistration } = ctx.tenantModels;
    const email = payload.userEmail.trim().toLowerCase();

    // ── Idempotencia: (email, wpProductId) ya existe → noop ────────────
    const existing = await CourseRegistration.findOne({
      where: { email, wpProductId: payload.productWpId },
      attributes: ["id"],
    });
    if (existing) {
      process.stdout.write(
        `[retorika:registration:duplicate] email=${email.replace(/(.{2}).*(@.*)/, "$1***$2")} productId=${payload.productWpId} id=${existing.id}\n`
      );
      return NextResponse.json({
        ok: true,
        alreadyExists: true,
        registrationId: existing.id,
      });
    }

    // ── Find Course por wpCourseId (no creamos; debe existir) ──────────
    const course = await Course.findOne({
      where: { wpCourseId: payload.courseWpId },
      attributes: ["id"],
    });

    // ── Find-or-create TrainingUser por email ──────────────────────────
    const namePieces = [payload.userName, payload.userFirstName, payload.userDisplayName]
      .find((v) => typeof v === "string" && v.trim() !== "");
    let user = await TrainingUser.findOne({ where: { email } });
    if (!user) {
      user = await TrainingUser.create({
        email,
        name: namePieces ?? null,
        type: "private",
        active: true,
        externalUserId: Number.isInteger(payload.userWpId) ? payload.userWpId : null,
      });
    } else if (!user.externalUserId && Number.isInteger(payload.userWpId)) {
      await user.update({ externalUserId: payload.userWpId });
    }

    // ── Find Company por NIF (no creamos; Belén las crea aparte) ───────
    const centerNif = (payload.center.nif ?? "").trim() || null;
    let company = null;
    if (centerNif) {
      company = await Company.findOne({ where: { nif: centerNif }, attributes: ["id"] });
    }

    // Auto-vinculación TrainingUser → Company al primer registro del usuario.
    // NO sobrescribimos si el user ya tiene una company asignada — respetamos
    // la vinculación manual que Belén pudiera haber hecho.
    if (company && user.companyId == null) {
      await user.update({ companyId: company.id });
      process.stdout.write(
        `[retorika:registration:userLinkedToCompany] userId=${user.id} companyId=${company.id}\n`
      );
    }

    // ── Crear CourseRegistration ───────────────────────────────────────
    const row = await CourseRegistration.create({
      trainingUserId: user.id,
      courseId: course?.id ?? null,
      companyId: company?.id ?? null,
      email,
      wpUserId: Number.isInteger(payload.userWpId) ? payload.userWpId : null,
      wpProductId: payload.productWpId,
      wpCourseId: payload.courseWpId,
      submittedAt: new Date(),
      centerNif,
      centerName: payload.center.name.trim(),
      centerData: payload.center ?? {},
      teacherData: payload.teacher ?? {},
      diagnosisData: payload.diagnosis ?? {},
      rawPayload: payload,
    });

    process.stdout.write(
      `[retorika:registration:created] id=${row.id} email=${email.replace(/(.{2}).*(@.*)/, "$1***$2")} productId=${payload.productWpId} courseId=${course?.id ?? "null"} companyId=${company?.id ?? "null"} authMode=${authMode}\n`
    );

    // ── Audit log (best-effort) ────────────────────────────────────────
    logTrainingAudit({
      tenantId: ctx.tenant.id,
      userId: null,
      action: "training.course_registration.created",
      entityType: "CourseRegistration",
      entityId: row.id,
      metadata: {
        authMode,
        origin,
        email: email.replace(/(.{2}).*(@.*)/, "$1***$2"),
        productId: payload.productWpId,
        courseId: course?.id ?? null,
        companyId: company?.id ?? null,
        trainingUserId: user.id,
      },
      ip,
    });

    return NextResponse.json({
      ok: true,
      alreadyExists: false,
      registrationId: row.id,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
