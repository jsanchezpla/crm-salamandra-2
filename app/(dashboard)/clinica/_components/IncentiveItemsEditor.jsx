"use client";

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { resolveItemAmount } from "@/lib/clinica/incentiveItems.js";

const fmtEUR = (n) => (n == null ? "—" : `${n} €`);
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "");

/**
 * Incentivos ESCRITOS a mano (Dirección): conceptos concretos ("Cambiar la
 * bombilla del centro") con valor en € fijos o en % del sueldo mensual.
 * Suman al total propuesto del periodo; onChanged avisa al panel para
 * recalcular la propuesta.
 */
export default function IncentiveItemsEditor({ period, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Formulario (alta o edición).
  const [editingId, setEditingId] = useState(null);
  const [concept, setConcept] = useState("");
  const [therapistId, setTherapistId] = useState("");
  const [valueType, setValueType] = useState("fixed");
  const [value, setValue] = useState("");

  const load = () => {
    setLoading(true);
    const qs = period ? `?period=${period}` : "";
    fetch(`/api/clinica/incentive-items${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setData(j.data); else setErr(j.error); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [period]);

  const items = data?.items ?? [];
  const therapists = data?.therapists ?? [];
  const selected = therapists.find((t) => t.id === therapistId);

  // Vista previa del importe (para % solo sabemos si hay sueldo, no el importe:
  // el sueldo no viaja al cliente; el cálculo exacto lo hace el backend).
  const previewFixed = valueType === "fixed" ? resolveItemAmount("fixed", Number(value), null) : null;
  const percentBlocked = valueType === "percent" && selected && !selected.hasSalary;

  const resetForm = () => {
    setEditingId(null); setConcept(""); setTherapistId(""); setValueType("fixed"); setValue("");
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setConcept(item.concept);
    setTherapistId(item.therapistId);
    setValueType(item.valueType);
    setValue(String(item.value ?? ""));
  };

  const save = async () => {
    setErr(null);
    if (!concept.trim()) { setErr("Escribe el concepto."); return; }
    if (!editingId && !therapistId) { setErr("Elige a quién va el incentivo."); return; }
    if (value === "" || Number(value) < 0) { setErr("Pon el valor."); return; }
    setBusy(true);
    try {
      const isEdit = !!editingId;
      const r = await fetch(isEdit ? `/api/clinica/incentive-items/${editingId}` : "/api/clinica/incentive-items", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { concept: concept.trim(), valueType, value: Number(value) }
            : { concept: concept.trim(), therapistId, valueType, value: Number(value), period }
        ),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      resetForm();
      load();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`¿Quitar el incentivo «${item.concept}» de ${item.therapist?.name ?? ""}?`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/clinica/incentive-items/${item.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo eliminar");
      if (editingId === item.id) resetForm();
      load();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400";

  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
        <div>
          <h2 className="eyebrow">Incentivos escritos</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Conceptos concretos que suman al incentivo del mes, en € fijos o % del sueldo.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total escrito</div>
          <div className="font-display text-xl text-[var(--ink-900)] tabular">{loading ? "—" : `${data?.total ?? 0} €`}</div>
        </div>
      </div>

      {/* Formulario alta/edición */}
      <div className="px-4 lg:px-5 py-3 border-b border-neutral-100 bg-neutral-50/40 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1.4fr_auto_auto_auto] gap-2 items-center">
          <input
            value={concept} onChange={(e) => setConcept(e.target.value)}
            className={inputCls} placeholder="Concepto — p. ej. «Cambiar la bombilla del centro»"
          />
          <Select
            value={therapistId} onChange={setTherapistId}
            options={[{ value: "", label: editingId ? "(no se puede cambiar)" : "¿Para quién?" }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]}
            className={`${inputCls} bg-white ${editingId ? "opacity-60 pointer-events-none" : ""}`}
          />
          <Select
            value={valueType} onChange={setValueType}
            options={[{ value: "fixed", label: "€ fijos" }, { value: "percent", label: "% del sueldo" }]}
            className={`${inputCls} bg-white`}
          />
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={0} step={valueType === "percent" ? 0.5 : 10} value={value}
              onChange={(e) => setValue(e.target.value)}
              className={`${inputCls} w-24 tabular text-right`} placeholder="0"
            />
            <span className="text-sm text-neutral-500">{valueType === "percent" ? "%" : "€"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {busy ? "…" : editingId ? "Guardar" : "Añadir"}
            </button>
            {editingId && (
              <button onClick={resetForm} disabled={busy} className="text-[11px] text-neutral-500 hover:underline">Cancelar</button>
            )}
          </div>
        </div>
        {valueType === "fixed" && previewFixed != null && previewFixed > 0 && (
          <p className="text-[11px] text-neutral-500">Importe: <span className="font-medium text-[var(--ink-900)] tabular">{previewFixed} €</span></p>
        )}
        {percentBlocked && (
          <p className="text-[11px] text-amber-700">
            {selected.name} no tiene sueldo mensual en su ficha de Equipo — ponlo primero o usa € fijos.
          </p>
        )}
        {err && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{err}</div>}
      </div>

      {/* Lista */}
      {loading ? (
        <p className="px-4 py-6 text-center text-xs text-neutral-400">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-neutral-400">Sin incentivos escritos este mes.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {items.map((it) => (
            <li key={it.id} className="px-4 lg:px-5 py-2.5 flex items-center gap-3">
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-display"
                style={{ backgroundColor: it.therapist?.color ?? "#1B3A2D" }}
                title={it.therapist?.name}
              >
                {(it.therapist?.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--ink-900)] truncate">{it.concept}</div>
                <div className="text-[11px] text-neutral-400 truncate">
                  {it.therapist?.name ?? "—"} · {it.valueType === "percent" ? `${it.value}% del sueldo` : "importe fijo"} · {fmt(it.createdAt)}
                </div>
              </div>
              <span className="shrink-0 font-medium tabular text-[var(--ink-900)]">{fmtEUR(it.resolvedAmount)}</span>
              <div className="shrink-0 space-x-2 whitespace-nowrap">
                <button onClick={() => startEdit(it)} disabled={busy} className="text-[11px] text-neutral-500 hover:underline disabled:opacity-50">Editar</button>
                <button onClick={() => remove(it)} disabled={busy} className="text-[11px] text-rose-600 hover:underline disabled:opacity-50">Quitar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
