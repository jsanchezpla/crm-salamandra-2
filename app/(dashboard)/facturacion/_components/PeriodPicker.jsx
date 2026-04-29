"use client";

/**
 * Selector temporal compartido por todas las páginas de Facturación.
 * Sincroniza el estado con la URL (?from=&to=&period=) para que sea
 * compartible entre páginas y refrescos.
 */
import { useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

const PRESETS = [
  { key: "month", label: "Mes" },
  { key: "quarter", label: "Trimestre" },
  { key: "year", label: "Año" },
  { key: "custom", label: "Personalizado" },
];

function fmt(d) { return d.toISOString().slice(0, 10); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function endOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }

export function computeRange(period, ref = new Date()) {
  if (period === "month") return { from: fmt(startOfMonth(ref)), to: fmt(endOfMonth(ref)) };
  if (period === "quarter") return { from: fmt(startOfQuarter(ref)), to: fmt(endOfQuarter(ref)) };
  if (period === "year") return { from: fmt(startOfYear(ref)), to: fmt(endOfYear(ref)) };
  return { from: fmt(startOfYear(ref)), to: fmt(endOfYear(ref)) };
}

export default function PeriodPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const period = sp.get("period") || "year";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";

  useEffect(() => {
    if (!from || !to) {
      const range = computeRange(period);
      const params = new URLSearchParams(sp.toString());
      params.set("from", range.from);
      params.set("to", range.to);
      params.set("period", period);
      router.replace(`${pathname}?${params.toString()}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPeriod(p) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", p);
    if (p !== "custom") {
      const range = computeRange(p);
      params.set("from", range.from);
      params.set("to", range.to);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  function setFromDate(v) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", "custom");
    params.set("from", v);
    router.replace(`${pathname}?${params.toString()}`);
  }
  function setToDate(v) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", "custom");
    params.set("to", v);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex flex-wrap gap-1 bg-white border border-neutral-200 rounded-lg p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              period === p.key
                ? "bg-[var(--color-primary,#1B3A2D)] text-white"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-auto"
        />
        <span className="text-neutral-300 text-xs shrink-0">—</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-auto"
        />
      </div>
    </div>
  );
}
