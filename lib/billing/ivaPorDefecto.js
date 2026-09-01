/**
 * ivaPorDefecto — el IVA con el que nace una línea cuando nadie eligió tipo.
 *
 * La regla es UNA y la comparten facturas y presupuestos, en el servidor y en
 * los formularios: si el emisor está exento de IVA (`vatExempt`), CERO; si no,
 * su tipo por defecto (`defaultVatRate`); sin configuración, el 21 general.
 *
 * Nació el 31/08/2026 porque los presupuestos la ignoraban: con el emisor
 * exento, la factura salía a 0 % y el presupuesto del mismo servicio a 21 %,
 * y al convertirlo en factura las líneas arrastraban ese 21 % para siempre.
 */
export function ivaPorDefecto(settings) {
  if (!settings) return 21;
  if (settings.vatExempt) return 0;
  // Number(null) y Number("") valen 0: un tipo AUSENTE no es un tipo del 0 %.
  const raw = settings.defaultVatRate;
  if (raw == null || raw === "") return 21;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 21;
}
