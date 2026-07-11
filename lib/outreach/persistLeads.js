/**
 * Persistencia de empresas scrapeadas como leads, con dedupe por
 * (name, location, source):
 *
 *   · Ya es CLIENTE (convertido)    → intacto (ya es nuestro, no se re-capta).
 *   · Ya existe y ESTÁ analizado    → intacto (no se repite ni se pisa su análisis).
 *   · Ya existe y NO está analizado → se borra el viejo y se re-inserta fresco
 *     (datos actualizados y sube arriba, porque la lista ordena por creación).
 *   · No existe                     → se inserta.
 *
 * Se extrae del Route Handler para poder testearla de forma aislada.
 * Devuelve { inserted, refreshed, keptAnalyzed, keptClient, ignored }.
 */

function toRow(c) {
  return {
    name: c.name,
    sector: c.sector ?? null,
    location: c.location ?? null,
    website: c.website ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    source: c.source,
    sourceUrl: c.sourceUrl ?? null,
    rawData: c.rawData ?? {},
    analyzed: false,
  };
}

export async function upsertScrapedLeads(OutreachLead, companies) {
  let inserted = 0;
  let refreshed = 0;
  let keptAnalyzed = 0;
  let keptClient = 0;
  let ignored = 0;

  for (const c of companies) {
    if (!c?.name) {
      ignored++;
      continue;
    }
    const existing = await OutreachLead.findOne({
      where: { name: c.name, location: c.location ?? null, source: c.source },
    });
    if (existing) {
      if (existing.converted) {
        // Ya es cliente: no se re-capta.
        keptClient++;
        continue;
      }
      if (existing.analyzed) {
        keptAnalyzed++;
        continue;
      }
      // No analizado: fuera el viejo, dentro el nuevo (fresco y arriba).
      await existing.destroy();
      await OutreachLead.create(toRow(c));
      refreshed++;
      continue;
    }
    await OutreachLead.create(toRow(c));
    inserted++;
  }

  return { inserted, refreshed, keptAnalyzed, keptClient, ignored };
}
