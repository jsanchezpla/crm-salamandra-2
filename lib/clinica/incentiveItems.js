/**
 * Incentivos escritos a mano — helpers PUROS (aptos para cliente y servidor).
 *
 * Un IncentiveItem es un concepto concreto ("Cambiar la bombilla del centro")
 * con valor en € ('fixed') o en % del sueldo mensual ('percent'). El importe
 * final se congela en `resolvedAmount` al crear/editar (foto): así los
 * incentivos ya escritos no cambian si el sueldo cambia después.
 */

export const VALUE_TYPE_LABEL = { fixed: "€ fijos", percent: "% del sueldo" };

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Importe en € de un item según su tipo.
 * @returns number | null  (null = percent sin sueldo base → no calculable)
 */
export function resolveItemAmount(valueType, value, salaryBase) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return null;
  if (valueType === "fixed") return round2(v);
  const base = Number(salaryBase);
  if (!Number.isFinite(base) || base <= 0) return null;
  return round2((base * v) / 100);
}

const num = (v) => (v == null ? null : Number(v));

export function serializeIncentiveItem(row) {
  const j = row.toJSON ? row.toJSON() : row;
  return {
    id: j.id,
    therapistId: j.therapistId,
    therapist: j.therapist
      ? { id: j.therapist.id, name: j.therapist.displayName, color: j.therapist.avatarColor ?? "#1B3A2D" }
      : null,
    period: { month: j.periodMonth, year: j.periodYear, value: `${j.periodYear}-${String(j.periodMonth).padStart(2, "0")}` },
    concept: j.concept,
    valueType: j.valueType,
    valueTypeLabel: VALUE_TYPE_LABEL[j.valueType] ?? j.valueType,
    value: num(j.value),
    resolvedAmount: num(j.resolvedAmount),
    salaryBase: num(j.salaryBase),
    createdAt: j.createdAt ?? null,
  };
}
