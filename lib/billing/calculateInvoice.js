/**
 * Calcula subtotal, descuento, IVA y total a partir de las líneas y configuración.
 * Devuelve los valores numéricos redondeados a 2 decimales.
 */
export function calculateInvoice({ lines = [], vatRate = 0, discountType = null, discountValue = null }) {
  const subtotal = lines.reduce((sum, line) => {
    return sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  }, 0);

  let discountAmount = 0;
  if (discountType === "percent" && discountValue > 0) {
    discountAmount = subtotal * (Number(discountValue) / 100);
  } else if (discountType === "fixed" && discountValue > 0) {
    discountAmount = Math.min(Number(discountValue), subtotal);
  }

  const discountedSubtotal = subtotal - discountAmount;
  const vatAmount = discountedSubtotal * (Number(vatRate) / 100);
  const total = discountedSubtotal + vatAmount;

  return {
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    vatAmount: round2(vatAmount),
    total: round2(total),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
