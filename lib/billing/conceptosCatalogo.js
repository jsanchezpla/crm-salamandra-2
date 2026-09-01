/**
 * conceptosCatalogo — qué acepta el catálogo de conceptos y cómo rellena una
 * línea (31/08/2026).
 *
 * Dos piezas puras, compartidas por la API y el formulario:
 *   - limpiarConcepto(body): sanea un alta/edición. Nombre obligatorio,
 *     importe e IVA numéricos y no negativos, categoría y periodicidad
 *     recortadas. Devuelve { valores, problema }.
 *   - lineaDesdeConcepto(concepto): la línea de factura que sale de elegirlo —
 *     texto (description o name), cantidad 1, su precio y su IVA.
 */
const texto = (v, max) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, max) : null;
};

export function limpiarConcepto(body, { parcial = false } = {}) {
  const valores = {};
  if (!parcial || "name" in body) {
    const name = texto(body?.name, 120);
    if (!name) return { valores: null, problema: "El nombre del concepto es obligatorio" };
    valores.name = name;
  }
  if (!parcial || "description" in body) valores.description = texto(body?.description, 2000);
  if (!parcial || "unitPrice" in body) {
    const n = Number(body?.unitPrice);
    // Negativo SÍ vale (31/08/2026): un concepto de descuento fijo —«Reserva
    // ya abonada: −30 €»— se elige del catálogo como cualquier otro.
    if (!Number.isFinite(n)) return { valores: null, problema: "El importe tiene que ser un número" };
    valores.unitPrice = Math.round(n * 100) / 100;
  }
  if (!parcial || "vatRate" in body) {
    const n = Number(body?.vatRate ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { valores: null, problema: "El IVA tiene que estar entre 0 y 100" };
    valores.vatRate = Math.round(n * 100) / 100;
  }
  if (!parcial || "category" in body) valores.category = texto(body?.category, 80);
  if (!parcial || "periodicity" in body) valores.periodicity = texto(body?.periodicity, 20);
  if ("sortOrder" in (body || {})) {
    const n = Number(body.sortOrder);
    valores.sortOrder = Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return { valores, problema: null };
}

export function lineaDesdeConcepto(concepto) {
  if (!concepto) return null;
  return {
    description: (concepto.description && String(concepto.description).trim()) || concepto.name || "",
    quantity: 1,
    unitPrice: Number(concepto.unitPrice) || 0,
    discountPct: 0,
    vatRate: Number(concepto.vatRate) || 0,
  };
}
