import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { getSupportSettings, isAdminRequest } from "@/lib/support/context.js";
import { serializeSettings } from "@/lib/support/serialize.js";
import { effectiveSla, SLA_PRIORITIES, DEFAULT_SLA } from "@/lib/support/sla.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/tickets/settings — ajustes del módulo + SLA efectivo (con defaults
 * aplicados) + la URL del portal público del tenant, lista para copiar.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const settings = await getSupportSettings(ctx.tenantModels);
    return ok({
      ...serializeSettings(settings),
      slaEffective: effectiveSla(settings),
      slaDefaults: DEFAULT_SLA,
      portalPath: `/widget/c/${ctx.slug}/soporte`,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * PATCH /api/tickets/settings — solo admin.
 * Body: { slaEnabled?, slaConfig?, portalEnabled?, portalIntro?, notifyEmails?, autoClassify? }
 */
export const PATCH = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }

    const settings = await getSupportSettings(ctx.tenantModels);
    const cambios = {};

    if (body.slaEnabled !== undefined) cambios.slaEnabled = body.slaEnabled === true;
    if (body.portalEnabled !== undefined) cambios.portalEnabled = body.portalEnabled === true;
    if (body.autoClassify !== undefined) cambios.autoClassify = body.autoClassify === true;
    if (body.portalIntro !== undefined) {
      cambios.portalIntro = String(body.portalIntro || "").trim().slice(0, 600) || null;
    }

    if (body.notifyEmails !== undefined) {
      if (!Array.isArray(body.notifyEmails)) return error("notifyEmails debe ser una lista", 422);
      const emails = body.notifyEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
      const invalido = emails.find((e) => !EMAIL_RE.test(e));
      if (invalido) return error(`Email inválido: ${invalido}`, 422);
      cambios.notifyEmails = [...new Set(emails)].slice(0, 10);
    }

    if (body.slaConfig !== undefined) {
      if (typeof body.slaConfig !== "object" || Array.isArray(body.slaConfig) || !body.slaConfig) {
        return error("slaConfig inválido", 422);
      }
      // Solo se guardan valores saneados de las 4 prioridades conocidas.
      const limpio = {};
      for (const p of SLA_PRIORITIES) {
        const o = body.slaConfig[p];
        if (!o || typeof o !== "object") continue;
        const fr = Number(o.firstResponseHours);
        const rs = Number(o.resolutionHours);
        const entry = {};
        if (Number.isFinite(fr) && fr > 0 && fr <= 24 * 90) entry.firstResponseHours = fr;
        if (Number.isFinite(rs) && rs > 0 && rs <= 24 * 90) entry.resolutionHours = rs;
        if (Object.keys(entry).length) limpio[p] = entry;
      }
      cambios.slaConfig = limpio;
    }

    await settings.update(cambios);
    return ok({
      ...serializeSettings(settings),
      slaEffective: effectiveSla(settings),
      slaDefaults: DEFAULT_SLA,
      portalPath: `/widget/c/${ctx.slug}/soporte`,
    });
  } catch (err) {
    return serverError(err);
  }
});
