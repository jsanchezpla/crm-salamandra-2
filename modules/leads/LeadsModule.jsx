"use client";

import { useEffect, useState } from "react";

const STAGE_LABELS = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Cualificado",
  proposal: "Propuesta",
  negotiation: "Negociación",
  won: "Ganado",
  lost: "Perdido",
};

const STAGE_COLORS = {
  new: "bg-neutral-100 text-neutral-600",
  contacted: "bg-blue-50 text-blue-700",
  qualified: "bg-emerald-50 text-emerald-700",
  proposal: "bg-violet-50 text-violet-700",
  negotiation: "bg-amber-50 text-amber-700",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-500",
};

export default function LeadsModule() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leads")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setLeads(data.data.leads);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-xl font-extrabold text-neutral-900 mb-6">Leads</h1>
      {loading ? (
        <p className="text-neutral-400 text-sm">Cargando…</p>
      ) : (
        <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Nombre / Título</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Email</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Teléfono</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Estado</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3 text-neutral-800 font-medium">{lead.name || lead.title || "—"}</td>
                  <td className="px-4 py-3 text-neutral-500">{lead.email || "—"}</td>
                  <td className="px-4 py-3 text-neutral-500">{lead.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[lead.stage] ?? "bg-neutral-100 text-neutral-600"}`}>
                      {STAGE_LABELS[lead.stage] ?? lead.stage}
                    </span>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-neutral-400 text-sm">
                    No hay leads todavía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
