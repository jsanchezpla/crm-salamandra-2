"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón "Convertir a proyecto" para usar en el detalle de un lead.
 *
 * Comportamiento:
 *  - Si el lead ya está convertido (`convertedProjectId`), muestra link
 *    "Ver proyecto vinculado" en su lugar.
 *  - Al pulsar, abre un mini-formulario con los campos clave (nombre,
 *    descripción, presupuesto, fechas, prioridad) pre-rellenados desde el
 *    lead. Al confirmar, llama a POST /api/leads/[id]/convert-to-project.
 *  - Tras éxito, navega a /proyectos/{nuevoId}.
 *
 * Esta es una implementación reutilizable. Cada override de Leads
 * (quality-energy, abarcaia, aumenta, retorika, demo, spain-enzymes) puede
 * importarla y montarla donde tenga sentido en su detalle. Sprint 1 solo la
 * monta en el módulo base; integración por override = backlog.
 */
export default function ConvertLeadToProjectButton({ lead, onAfterConvert }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    name: lead?.title || lead?.name || "",
    description: lead?.notes || "",
    budgetAmount: lead?.value ?? "",
    startDate: "",
    dueDate: "",
    priority: "medium",
  });

  if (lead?.convertedProjectId) {
    return (
      <a
        href={`/proyectos/${lead.convertedProjectId}`}
        className="text-sm px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      >
        Ver proyecto vinculado →
      </a>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = { ...form };
      payload.budgetAmount = payload.budgetAmount === "" ? null : Number(payload.budgetAmount);
      payload.startDate = payload.startDate || null;
      payload.dueDate = payload.dueDate || null;
      const r = await fetch(`/api/leads/${lead.id}/convert-to-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error al convertir");
      onAfterConvert?.(j.data);
      router.push(`/proyectos/${j.data.id}`);
    } catch (e) { setError(e.message); } finally { setSubmitting(false); }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 rounded-lg bg-neutral-800 text-white font-medium hover:bg-neutral-700"
      >
        Convertir a proyecto
      </button>
    );
  }

  const inputCls = "w-full rounded-lg px-2 py-1.5 text-sm bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400";

  return (
    <form onSubmit={submit} className="p-3 rounded-xl border border-neutral-200 bg-neutral-50 space-y-2">
      <input className={inputCls} placeholder="Nombre del proyecto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <textarea className={inputCls} rows={2} placeholder="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" step="0.01" min="0" placeholder="Presupuesto" className={inputCls} value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} />
        <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option value="low">Prioridad baja</option>
          <option value="medium">Prioridad media</option>
          <option value="high">Prioridad alta</option>
          <option value="urgent">Urgente</option>
        </select>
      </div>
      {error && <div className="text-xs text-rose-700">{error}</div>}
      <div className="flex gap-2">
        <button disabled={submitting || !form.name.trim()} className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50">
          {submitting ? "Convirtiendo..." : "Crear proyecto"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-neutral-200 text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}
