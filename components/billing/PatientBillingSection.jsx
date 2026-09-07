"use client";

/**
 * PatientBillingSection — sección "Facturación" de la ficha del paciente (Fase 2a).
 *
 * Lista las facturas enlazadas al paciente (Invoice.patientId) y permite crear un
 * BORRADOR prellenado: el pagador por defecto es el cliente del paciente
 * (patient.clientId, editable luego en el editor de facturas), y el borrador
 * queda enlazado al paciente. El importe/concepto/IVA se ajustan en el editor;
 * aquí solo se crea el esqueleto para no re-teclear el pagador ni el enlace.
 *
 * Se oculta si el tenant no tiene módulo billing (GET responde 403).
 * Autocontenido: recibe patientId + clientId (pagador por defecto).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { hoyVigente } from "@/lib/billing/cuotas.js";
import { ejerciciosDe, facturasDelEjercicio, sePuedeDescargar } from "@/lib/billing/ejerciciosFactura.js";
import { useRouter } from "next/navigation";
import PatientReparto from "./PatientReparto.jsx";

const STATUS_LABEL = {
  draft: "Borrador", issued: "Emitida", sent: "Enviada", paid: "Pagada",
  partially_paid: "Parcial", overdue: "Vencida", cancelled: "Anulada", rectified: "Rectificada",
};
const STATUS_CLS = {
  draft: "bg-neutral-100 text-neutral-600", issued: "bg-sky-50 text-sky-700",
  sent: "bg-sky-50 text-sky-700", paid: "bg-emerald-50 text-emerald-700",
  partially_paid: "bg-amber-50 text-amber-700", overdue: "bg-rose-50 text-rose-700",
  cancelled: "bg-neutral-100 text-neutral-400", rectified: "bg-violet-50 text-violet-700",
};
const eur = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function PatientBillingSection({ patientId, clientId }) {
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showReparto, setShowReparto] = useState(false);
  // El ejercicio que se mira; "" son todos (07/09/2026, AV-0066 de Aumenta:
  // «no se ven todas las facturas emitidas de ese paciente en ejercicios
  // anteriores y no se pueden descargar»).
  const [ejercicio, setEjercicio] = useState("");

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    // 500 y no 50: un niño con años de historia tenía cortadas las facturas
    // viejas justo por donde ella las busca.
    fetch(`/api/billing/invoices?patientId=${patientId}&limit=500`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 403) { if (alive) setAvailable(false); return null; }
        return r.json();
      })
      .then((d) => {
        if (!alive || d == null) return;
        if (!d.ok) throw new Error(d.error || "Error cargando facturas");
        setInvoices(d.data.invoices || []);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [patientId]);

  useEffect(() => load(), [load]);

  const ejercicios = useMemo(() => ejerciciosDe(invoices), [invoices]);
  const visibles = useMemo(() => facturasDelEjercicio(invoices, ejercicio), [invoices, ejercicio]);

  // Pagadores frecuentes del paciente (calculados de sus facturas): permiten
  // crear una factura para un pagador recurrente con un clic, sin re-teclearlo.
  const frequentPayers = useMemo(() => {
    const map = new Map();
    for (const inv of invoices) {
      const id = inv.clientId;
      if (!id) continue;
      const e = map.get(id) || { id, name: inv.client?.name || "—", count: 0 };
      e.count += 1;
      map.set(id, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [invoices]);

  async function nuevaFactura(payerId) {
    const payer = typeof payerId === "string" && payerId ? payerId : clientId;
    if (busy || !payer) return;
    setBusy(true);
    setError(null);
    try {
      const issueDate = hoyVigente();
      const r = await fetch(`/api/billing/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: payer, // pagador elegido (chip) o el cliente del paciente por defecto
          patientId,
          issueDate,
          lines: [{ description: "Cuota", quantity: 1, unitPrice: 0 }],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear el borrador");
      // El importe/concepto/IVA/pagador se ajustan en el editor de facturas.
      router.push("/facturacion/facturas");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (loading || !available) return null;

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="eyebrow">Facturación</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowReparto(true)}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
          >
            Reparto
          </button>
          <button
            onClick={nuevaFactura}
            disabled={busy || !clientId}
            title={!clientId ? "Enlaza un cliente pagador al paciente primero" : ""}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40"
          >
            {busy ? "Creando…" : "Nueva factura"}
          </button>
        </div>
      </div>

      {frequentPayers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[10px] text-neutral-400">Facturar a un pagador frecuente:</span>
          {frequentPayers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => nuevaFactura(p.id)}
              disabled={busy}
              className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              title={`Nueva factura con ${p.name} como pagador`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {showReparto && (
        <PatientReparto
          patientId={patientId}
          defaultPayerClientId={clientId}
          onClose={() => setShowReparto(false)}
          onCreated={() => { setShowReparto(false); load(); }}
        />
      )}

      {!clientId && (
        <p className="text-[11px] text-amber-600 mb-2">
          Este paciente no tiene cliente pagador enlazado: enlázalo para poder facturar.
        </p>
      )}

      {/* El ejercicio, solo si el paciente tiene facturas de más de un año. */}
      {ejercicios.length > 1 && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-neutral-400">Ejercicio</span>
          <select
            value={ejercicio}
            onChange={(e) => setEjercicio(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600"
            aria-label="Ejercicio del paciente"
          >
            <option value="">Todos los años</option>
            {ejercicios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <span className="text-[10px] text-neutral-400">
            {visibles.length === invoices.length
              ? `${invoices.length} facturas`
              : `${visibles.length} de ${invoices.length}`}
          </span>
        </div>
      )}

      {invoices.length === 0 ? (
        <p className="text-[11px] text-neutral-400">Sin facturas para este paciente.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {visibles.map((inv) => (
            <li key={inv.id} className="py-2 flex items-center gap-3 text-xs">
              <span className="font-medium text-neutral-800 shrink-0">{inv.number?.startsWith("DRAFT-") ? "(borrador)" : inv.number}</span>
              {inv.customFields?.splitGroupId && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 shrink-0" title="Parte de un reparto de cuota">reparto</span>
              )}
              <span className="text-neutral-400 shrink-0">{fmt(inv.issueDate)}</span>
              <span className="text-neutral-500 truncate flex-1 min-w-0">{inv.client?.name || "—"}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLS[inv.status] || "bg-neutral-100 text-neutral-500"}`}>
                {STATUS_LABEL[inv.status] || inv.status}
              </span>
              <span className="text-neutral-800 font-medium shrink-0 tabular-nums">{eur(inv.total)}</span>
              {/* Descargarla desde aquí, que es donde ella la busca (AV-0066).
                  Un borrador no: todavía no tiene número. */}
              {sePuedeDescargar(inv) && (
                <a
                  href={`/api/billing/invoices/${inv.id}/pdf`}
                  title={`Descargar ${inv.number}`}
                  className="shrink-0 inline-flex items-center text-neutral-400 hover:text-[var(--color-primary,#1B3A2D)] transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {invoices.length > 0 && (
        <button onClick={() => router.push("/facturacion/facturas")} className="mt-2 text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">
          Ver en Facturación →
        </button>
      )}
      {error && <p className="text-[11px] text-rose-600 mt-2">{error}</p>}
    </div>
  );
}
