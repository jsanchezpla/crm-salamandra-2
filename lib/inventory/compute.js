export function computeStatus(kg, outputKg) {
  if (!outputKg || parseFloat(outputKg) <= 0) return "stock";
  if (parseFloat(outputKg) >= parseFloat(kg || 0)) return "sold";
  return "partial";
}

export function computeMargin(product) {
  const outputKg = parseFloat(product.outputKg || 0);
  if (outputKg <= 0) return null;
  const sale = parseFloat(product.salePrice || 0);
  const buy = parseFloat(product.purchasePrice || 0);
  return (sale - buy) * outputKg;
}

export function hasOutput(product) {
  return !!(
    parseFloat(product.outputKg || 0) > 0 ||
    product.outputName ||
    product.exitDate ||
    product.clientId ||
    product.salePrice
  );
}
