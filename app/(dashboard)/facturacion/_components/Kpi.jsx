export function fmtMoney(n, currency = "EUR") {
  return `${Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "EUR" ? "€" : currency}`;
}
export function fmtPct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}
export function fmtDate(d) {
  if (!d) return "—";
  const date = typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
  return date;
}

const VARIANTS = {
  dark:    { wrap: "bg-[var(--ink-900,#15140F)] text-white border-transparent",       label: "text-white/40", value: "text-white",       sub: "text-white/40" },
  primary: { wrap: "text-white border-transparent",                                    label: "text-white/70", value: "text-white",       sub: "text-white/60" },
  amber:   { wrap: "bg-amber-50 border-amber-100",                                     label: "text-amber-700", value: "text-amber-900",  sub: "text-amber-700" },
  white:   { wrap: "bg-white border-neutral-100",                                      label: "text-neutral-400", value: "text-neutral-900", sub: "text-neutral-400" },
  emerald: { wrap: "bg-emerald-50 border-emerald-100",                                 label: "text-emerald-700", value: "text-emerald-900", sub: "text-emerald-700" },
};

export default function Kpi({ label, value, sub, variant = "white" }) {
  const s = VARIANTS[variant] ?? VARIANTS.white;
  const isPrimary = variant === "primary";
  return (
    <div
      className={`rounded-xl p-4 flex flex-col gap-1.5 border ${s.wrap}`}
      style={isPrimary ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
    >
      <span className={`eyebrow ${s.label}`} style={{ color: "currentColor" }}>{label}</span>
      <span className={`font-display text-2xl leading-none ${s.value}`}>{value}</span>
      {sub && <span className={`text-[11px] ${s.sub}`}>{sub}</span>}
    </div>
  );
}
