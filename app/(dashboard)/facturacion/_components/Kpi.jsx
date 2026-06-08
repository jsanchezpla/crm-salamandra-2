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
  // emerald: variant "tintado con el color de marca". Funciona en cualquier tenant
  // sin chocar con su paleta. En lugar de emerald hardcoded, usa var(--color-primary).
  emerald: { wrap: "border",                                                           label: "",                value: "",                sub: "" },
};

export default function Kpi({ label, value, sub, variant = "white" }) {
  const s = VARIANTS[variant] ?? VARIANTS.white;
  const isPrimary = variant === "primary";
  const isEmerald = variant === "emerald";

  let wrapStyle;
  if (isPrimary) {
    wrapStyle = { background: "var(--color-primary, #1B3A2D)" };
  } else if (isEmerald) {
    wrapStyle = {
      background: "color-mix(in srgb, var(--color-primary, #1B3A2D) 8%, white)",
      borderColor: "color-mix(in srgb, var(--color-primary, #1B3A2D) 18%, white)",
    };
  }

  const tintColor = "var(--color-primary, #1B3A2D)";

  return (
    <div
      className={`rounded-xl p-4 flex flex-col gap-1.5 border ${s.wrap}`}
      style={wrapStyle}
    >
      <span
        className={`eyebrow ${s.label}`}
        style={isEmerald ? { color: tintColor, opacity: 0.7 } : { color: "currentColor" }}
      >
        {label}
      </span>
      <span
        className={`font-display text-2xl leading-none ${s.value}`}
        style={isEmerald ? { color: tintColor } : undefined}
      >
        {value}
      </span>
      {sub && (
        <span
          className={`text-[11px] ${s.sub}`}
          style={isEmerald ? { color: tintColor, opacity: 0.7 } : undefined}
        >
          {sub}
        </span>
      )}
    </div>
  );
}
