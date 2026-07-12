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

// Recorta a `n` los campos que en BD son VARCHAR(255): un valor más largo
// (nombres de Google con reclamo publicitario, direcciones muy largas...) hacía
// fallar el INSERT entero con "value too long for character varying(255)".
// `website` y `sourceUrl` son TEXT: no se recortan. Se aplica ANTES del dedupe
// para que la búsqueda por (name, location, source) use el MISMO valor recortado
// que se guarda, y no se dupliquen leads.
function clamp(v, n = 255) {
  if (typeof v !== "string") return v ?? null;
  return v.length > n ? v.slice(0, n) : v;
}

function toRow(c) {
  return {
    name: clamp(c.name),
    sector: clamp(c.sector),
    location: clamp(c.location),
    website: c.website ?? null, // TEXT: sin recorte
    phone: clamp(c.phone),
    email: clamp(c.email),
    source: clamp(c.source, 64),
    sourceUrl: c.sourceUrl ?? null, // TEXT: sin recorte
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
    const row = toRow(c);
    const existing = await OutreachLead.findOne({
      where: { name: row.name, location: row.location ?? null, source: row.source },
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
      await OutreachLead.create(row);
      refreshed++;
      continue;
    }
    await OutreachLead.create(row);
    inserted++;
  }

  return { inserted, refreshed, keptAnalyzed, keptClient, ignored };
}
