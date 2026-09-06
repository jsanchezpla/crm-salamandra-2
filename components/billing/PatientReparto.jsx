"use client";

/**
 * PatientReparto — reparto de una cuota del paciente, con DOS modos claros
 * (para no confundir el caso "fraccionar el cobro" con "repartir entre pagadores"):
 *
 *   A) "Una factura, varios cobros": UNA factura por el importe total a un único
 *      pagador; el IVA se aplica UNA vez sobre el total y los cobros parciales se
 *      registran luego en la propia factura.
 *   B) "Varias facturas, un pagador cada una": el total se reparte en N facturas
 *      (una por pagador), cada una con su IVA proporcional como si fuera individual.
 *      Se valida que la suma de las N CUADRE con el total; si algo falla a medias,
 *      se borran los borradores ya creados (no se queda a medias).
 */

import { useEffect, useMemo, useState } from "react";
import { hoyVigente } from "@/lib/billing/cuotas.js";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";
import { repartoIgual, repartoPorPorcentajes, porcentajesCuadran } from "@/lib/billing/repartoImportes.js";
import { GUARDIAN_RELATIONSHIP_LABEL } from "@/lib/clients/guardians.js";

const eur = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function PatientReparto({ patientId, defaultPayerClientId, onClose, onCreated }) {
  const [mode, setMode] = useState("split"); // 'single' | 'split'
  // Cómo se escribe el reparto (31/08/2026, «tipo Tricount»): por importes en
  // euros o por porcentajes; el botón 50/50 rellena a partes iguales. La
  // matemática del cierre al céntimo vive en lib/billing/repartoImportes.js.
  const [porPct, setPorPct] = useState(false);
  const [concept, setConcept] = useState("Cuota");
  const [period, setPeriod] = useState("");
  const [total, setTotal] = useState("");
  const [singlePayer, setSinglePayer] = useState(defaultPayerClientId || "");
  /*
   * CADA FILA ES UN PAGADOR (02/09/2026, decisión de Rodrigo): la familia
   * entera (su ficha), UNO DE SUS TUTORES —a su nombre, con su DNI—, o otra
   * ficha (una fundación, una empresa, una tía). `pagador` dice cuál de las
   * tres cosas; `clientId` es siempre la ficha que paga (para un tutor, la de
   * la familia) y `guardianId` solo va cuando la factura es a nombre de él.
   * Importes o porcentajes, pero UNA sola forma para todas las filas.
   */
  const [rows, setRows] = useState([
    { pagador: defaultPayerClientId ? `ficha:${defaultPayerClientId}` : "otra", clientId: defaultPayerClientId || "", guardianId: null, amount: "", pct: "" },
    { pagador: "otra", clientId: "", guardianId: null, amount: "", pct: "" },
  ]);
  // Los tutores de la familia que paga, para ofrecerlos como pagadores.
  const [tutores, setTutores] = useState([]);
  useEffect(() => {
    if (!defaultPayerClientId) { setTutores([]); return; }
    let vivo = true;
    fetch(`/api/clients/${defaultPayerClientId}/guardians`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setTutores(Array.isArray(j?.data?.guardians) ? j.data.guardians : []); })
      .catch(() => { if (vivo) setTutores([]); });
    return () => { vivo = false; };
  }, [defaultPayerClientId]);
  const rotuloTutor = (g) => `${GUARDIAN_RELATIONSHIP_LABEL[g.relationship] ?? GUARDIAN_RELATIONSHIP_LABEL.tutor} · ${g.name}${g.dni === null || g.dni === "" ? " (sin DNI)" : ""}`;
  function elegirPagador(i, valor) {
    if (valor.startsWith("tutor:")) {
      const g = tutores.find((t) => `tutor:${t.id}` === valor);
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, pagador: valor, clientId: defaultPayerClientId, guardianId: g?.id ?? null } : r)));
    } else if (valor.startsWith("ficha:")) {
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, pagador: valor, clientId: valor.slice(6), guardianId: null } : r)));
    } else {
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, pagador: "otra", clientId: "", guardianId: null } : r)));
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Alta rápida de una empresa pagadora (p. ej. una fundación) sin salir del
  // modal — el mismo POST que el «+ Nuevo cliente» de Facturas.
  const [nuevaEmpresa, setNuevaEmpresa] = useState(null); // null | {name, taxId}
  const [creandoEmpresa, setCreandoEmpresa] = useState(false);

  // Las fichas ya no se bajan aquí (28/08/2026). Había buscador, sí, pero
  // filtraba sobre las 200 que cabían: con las 1.083 de Aumenta se quedaban
  // fuera 883 familias y escribir su nombre no las traía. Ahora pregunta
  // SelectorCliente al servidor.
  const opcionesPagador = useMemo(() => [{ value: "", label: "Selecciona pagador…" }], []);
  const totalNum = round2(total);
  // En modo porcentajes los importes se DERIVAN (con el cierre al céntimo en
  // la última parte); en modo importes se leen tal cual.
  const importesEfectivos = useMemo(() => {
    if (!porPct) return rows.map((r) => round2(r.amount));
    return repartoPorPorcentajes(totalNum, rows.map((r) => r.pct));
  }, [porPct, rows, totalNum]);
  const repartido = useMemo(() => round2(importesEfectivos.reduce((s, x) => s + (Number(x) || 0), 0)), [importesEfectivos]);
  const pctsCuadran = !porPct || porcentajesCuadran(rows.map((r) => r.pct));
  const cuadra = totalNum > 0 && Math.abs(repartido - totalNum) < 0.005 && pctsCuadran;
  const restante = round2(totalNum - repartido);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { pagador: "otra", clientId: "", guardianId: null, amount: "", pct: "" }]);
  const removeRow = (i) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
  const repartirIgual = () => {
    if (!(totalNum > 0)) { setError("Indica antes el importe total."); return; }
    setError(null);
    if (porPct) {
      const pct = round2(100 / rows.length);
      setRows((rs) => rs.map((r, i) => ({ ...r, pct: i === rs.length - 1 ? round2(100 - pct * (rs.length - 1)) : pct })));
    } else {
      const partes = repartoIgual(totalNum, rows.length);
      setRows((rs) => rs.map((r, i) => ({ ...r, amount: String(partes[i]) })));
    }
  };

  async function crearEmpresa() {
    const name = (nuevaEmpresa?.name || "").trim();
    if (!name || creandoEmpresa) return;
    setCreandoEmpresa(true);
    setError(null);
    try {
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, taxId: (nuevaEmpresa?.taxId || "").trim() || null, type: "company" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo crear la empresa");
      const id = d.data.id;
      // Entra como pagador en la primera fila libre (o en la última).
      setRows((rs) => {
        const idx = rs.findIndex((x) => !x.clientId);
        const donde = idx === -1 ? rs.length - 1 : idx;
        // La empresa es «otra ficha»: la fila deja de ser de un tutor (revisión 02/09/2026).
        return rs.map((r2, i) => (i === donde ? { ...r2, pagador: "otra", clientId: id, guardianId: null } : r2));
      });
      if (mode === "single" && !singlePayer) setSinglePayer(id);
      setNuevaEmpresa(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreandoEmpresa(false);
    }
  }

  const lineDesc = () => `${concept.trim() || "Cuota"}${period.trim() ? ` (${period.trim()})` : ""}`;

  async function createInvoice(clientId, amount, extraCF, guardianId = null) {
    const res = await fetch(`/api/billing/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        patientId,
        // A nombre de un tutor de la familia (02/09/2026), si la fila lo pide.
        ...(guardianId ? { guardianId } : {}),
        issueDate: hoyVigente(),
        lines: [{ description: lineDesc(), quantity: 1, unitPrice: Number(amount) }],
        customFields: { source: "reparto", ...(extraCF || {}) },
      }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error(d?.error || "No se pudo crear la factura");
    return d.data.id;
  }

  async function submitSingle() {
    if (busy) return;
    if (!singlePayer) { setError("Selecciona el pagador."); return; }
    if (!(totalNum > 0)) { setError("Indica el importe total."); return; }
    setBusy(true); setError(null);
    try {
      await createInvoice(singlePayer, totalNum, { source: "single" });
      onCreated?.(1);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function submitSplit() {
    if (busy) return;
    // Los importes que valen son los EFECTIVOS: los tecleados en euros, o los
    // derivados de los porcentajes con su cierre al céntimo.
    const conImporte = rows.map((r, i) => ({ clientId: r.clientId, guardianId: r.guardianId ?? null, amount: importesEfectivos[i] }));
    const valid = conImporte.filter((r) => r.clientId && Number(r.amount) > 0);
    // Dos filas al mismo pagador (misma ficha y mismo tutor, o ninguno) serían
    // dos facturas a la misma persona por lo mismo: se avisa antes de crear.
    const claves = valid.map((r) => `${r.clientId}|${r.guardianId ?? ""}`);
    if (new Set(claves).size !== claves.length) { setError("Hay dos filas con el mismo pagador: junta sus importes en una."); return; }
    if (valid.length < 2) { setError("Añade al menos dos pagadores con importe."); return; }
    if (!(totalNum > 0)) { setError("Indica el importe total del servicio."); return; }
    if (porPct && !pctsCuadran) { setError("Los porcentajes tienen que sumar 100."); return; }
    if (!cuadra) { setError(`La suma (${eur(repartido)}) no cuadra con el total (${eur(totalNum)}).`); return; }
    setBusy(true); setError(null);
    const created = [];
    try {
      const splitGroupId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${patientId}-split`;
      const billingPeriod = period.trim() || null;
      for (const r of valid) {
        const id = await createInvoice(r.clientId, r.amount, { splitGroupId, billingPeriod, source: "split" }, r.guardianId);
        created.push(id);
      }
      onCreated?.(created.length);
    } catch (e) {
      // No dejar borradores a medias: se borran los ya creados en este intento.
      await Promise.all(created.map((id) => fetch(`/api/billing/invoices/${id}`, { method: "DELETE" }).catch(() => {})));
      setError(`${e.message} — no se creó ninguna factura (se revirtió lo parcial).`);
    } finally { setBusy(false); }
  }

  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";
  const inputCls = "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm";
  const tabCls = (on) =>
    `px-3 py-1.5 rounded-lg text-xs border transition ${on ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg bg-white rounded-xl shadow-2xl p-5 max-h-[88dvh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="eyebrow">Reparto de cuota</div>
            <p className="text-[11px] text-neutral-500 mt-0.5">Elige cómo cobrar el servicio.</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1 -m-1" aria-label="Cerrar">✕</button>
        </div>

        {/* Elección de modo */}
        <div className="flex flex-wrap gap-2 mb-2">
          <button type="button" onClick={() => setMode("single")} className={tabCls(mode === "single")} style={mode === "single" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>
            Una factura, varios cobros
          </button>
          <button type="button" onClick={() => setMode("split")} className={tabCls(mode === "split")} style={mode === "split" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>
            Varias facturas, un pagador cada una
          </button>
        </div>
        <p className="text-[11px] text-neutral-400 mb-3">
          {mode === "single"
            ? "Una sola factura por el total a un pagador. El IVA se aplica una vez sobre el total; los cobros parciales se registran luego en la factura."
            : "El total se reparte en varias facturas (una por pagador), cada una con su IVA proporcional. La suma debe cuadrar con el total."}
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={labelCls}>Concepto</label>
            <input className={inputCls} value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Periodo (opcional)</label>
            <input className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="p. ej. Junio 2026" />
          </div>
        </div>

        <div className="mb-3">
          <label className={labelCls}>Importe total del servicio (€)</label>
          <input type="number" min="0" step="0.01" className={inputCls} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" />
        </div>

        {mode === "single" ? (
          <div>
            <label className={labelCls}>Pagador</label>
            <SelectorCliente value={singlePayer} onChange={setSinglePayer} opcionesFijas={opcionesPagador} className={inputCls} />
          </div>
        ) : (
          <>
            {/* Por importes o por porcentajes, y el 50/50 de un botón */}
            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={() => setPorPct(false)} className={tabCls(!porPct)} style={!porPct ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Por importes</button>
              <button type="button" onClick={() => setPorPct(true)} className={tabCls(porPct)} style={porPct ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Por porcentajes</button>
              <button type="button" onClick={repartirIgual} className="ml-auto text-[11px] font-medium border border-neutral-200 rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-50" title="Repartir a partes iguales entre los pagadores">
                {rows.length === 2 ? "50/50" : "A partes iguales"}
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    {i === 0 && <label className={labelCls}>Pagador</label>}
                    {/* La familia, uno de sus tutores a su nombre, u otra ficha
                        (fundación, empresa…). Con «otra» se abre el buscador
                        de fichas de siempre. */}
                    <select
                      className={inputCls}
                      value={r.pagador ?? "otra"}
                      onChange={(e) => elegirPagador(i, e.target.value)}
                      aria-label="Quién paga esta parte"
                    >
                      {defaultPayerClientId && <option value={`ficha:${defaultPayerClientId}`}>La familia (su ficha)</option>}
                      {tutores.map((g) => (
                        <option key={g.id} value={`tutor:${g.id}`}>{rotuloTutor(g)}</option>
                      ))}
                      <option value="otra">Otra ficha (fundación, empresa, otra persona)…</option>
                    </select>
                    {(r.pagador ?? "otra") === "otra" && (
                      <div className="mt-1">
                        <SelectorCliente value={r.clientId} onChange={(v) => setRow(i, "clientId", v)} opcionesFijas={opcionesPagador} className={inputCls} />
                      </div>
                    )}
                  </div>
                  {porPct ? (
                    <>
                      <div className="w-20">
                        {i === 0 && <label className={labelCls}>%</label>}
                        <input type="number" min="0" max="100" step="0.01" className={inputCls} value={r.pct} onChange={(e) => setRow(i, "pct", e.target.value)} placeholder="0" />
                      </div>
                      <span className="w-20 mb-1.5 text-right text-[11px] tabular-nums text-neutral-500">{eur(importesEfectivos[i])}</span>
                    </>
                  ) : (
                    <div className="w-28">
                      {i === 0 && <label className={labelCls}>Importe (€)</label>}
                      <input type="number" min="0" step="0.01" className={inputCls} value={r.amount} onChange={(e) => setRow(i, "amount", e.target.value)} placeholder="0,00" />
                    </div>
                  )}
                  <button onClick={() => removeRow(i)} disabled={rows.length <= 1} className="mb-1 text-neutral-400 hover:text-rose-600 disabled:opacity-30 px-1" title="Quitar pagador">✕</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={addRow} className="text-[11px] font-medium text-[var(--color-primary,#1B3A2D)] hover:underline">+ Añadir pagador</button>
              <span className={`text-[11px] ${cuadra ? "text-emerald-600 font-medium" : "text-neutral-500"}`}>
                {totalNum > 0
                  ? cuadra
                    ? "✓ Cuadra con el total"
                    : `Repartido ${eur(repartido)} de ${eur(totalNum)} · ${restante >= 0 ? "faltan" : "sobran"} ${eur(Math.abs(restante))}`
                  : `Repartido ${eur(repartido)}`}
              </span>
            </div>
          </>
        )}

        {/* Alta rápida de una empresa pagadora (fundación, aseguradora…) */}
        <div className="mt-3">
          {nuevaEmpresa === null ? (
            <button type="button" onClick={() => setNuevaEmpresa({ name: "", taxId: "" })} className="text-[11px] font-medium text-neutral-500 hover:text-neutral-800">
              + Nueva empresa pagadora (fundación, aseguradora…)
            </button>
          ) : (
            <div className="border border-neutral-200 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Nombre de la empresa</label>
                  <input className={inputCls} value={nuevaEmpresa.name} onChange={(e) => setNuevaEmpresa((v) => ({ ...v, name: e.target.value }))} placeholder="Fundación Ejemplo" />
                </div>
                <div>
                  <label className={labelCls}>CIF (opcional)</label>
                  <input className={inputCls} value={nuevaEmpresa.taxId} onChange={(e) => setNuevaEmpresa((v) => ({ ...v, taxId: e.target.value }))} placeholder="G12345678" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={crearEmpresa} disabled={creandoEmpresa || !(nuevaEmpresa.name || "").trim()} className="text-xs font-medium px-2.5 py-1 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
                  {creandoEmpresa ? "Creando…" : "Crear y usar como pagador"}
                </button>
                <button type="button" onClick={() => setNuevaEmpresa(null)} className="text-xs text-neutral-500">Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-rose-600 mt-2">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          {mode === "single" ? (
            <button onClick={submitSingle} disabled={busy} className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
              {busy ? "Creando…" : "Crear factura"}
            </button>
          ) : (
            <button onClick={submitSplit} disabled={busy || !cuadra} className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
              {busy ? "Creando…" : "Crear borradores"}
            </button>
          )}
          <button onClick={onClose} className="text-sm text-neutral-500">Cancelar</button>
        </div>
        <p className="text-[10px] text-neutral-400 mt-2">
          {mode === "single"
            ? "Se crea un borrador editable por el total. Emítelo y registra los cobros parciales en Facturación."
            : "Se crean borradores editables (uno por pagador). Los que van a nombre de un tutor salen con su nombre y su DNI; ajusta y emite cada uno en Facturación."}
        </p>
      </div>
    </>
  );
}
