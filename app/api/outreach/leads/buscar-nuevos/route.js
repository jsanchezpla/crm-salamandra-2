import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { searchGooglePlaces, GOOGLE_MONTHLY_LIMIT, currentMonth } from "../../../../../lib/outreach/googlePlaces.js";
import { extractEmailFromWebsite } from "../../../../../lib/outreach/enrichWebsite.js";
import { upsertScrapedLeads } from "../../../../../lib/outreach/persistLeads.js";
import { callScrapingWebhook } from "../../../../../lib/outreach/scraping.js";
import { sendEmail } from "../../../../../lib/email/resendClient.js";
import { decryptSecret } from "../../../../../lib/crypto/secretBox.js";
import { getTenantResendConfig } from "../../../../../lib/outreach/resendConfig.js";

const VALID_SOURCES = ["paginas_amarillas", "google_maps", "linkedin"];
const ENRICH_CONCURRENCY = 5;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    // La auditoría nunca rompe la request.
  }
}

/**
 * Recorre `items` aplicando `fn` con un tope de tareas en paralelo. Se usa para
 * visitar muchas webs a la vez sin disparar el tiempo total de la request.
 */
async function mapPool(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/**
 * Aviso por email cuando el tenant cruza el umbral mensual de Google. Best-effort:
 * nunca rompe la búsqueda. Usa la credencial propia del outreach si existe.
 */
async function sendQuotaWarning({ to, tenantName, count, limit, resend }) {
  if (!to || !resend?.apiKey) return; // sin clave de Resend del tenant, no se avisa
  try {
    await sendEmail({
      to,
      subject: `Aviso: límite de búsquedas de Google casi alcanzado (${count}/${limit})`,
      text:
        `Has usado ${count} de ${limit} búsquedas de Google Places este mes en el módulo de Captación` +
        (tenantName ? ` de ${tenantName}` : "") +
        `.\n\nAl llegar a ${limit}, el CRM deja de buscar en Google hasta el día 1 del mes siguiente, ` +
        `para no superar la cuota gratuita. El contador se reinicia solo cada mes.\n\n— CRM Salamandra`,
      from: resend.fromEmail || undefined,
      replyTo: resend.replyTo || undefined,
      apiKey: resend.apiKey,
      tags: [
        { name: "module", value: "outreach" },
        { name: "kind", value: "quota-warning" },
      ],
    });
  } catch {
    // El aviso nunca rompe la búsqueda.
  }
}

/**
 * POST /api/outreach/leads/buscar-nuevos — modo "Buscar nuevos".
 *
 * google_maps se resuelve NATIVO: se consulta la Google Places API con la clave
 * del tenant (Configuración → IA), y por cada negocio se visita su web para
 * sacar el email (fase 2). Las demás fuentes (paginas_amarillas, linkedin)
 * siguen delegándose a n8n si hay webhook configurado.
 *
 * NUNCA se llama por defecto: leer de BD es el modo normal. El dedupe se apoya
 * en el índice único (name, location, source).
 */
export const POST = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("outreach")) throw new ForbiddenError();
  // Demo pública: Google Places se cobra por consulta y el contador mensual de
  // uso vive en el schema demo, que el auto-reset repone (tope inservible ahí).
  assertNotDemoPaidCall(ctx, "La búsqueda de empresas");
  const { OutreachLead } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const sector = body?.sector?.trim() || null;
  const location = body?.location?.trim() || null;
  if (!sector && !location) {
    throw new ValidationError("Indica al menos un sector o una ubicación");
  }

  const sources = Array.isArray(body?.sources) ? body.sources.filter((s) => VALID_SOURCES.includes(s)) : [];
  if (sources.length === 0) {
    throw new ValidationError(`Elige al menos una fuente: ${VALID_SOURCES.join(", ")}`);
  }

  const companies = [];
  let enriched = 0; // cuántas empresas trajeron email de su web
  let googleUsage = null; // { count, limit } tras contar la petición

  // ── Google Maps: nativo (Places API con la key del tenant + email de la web) ──
  if (sources.includes("google_maps")) {
    const storedKey = ctx.tenant.settings?.integrations?.googlePlacesApiKey;
    let apiKey = null;
    if (storedKey) {
      try {
        apiKey = decryptSecret(storedKey); // guardada cifrada en reposo
      } catch {
        apiKey = null;
      }
    }
    if (!apiKey) {
      throw new AppError(
        "Configura tu clave de Google Places en Configuración → Inteligencia Artificial antes de buscar en Google Maps.",
        400
      );
    }

    // Contador mensual per-tenant: corta a GOOGLE_MONTHLY_LIMIT y se reinicia al
    // cambiar de mes. Es el tope propio del CRM (independiente de la cuota de Google).
    const { OutreachSettings } = ctx.tenantModels;
    const settings = (await OutreachSettings.findOne()) ?? (await OutreachSettings.create({}));
    const month = currentMonth();
    if (settings.googlePlacesUsageMonth !== month) {
      settings.googlePlacesUsageMonth = month;
      settings.googlePlacesUsageCount = 0;
    }
    if (settings.googlePlacesUsageCount >= GOOGLE_MONTHLY_LIMIT) {
      throw new AppError(
        `Has alcanzado el límite de ${GOOGLE_MONTHLY_LIMIT} búsquedas de Google de este mes. Se reactiva el día 1.`,
        429
      );
    }

    let places;
    try {
      places = await searchGooglePlaces({ apiKey, sector, location });
    } catch (err) {
      if (err.code === "QUOTA") throw new AppError("Has agotado la cuota gratuita de Google de este mes.", 429);
      if (err.code === "BAD_KEY") throw new AppError("Tu clave de Google no es válida o no tiene la Places API activada.", 400);
      if (err.code === "UNREACHABLE") throw new AppError(err.message, 504);
      console.error("[outreach:google]", err);
      throw new AppError("La búsqueda en Google ha fallado. Inténtalo de nuevo.", 502);
    }

    // Contabilizar la petición (1 llamada a Text Search) y avisar una sola vez
    // al mes cuando se cruza el umbral.
    settings.googlePlacesUsageCount += 1;
    const warnNow = settings.googlePlacesUsageCount >= GOOGLE_MONTHLY_LIMIT && settings.googlePlacesWarnedMonth !== month;
    if (warnNow) settings.googlePlacesWarnedMonth = month;
    await settings.save();
    googleUsage = {
      count: settings.googlePlacesUsageCount,
      limit: GOOGLE_MONTHLY_LIMIT,
      remaining: Math.max(0, GOOGLE_MONTHLY_LIMIT - settings.googlePlacesUsageCount),
    };
    if (warnNow) {
      await sendQuotaWarning({
        to: request.headers.get("x-user-email"),
        tenantName: ctx.tenant.name,
        count: settings.googlePlacesUsageCount,
        limit: GOOGLE_MONTHLY_LIMIT,
        resend: getTenantResendConfig(ctx),
      });
    }

    // Fase 2: sacar el email visitando la web de cada negocio (en paralelo).
    await mapPool(places, ENRICH_CONCURRENCY, async (p) => {
      if (p.website) {
        try {
          p.email = await extractEmailFromWebsite(p.website);
        } catch {
          p.email = null;
        }
        if (p.email) enriched++;
      }
    });
    companies.push(...places);
  }

  // ── Páginas Amarillas / LinkedIn: siguen vía n8n si hay webhook configurado ──
  const webhookSources = sources.filter((s) => s !== "google_maps");
  if (webhookSources.length > 0) {
    try {
      const fromWebhook = await callScrapingWebhook({ sector, location, sources: webhookSources });
      companies.push(...fromWebhook);
    } catch (err) {
      // Si Google ya trajo resultados, no rompemos por el webhook; solo lo
      // registramos. Si era la única fuente pedida, sí es un error.
      const onlyWebhook = !sources.includes("google_maps");
      if (err.code === "NO_WEBHOOK") {
        if (onlyWebhook) throw new AppError("El scraping de Páginas Amarillas/LinkedIn no está configurado en este entorno.", 503);
      } else {
        console.error("[outreach:webhook]", err);
        if (onlyWebhook) throw new AppError("El scraping ha fallado. Inténtalo de nuevo.", 502);
      }
    }
  }

  // Insertar / refrescar con dedupe por (name, location, source). Detalle de la
  // regla (analizado intacto, no-analizado se refresca) en lib/outreach/persistLeads.
  const { inserted, refreshed, keptAnalyzed, keptClient, ignored } = await upsertScrapedLeads(OutreachLead, companies);

  await auditLog({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "outreach.scraping.run",
    entity: "OutreachLead",
    entityId: null,
    before: null,
    after: { sector, location, sources, inserted, refreshed, keptAnalyzed, keptClient, ignored, enriched, googleUsed: googleUsage?.count ?? null },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ inserted, refreshed, keptAnalyzed, keptClient, ignored, enriched, total: companies.length, googleUsage });
});
