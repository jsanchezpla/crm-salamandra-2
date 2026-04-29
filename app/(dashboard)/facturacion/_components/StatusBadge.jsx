const INVOICE_STATUS = {
  draft:           { label: "Borrador",       cls: "bg-neutral-100 text-neutral-500 border-neutral-200" },
  issued:          { label: "Emitida",        cls: "bg-sky-50 text-sky-700 border-sky-100" },
  sent:            { label: "Enviada",        cls: "bg-blue-50 text-blue-700 border-blue-100" },
  partially_paid:  { label: "Pago parcial",   cls: "bg-amber-50 text-amber-700 border-amber-100" },
  paid:            { label: "Cobrada",        cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  overdue:         { label: "Vencida",        cls: "bg-red-50 text-red-700 border-red-100" },
  cancelled:       { label: "Cancelada",      cls: "bg-neutral-100 text-neutral-400 border-neutral-200 line-through" },
  rectified:       { label: "Rectificada",    cls: "bg-purple-50 text-purple-700 border-purple-100" },
};

const PAYMENT_STATUS = {
  pending:   { label: "Pendiente",  cls: "bg-amber-50 text-amber-700 border-amber-100" },
  completed: { label: "Completado", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  failed:    { label: "Fallido",    cls: "bg-red-50 text-red-700 border-red-100" },
  refunded:  { label: "Reembolsado",cls: "bg-purple-50 text-purple-700 border-purple-100" },
};

export default function StatusBadge({ status, kind = "invoice" }) {
  const map = kind === "payment" ? PAYMENT_STATUS : INVOICE_STATUS;
  const s = map[status] ?? { label: status, cls: "bg-neutral-100 text-neutral-500 border-neutral-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.cls}`}>
      {s.label}
    </span>
  );
}

export const INVOICE_STATUS_LABELS = INVOICE_STATUS;
export const PAYMENT_STATUS_LABELS = PAYMENT_STATUS;
