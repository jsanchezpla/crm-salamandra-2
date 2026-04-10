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
  new: "bg-neutral-800 text-neutral-300",
  contacted: "bg-blue-950 text-blue-300",
  qualified: "bg-emerald-950 text-emerald-300",
  proposal: "bg-violet-950 text-violet-300",
  negotiation: "bg-amber-950 text-amber-300",
  won: "bg-green-950 text-green-300",
  lost: "bg-red-950 text-red-400",
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
      <h1 className="text-xl font-semibold text-white mb-6">Leads</h1>
      {loading ? (
        <p className="text-neutral-500 text-sm">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500 text-xs uppercase tracking-wide">
              <th className="text-left py-2 pr-4">Nombre / Título</th>
              <th className="text-left py-2 pr-4">Email</th>
              <th className="text-left py-2 pr-4">Teléfono</th>
              <th className="text-left py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-neutral-900 hover:bg-neutral-900 transition-colors">
                <td className="py-3 pr-4 text-white">{lead.name || lead.title || "—"}</td>
                <td className="py-3 pr-4 text-neutral-400">{lead.email || "—"}</td>
                <td className="py-3 pr-4 text-neutral-400">{lead.phone || "—"}</td>
                <td className="py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[lead.stage]}`}>
                    {STAGE_LABELS[lead.stage] ?? lead.stage}
                  </span>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-neutral-600 text-sm">
                  No hay leads todavía
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
