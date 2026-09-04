"use client";

/**
 * CobroDrawer — la vista lateral de UN cobro desde el resumen de caja
 * (04/09/2026, Rodrigo: «si pulso en cualquiera de los pagos del resumen del
 * día me saque una vista lateral con los detalles del cobro y que se pueda
 * editar - borrar esa vista lateral como normalmente. También en la vista
 * lateral del cobro debería salir un botón de generar ticket»).
 *
 * Hasta hoy, para corregir un cobro que se veía mal en el arqueo había que
 * apuntar el nombre, irse a Cobros, buscarlo entre cientos y abrirlo allí. El
 * cajón hace ahí mismo lo que Cobros hace en su pantalla —los mismos campos,
 * el mismo PATCH, el mismo DELETE— y añade el ticket, que es de recepción y no
 * de contabilidad: se cobra en el mostrador y la familia se va con su papel.
 *
 * Se carga la ficha FRESCA del servidor al abrir aunque la lista ya traiga los
 * datos: el resumen puede llevar un rato en pantalla y de aquí se borra dinero.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import Select from "@/components/ui/Select.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import { fmtMoney } from "./Kpi.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

// Los mismos rótulos que Cobros y que el resumen: es el mismo dato.
const METODOS = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
};
const ESTADOS = [
  { value: "completed", label: "Cobrado" },
  { value: "pending", label: "Pendiente" },
  { value: "failed", label: "Fallido" },
  { value: "refunded", label: "Devuelto" },
];

/** El día del cobro en formato de `<input type="date">`, en hora de Madrid. */
function diaParaInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `sv-SE` da AAAA-MM-DD, que es justo lo que quiere el input.
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

function FilaDato({ rotulo, children }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="text-[11px] text-neutral-400 w-28 shrink-0">{rotulo}</span>
      <span className="text-[12.5px] text-neutral-700 min-w-0">{children}</span>
    </div>
  );
}

export default function CobroDrawer({ cobroId, resumen, onClose, onCambiado }) {
  const [cobro, setCobro] = useState(null);
  const [form, setForm] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const { confirmar, dialogo } = useDialogo();

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/payments/${cobroId}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el cobro");
      setCobro(j.data);
      setForm({
        amount: String(j.data.amount ?? ""),
        method: j.data.method ?? "cash",
        paidAt: diaParaInput(j.data.paidAt),
        status: j.data.status ?? "completed",
        notes: j.data.notes ?? "",
      });
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [cobroId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/payments/${cobroId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(form.amount),
          method: form.method,
          // La fecha vuelve con la hora de mediodía para que el día no se mueva
          // al pasar por UTC: el resumen agrupa por el día de MADRID.
          paidAt: form.paidAt ? `${form.paidAt}T12:00:00` : undefined,
          status: form.status,
          notes: form.notes,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      onCambiado?.();
      onClose?.();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    const quien = resumen?.patientName || resumen?.clientName || cobro?.client?.name;
    const ok = await confirmar({
      titulo: "Borrar el cobro",
      texto:
        `Se borrará el cobro${quien ? ` de ${quien}` : ""} de ${fmtMoney(cobro?.amount)}. ` +
        "El dinero deja de contar en la caja de ese día y, si iba contra una factura, la factura vuelve a quedar pendiente. " +
        "Queda registrado en Actividad, pero no se puede deshacer.",
      confirmar: "Borrar el cobro",
      tono: "peligro",
    });
    if (!ok) return;
    setGuardando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/payments/${cobroId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo borrar");
      }
      onCambiado?.();
      onClose?.();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      {dialogo}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose?.()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[460px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-100">
          <div className="eyebrow">Caja · Cobro</div>
          <h2 className="font-display text-xl text-neutral-900 mt-1">
            {resumen?.patientName || resumen?.clientName || cobro?.client?.name || "Cobro"}
          </h2>
          {resumen?.patientName && resumen?.clientName && (
            <p className="text-[11px] text-neutral-400 mt-1">Paga {resumen.clientName}</p>
          )}
        </div>

        {cargando ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-400">Cargando…</p>
        ) : !cobro ? (
          <div className="px-6 py-6">
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              {errorMsg ?? "No se pudo cargar el cobro"}
            </div>
          </div>
        ) : (
          <>
            {/* Lo que no se edita: de dónde viene el cobro. */}
            <div className="px-6 py-4 border-b border-neutral-100">
              <FilaDato rotulo="Factura">
                {cobro.invoice?.id ? (
                  <Link href={`/facturacion/facturas/${cobro.invoice.id}`} className="text-[var(--color-primary,#1B3A2D)] hover:underline font-mono text-[12px]">
                    {cobro.invoice.number}
                  </Link>
                ) : (
                  <span className="text-neutral-400">
                    Sin factura{cobro.periodMonth ? ` · cuota de ${String(cobro.periodMonth).slice(0, 7)}` : ""}
                  </span>
                )}
              </FilaDato>
              <FilaDato rotulo="Registrado">
                {cobro.createdAt
                  ? new Date(cobro.createdAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
                  : "—"}
              </FilaDato>
              {/* El ticket es de RECEPCIÓN: se cobra en el mostrador y la
                  familia se va con su papel. Se abre en una pestaña porque lo
                  siguiente que se hace con él es imprimirlo. */}
              <a
                href={`/api/billing/payments/${cobroId}/ticket`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659" />
                </svg>
                Generar ticket
              </a>
            </div>

            <form onSubmit={guardar} className="px-6 py-5 space-y-3">
              <label className="block">
                <span className="text-[11px] text-neutral-500">Importe (€) *</span>
                <input required type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[11px] text-neutral-500">Método de pago</span>
                <Select value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v }))}
                  className={inputCls}
                  options={Object.entries(METODOS).map(([k, v]) => ({ value: k, label: v }))} />
              </label>
              <label className="block">
                <span className="text-[11px] text-neutral-500">Fecha *</span>
                <input required type="date" value={form.paidAt}
                  onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[11px] text-neutral-500">Estado</span>
                <Select value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                  className={inputCls} options={ESTADOS} />
              </label>
              <label className="block">
                <span className="text-[11px] text-neutral-500">Notas</span>
                <textarea rows={3} value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={`${inputCls} resize-y`} />
              </label>

              {errorMsg && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{errorMsg}</div>}

              <div className="flex gap-2 justify-between items-center pt-3 border-t border-neutral-100 flex-wrap">
                {/* Borrar, a la izquierda y separado de Guardar: es lo único de
                    este cajón que quita dinero de la caja. */}
                <button type="button" onClick={borrar} disabled={guardando}
                  className="px-3 py-2 text-xs font-semibold text-red-600 uppercase tracking-wide hover:bg-red-50 rounded-lg disabled:opacity-50">
                  Borrar cobro
                </button>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => onClose?.()}
                    className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700">
                    Cancelar
                  </button>
                  <button type="submit" disabled={guardando}
                    className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                    style={{ background: "var(--color-primary, #1B3A2D)" }}>
                    {guardando ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </aside>
    </>
  );
}
