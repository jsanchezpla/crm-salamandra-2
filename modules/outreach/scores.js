/**
 * Tramos de score para los badges de encaje comercial.
 *
 *   80–100  encaje muy alto — prioridad de llamada
 *   60–79   buen encaje — merece contacto
 *   40–59   encaje medio — segunda ronda
 *    0–39   encaje bajo — descartar de momento
 *
 * La escala es verde → ámbar → gris. El dorado de marca NO se usa aquí:
 * está reservado a CTA y acentos, y un score no es una llamada a la acción.
 * Son colores semánticos, no de marca, así que no dependen del tenant.
 */
export function scoreBand(score) {
  if (score == null || Number.isNaN(Number(score))) {
    return {
      label: "Sin analizar",
      // Relleno blanco con borde: se distingue de un score real bajo (gris relleno).
      badge: "bg-white text-neutral-500 border border-neutral-200",
    };
  }
  const s = Number(score);
  if (s >= 80) return { label: "Encaje muy alto", badge: "bg-emerald-600 text-white" };
  if (s >= 60) return { label: "Buen encaje", badge: "bg-emerald-100 text-emerald-800" };
  if (s >= 40) return { label: "Encaje medio", badge: "bg-amber-100 text-amber-800" };
  return { label: "Encaje bajo", badge: "bg-zinc-200 text-zinc-600" };
}

/** Análisis de un lead para una línea de negocio concreta, o null. */
export function analysisFor(lead, businessLineId) {
  return lead?.analyses?.find((a) => a.businessLineId === businessLineId) ?? null;
}

/** Fuentes de captación con etiqueta legible. */
export const SOURCES = [
  { value: "manual", label: "Alta manual" },
  { value: "paginas_amarillas", label: "Páginas Amarillas" },
  { value: "google_maps", label: "Google Maps" },
  { value: "linkedin", label: "LinkedIn" },
];

const SOURCE_LABELS = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]));

export function sourceLabel(value) {
  return SOURCE_LABELS[value] || value || "—";
}

export function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}
