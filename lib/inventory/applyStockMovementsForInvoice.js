/**
 * applyStockMovementsForInvoice
 *
 * Aplica los descuentos de stock automáticos al emitir una factura.
 *
 * Para cada línea con `outboundProductId`:
 *   1. Busca la receta del par (outboundProductId, clientId). Si no existe,
 *      cae a la receta global (clientId NULL).
 *   2. Para cada componente de la receta, calcula los kg a descontar como
 *      lineQuantity × qtyKgPerOutputKg.
 *   3. Descuenta FIFO por entryDate de InboundBatches del InboundProduct.
 *   4. Crea un StockMovement por cada batch tocado, con reason='sale' y
 *      refs a invoiceId / invoiceLineId.
 *
 * Si una línea no tiene receta o el stock no llega, devuelve un warning
 * pero NO bloquea la emisión. El usuario verá las alertas en la respuesta.
 *
 * Requiere ejecutarse dentro de una transacción del propio sequelize del
 * tenant para que el descuento sea atómico con la actualización de la
 * factura.
 *
 * @returns Array<string> con warnings (vacío si todo OK).
 */
export async function applyStockMovementsForInvoice({ invoice, models, transaction }) {
  const { Formula, InboundBatch, StockMovement } = models;
  const warnings = [];

  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.outboundProductId) continue; // línea sin producto (texto libre o transporte)
    if (line.kind === "shipping") continue; // transporte explícito, no consume stock

    const outputKg = Number(line.quantity) || 0;
    if (outputKg <= 0) continue;

    // Buscar receta por cliente, fallback a global
    let formulas = await Formula.findAll({
      where: { outboundProductId: line.outboundProductId, clientId: invoice.clientId },
      transaction,
    });
    if (formulas.length === 0) {
      formulas = await Formula.findAll({
        where: { outboundProductId: line.outboundProductId, clientId: null },
        transaction,
      });
    }
    if (formulas.length === 0) {
      warnings.push(`Línea ${i + 1} (${line.description || line.outboundProductId}): sin receta definida, no se descuenta stock.`);
      continue;
    }

    for (const formula of formulas) {
      const kgNeeded = outputKg * Number(formula.qtyKgPerOutputKg);
      let remaining = kgNeeded;

      // FIFO: batches del InboundProduct con kgRemaining > 0, ordenados por entryDate
      const batches = await InboundBatch.findAll({
        where: { inboundProductId: formula.inboundProductId },
        order: [["entryDate", "ASC"], ["createdAt", "ASC"]],
        transaction,
      });

      for (const batch of batches) {
        if (remaining <= 0) break;
        const available = Number(batch.kgRemaining);
        if (available <= 0) continue;
        const take = Math.min(available, remaining);
        await batch.update({ kgRemaining: available - take }, { transaction });
        await StockMovement.create(
          {
            inboundBatchId: batch.id,
            kg: -take,
            reason: "sale",
            invoiceId: invoice.id,
            invoiceLineId: line.id || null,
            outboundProductId: line.outboundProductId,
            clientId: invoice.clientId,
            movedAt: new Date(),
            notes: `Emisión factura ${invoice.number || invoice.id}, línea ${i + 1}`,
          },
          { transaction }
        );
        remaining -= take;
      }

      if (remaining > 0.0001) {
        warnings.push(
          `Línea ${i + 1}: stock insuficiente para componente ${formula.inboundProductId} (faltan ${remaining.toFixed(3)} kg).`
        );
      }
    }
  }

  return warnings;
}
