"use client";

/**
 * FacturarMesDrawer — la «Facturación del mes» (31/08/2026, petición de
 * Aumenta): elegir mes → ver qué se emitiría → emitir de una vez las facturas
 * de cuota, una por pagador, ya cobradas. Habla con
 * /api/billing/invoices/bulk-issue (GET = vista previa, POST = emitir).
 *
 * Quien no tiene NIF no bloquea el lote: sale en su propia lista con enlace a
 * la ficha, que es el trabajo pendiente de recepción.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtMoney } from "./Kpi.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

export default function FacturarMesDrawer({ open, onClose, onDone }) {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  // Aviso ≠ exclusión: quien ya tiene factura ese mes se marca, pero decide
  // la persona (la factura manual de ese mes puede ser de otra cosa).
  const [excluidos, setExcluidos] = useState(() => new Set());
  const [fecha, setFecha] = useState("");
  const [emitting, setEmitting] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResultado(null);
    setExcluidos(new Set());
    setErrorMsg(null);
    setLoading(true);
    fetch(`/api/billing/invoices/bulk-issue?mes=${mes}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.error || "Error");
        setPreview(j.data);
        setFecha(j.data.fechaPropuesta || "");
      })
      .catch((e) => { setPreview(null); setErrorMsg(e.message); })
      .finally(() => setLoading(false));
  }, [open, mes]);

  const seleccionadas = useMemo(
    () => (preview?.facturables ?? []).filter((g) => !excluidos.has(g.clientId)),
    [preview, excluidos]
  );
  const importeSeleccionado = seleccionadas.reduce((s, g) => s + Number(g.importe || 0), 0);

  function toggle(clientId) {
    setExcluidos((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  async function emitir() {
    setEmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/billing/invoices/bulk-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, issueDate: fecha || undefined, exclude: [...excluidos] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setResultado(json.data);
      onDone?.();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setEmitting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !emitting && onClose()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[560px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Emisión masiva</div>
            <h2 className="font-display text-xl text-neutral-900 mt-1">Facturar el mes</h2>
            <p className="text-[11px] text-neutral-400 mt-1">
              Una factura por pagador con sus cobros de cuota del mes, emitida y ya cobrada.
            </p>
          </div>
          <button onClick={() => !emitting && onClose()} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {resultado ? (
          <div className="px-6 py-5 space-y-4">
            <div className="text-sm text-neutral-800">
              <span className="font-semibold text-emerald-700">{resultado.emitidas} emitidas</span>
              {resultado.saltadas > 0 && <> · <span className="font-semibold text-amber-700">{resultado.saltadas} saltadas</span></>}
              {resultado.excluidas > 0 && <> · {resultado.excluidas} excluidas</>}
              <span className="text-neutral-400"> · con fecha {resultado.issueDate}</span>
            </div>
            <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden">
              {resultado.resultados.map((r) => (
                <li key={r.clientId} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-800">{r.nombre}</span>
                  {r.resultado === "emitida" ? (
                    <Link href={`/facturacion/facturas/${r.invoiceId}`} className="font-mono text-[var(--color-primary,#1B3A2D)] hover:underline">
                      {r.numero}
                    </Link>
                  ) : (
                    <span className="text-amber-700">{r.motivo}</span>
                  )}
                  <span className="font-semibold tabular text-neutral-900">{fmtMoney(r.importe)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end pt-2">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
                style={{ background: "var(--color-primary, #1B3A2D)" }}>Cerrar</button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Mes a facturar</label>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={inputCls} />
            </div>

            {loading && <div className="text-xs text-neutral-400 py-6 text-center">Recogiendo los cobros del mes...</div>}
            {errorMsg && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{errorMsg}</div>}

            {!loading && preview && (
              <>
                {!preview.emisor.ok && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                    El emisor no tiene datos fiscales completos (falta {preview.emisor.faltan.join(" y ")}).
                    Rellénalos en <Link href="/facturacion/configuracion" className="underline font-semibold">Configuración → Facturación</Link> antes
                    de emitir: las facturas salen a su nombre.
                  </div>
                )}

                <p className="text-xs text-neutral-500">
                  {preview.totales.familias === 0
                    ? "No hay cobros de cuota de ese mes sin factura."
                    : <>Cobros de cuota sin factura: <b>{preview.totales.cobros}</b> de <b>{preview.totales.familias}</b> pagadores,
                      {" "}<b className="tabular">{fmtMoney(preview.totales.importe)}</b>
                      {" "}· IVA aplicado: <b>{preview.ivaAplicado} %</b></>}
                </p>

                {preview.sinNif.length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1.5">
                      {preview.sinNif.length} {preview.sinNif.length === 1 ? "pagador se queda" : "pagadores se quedan"} fuera (sin NIF en la ficha)
                    </p>
                    <ul className="space-y-1 max-h-36 overflow-y-auto">
                      {preview.sinNif.map((g) => (
                        <li key={g.clientId} className="flex items-center gap-2 text-[11px] text-amber-800">
                          <Link href={`/clientes/${g.clientId}`} className="underline min-w-0 flex-1 truncate">{g.nombre}</Link>
                          <span className="tabular">{fmtMoney(g.importe)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-amber-700 mt-1.5">Completa el NIF en su ficha y vuelve a lanzar el mes: sus cobros siguen aquí esperando.</p>
                  </div>
                )}

                {preview.facturables.length > 0 && (
                  <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto ink-scroll">
                    {preview.facturables.map((g) => (
                      <li key={g.clientId} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                        <input
                          type="checkbox"
                          checked={!excluidos.has(g.clientId)}
                          onChange={() => toggle(g.clientId)}
                          className="accent-[var(--color-primary,#1B3A2D)]"
                        />
                        <span className="min-w-0 flex-1 truncate text-neutral-800">{g.nombre}</span>
                        {g.facturaPrevia && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100"
                            title="Este pagador ya tiene una factura emitida este mes. Puede ser de otra cosa; revisa antes de emitirle otra.">
                            ya tiene factura este mes
                          </span>
                        )}
                        <span className="text-neutral-400">{g.cobros.length === 1 ? "1 cobro" : `${g.cobros.length} cobros`}</span>
                        <span className="font-semibold tabular text-neutral-900">{fmtMoney(g.importe)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {preview.facturables.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Fecha de emisión</label>
                    <input type="date" value={fecha} min={preview.fechaMinimaSerie || undefined}
                      onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                    {preview.fechaMinimaSerie && (
                      <p className="text-[10px] text-neutral-400">
                        La numeración va en orden de fecha: no puede ser anterior al {preview.fechaMinimaSerie} (última factura de la serie).
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-neutral-100">
                  <p className="text-[10px] text-neutral-400 min-w-0">
                    Las facturas emitidas no se borran: un error se corrige con rectificativa.
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={onClose}
                      className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                    <button
                      type="button"
                      onClick={emitir}
                      disabled={emitting || !preview.emisor.ok || seleccionadas.length === 0}
                      className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                      style={{ background: "var(--color-primary, #1B3A2D)" }}
                    >
                      {emitting
                        ? "Emitiendo..."
                        : `Emitir ${seleccionadas.length} ${seleccionadas.length === 1 ? "factura" : "facturas"} · ${fmtMoney(importeSeleccionado)}`}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
