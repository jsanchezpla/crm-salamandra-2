"use client";

/**
 * PartirFacturaModal — partir una factura del lote en varias, por paciente o
 * por terapia (06/09/2026, Rodrigo: «es importante que se pueda editar una
 * factura por si se le ha aplicado a toda la familia y a posteriori quieren
 * revisarla para partirla en varias facturas»).
 *
 * Habla con /api/billing/invoices/[id]/partir (GET = vista previa, POST =
 * hacerlo). El modal dice en voz alta lo que va a pasar con los números —la
 * original se anula con una R y las nuevas cogen los siguientes— porque es lo
 * único que se puede hacer: una factura emitida no cambia de número.
 */

import { useEffect, useState } from "react";
import { fmtMoney } from "./Kpi.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

export default function PartirFacturaModal({ invoice, onClose, onDone }) {
  const [por, setPor] = useState("paciente");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fecha, setFecha] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!invoice?.id) return;
    setLoading(true);
    setErrorMsg(null);
    fetch(`/api/billing/invoices/${invoice.id}/partir?por=${por}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.error || "Error");
        setPreview(j.data);
        if (!fecha) setFecha(j.data.fechaPropuesta || "");
      })
      .catch((e) => { setPreview(null); setErrorMsg(e.message); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, por]);

  async function partir() {
    setSaving(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/invoices/${invoice.id}/partir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ por, issueDate: fecha || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo partir");
      setResultado(j.data);
      onDone?.(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={saving ? undefined : onClose} />
      <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 overflow-y-auto pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg bg-white rounded-2xl shadow-pop my-8">
          <div className="px-6 pt-5 pb-4 border-b border-neutral-100 flex items-center justify-between">
            <div>
              <div className="eyebrow">Partir factura</div>
              <h3 className="font-display text-lg text-neutral-900 mt-0.5">{invoice.number} · {fmtMoney(invoice.total)}</h3>
            </div>
            <button onClick={onClose} disabled={saving} className="text-neutral-300 hover:text-neutral-700 p-1 disabled:opacity-40" aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {resultado ? (
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-800">
                Hecho. La {invoice.number} queda anulada con la <b>{resultado.rectificativa.numero}</b> y en su lugar hay{" "}
                <b>{resultado.nuevas.length} facturas</b> nuevas, ya cobradas, con los números siguientes de la serie.
              </div>
              <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden">
                {resultado.nuevas.map((n) => (
                  <li key={n.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate text-neutral-800">{n.paciente ?? n.terapia ?? "—"} <span className="text-neutral-400">· {n.cobros} {n.cobros === 1 ? "cobro" : "cobros"}</span></span>
                    <span className="font-mono text-[var(--color-primary,#1B3A2D)]">{n.numero}</span>
                    <span className="font-semibold tabular text-neutral-900">{fmtMoney(n.importe)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white" style={{ background: "var(--color-primary, #1B3A2D)" }}>Cerrar</button>
              </div>
            </div>
          ) : (
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 block">Partir por</label>
                <div className="flex gap-2">
                  {[["paciente", "Una factura por paciente"], ["terapia", "Una factura por terapia"]].map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => setPor(k)} disabled={saving}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${por === k ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
                      style={por === k ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg bg-neutral-50 border border-neutral-100 p-3 text-[11px] text-neutral-600 leading-relaxed">
                Una factura emitida no cambia de número. Lo que pasa es: la <b>{invoice.number}</b> se anula con una
                rectificativa (serie R, en negativo) y las nuevas cogen <b>los siguientes números libres</b> de la serie.
                Los cobros pasan a las nuevas tal cual: no se toca ni un euro ni una fecha de cobro.
              </div>

              {loading && <div className="text-xs text-neutral-400">Calculando el reparto…</div>}
              {!loading && preview && !preview.ok && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">No se puede partir así: {preview.motivo}.</div>
              )}
              {!loading && preview?.ok && (
                <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden">
                  {preview.grupos.map((g) => (
                    <li key={g.grupoId} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                      <span className="min-w-0 flex-1 truncate text-neutral-800">{g.paciente ?? g.terapia ?? "—"}</span>
                      <span className="text-neutral-400">{g.cobros.length === 1 ? "1 cobro" : `${g.cobros.length} cobros`}</span>
                      <span className="font-semibold tabular text-neutral-900">{fmtMoney(g.importe)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 block">Fecha de emisión (rectificativa y nuevas)</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} disabled={saving} />
              </div>

              {errorMsg && <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">{errorMsg}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
                <button onClick={partir} disabled={saving || loading || !preview?.ok}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>
                  {saving ? "Partiendo…" : preview?.ok ? `Partir en ${preview.grupos.length}` : "Partir"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
