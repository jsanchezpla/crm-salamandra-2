"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const inputCls =
  "w-full rounded-md px-3 py-2 text-sm text-neutral-800 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

export default function PedidosConfiguracionPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    transportPrice: 0,
    transportVatRate: 21,
    defaultVatRate: 21,
  });

  useEffect(() => {
    fetch("/api/orders/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setForm({
            transportPrice: Number(j.data.transportPrice ?? 0),
            transportVatRate: Number(j.data.transportVatRate ?? 21),
            defaultVatRate: Number(j.data.defaultVatRate ?? 21),
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/orders/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error guardando");
      setForm({
        transportPrice: Number(j.data.transportPrice ?? 0),
        transportVatRate: Number(j.data.transportVatRate ?? 21),
        defaultVatRate: Number(j.data.defaultVatRate ?? 21),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent)]">
      <div className="px-4 lg:px-10 pt-8 pb-5 shrink-0 border-b border-[var(--ink-200)]">
        <Link
          href="/pedidos"
          className="inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-800 mb-2 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Pedidos
        </Link>
        <div className="eyebrow mb-1.5 lg:mb-2">Operaciones · Pedidos</div>
        <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
          Configuración <span className="font-display-italic text-[var(--ink-400)]">— transporte e IVA</span>
        </h1>
      </div>

      <div className="flex-1 overflow-auto px-4 lg:px-10 py-6 max-w-2xl w-full mx-auto">
        {loading ? (
          <div className="text-sm text-neutral-400">Cargando…</div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-5">
            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            {success && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                Guardado correctamente.
              </div>
            )}

            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1">
                Precio de transporte por pedido (€)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.transportPrice}
                onChange={(e) =>
                  setForm((f) => ({ ...f, transportPrice: e.target.value }))
                }
                className={inputCls}
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Se añadirá como una línea adicional de transporte en cada pedido que se complete.
                Puedes ajustar el importe en cada pedido si hace falta.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1">
                IVA aplicado al transporte (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.transportVatRate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, transportVatRate: e.target.value }))
                }
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-neutral-700 mb-1">
                IVA por defecto en líneas de producto (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.defaultVatRate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, defaultVatRate: e.target.value }))
                }
                className={inputCls}
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Se aplica al generar la factura desde un pedido completado. Si tu configuración
                de facturación define otro IVA por defecto, este lo sobreescribe para los pedidos.
              </p>
            </div>

            <div className="pt-3 border-t border-neutral-100 flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar configuración"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
