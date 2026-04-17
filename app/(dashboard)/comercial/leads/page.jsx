"use client";

import { useEffect, useState } from "react";

const PROMO_LABELS = {
  "pack-ia": "Pack IA + Herramientas",
  "formacion-presencial": "Formación Presencial",
};

const PROMO_BADGE = {
  "pack-ia": "bg-green-100 text-green-700",
  "formacion-presencial": "bg-blue-100 text-blue-700",
};

const ASUNTOS = {
  "pack-ia": "¡Tu Pack IA + 2 Herramientas Gratis está listo!",
  "formacion-presencial": "¡Formación Presencial confirmada!",
};

const CUERPOS = {
  "pack-ia": (name) =>
    `Hola ${name},\n\nNos complace confirmarte que tu solicitud del Pack IA + 2 Herramientas Gratis ha sido aceptada.\n\nEn breve recibirás más información.\n\nUn saludo,\nEl equipo de Retorika`,
  "formacion-presencial": (name) =>
    `Hola ${name},\n\nNos complace confirmarte que tu solicitud de Formación Presencial en Grupo ha sido aceptada.\n\nEn breve nos pondremos en contacto contigo para coordinar los detalles.\n\nUn saludo,\nEl equipo de Retorika`,
};

function aceptarPromocion(lead) {
  const promo = lead.metadata?.promo;
  const asunto = ASUNTOS[promo] ?? "Tu solicitud ha sido aceptada";
  const cuerpoFn = CUERPOS[promo] ?? ((n) => `Hola ${n},\n\nTu solicitud ha sido aceptada.\n\nUn saludo,\nEl equipo de Retorika`);
  const cuerpo = cuerpoFn(lead.name ?? "");
  window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

function PromoBadge({ promo }) {
  if (!promo) return <span className="text-neutral-300">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${PROMO_BADGE[promo] ?? "bg-neutral-100 text-neutral-600"}`}>
      {PROMO_LABELS[promo] ?? promo}
    </span>
  );
}

function MensajeCell({ texto }) {
  const [expanded, setExpanded] = useState(false);
  if (!texto) return <span className="text-neutral-300">—</span>;
  const LIMIT = 150;
  if (texto.length <= LIMIT) return <span className="text-neutral-600 text-xs">{texto}</span>;
  return (
    <span className="text-neutral-600 text-xs">
      {expanded ? texto : `${texto.slice(0, LIMIT)}…`}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="ml-1 text-[11px] font-medium underline"
        style={{ color: "var(--color-primary)" }}
      >
        {expanded ? "menos" : "más"}
      </button>
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-neutral-100 rounded animate-pulse" style={{ width: `${60 + (i * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [promoFilter, setPromoFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200", offset: "0" });
    if (promoFilter) params.set("promo", promoFilter);
    if (search) params.set("search", search);
    fetch(`/api/leads?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setLeads(json.data.leads);
      })
      .finally(() => setLoading(false));
  }, [search, promoFilter]);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
          Leads
        </h1>
        <p className="text-sm text-neutral-400 mt-1">Solicitudes recibidas desde la web</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          type="text"
          placeholder="Buscar por nombre o email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-white"
          style={{ "--tw-ring-color": "var(--color-primary)" }}
        />
        <select
          value={promoFilter}
          onChange={(e) => setPromoFilter(e.target.value)}
          className="border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none"
        >
          <option value="">Todas las promociones</option>
          <option value="pack-ia">Pack IA + Herramientas</option>
          <option value="formacion-presencial">Formación Presencial</option>
        </select>
      </div>

      {/* Vista móvil: tarjetas */}
      <div className="md:hidden flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white border border-neutral-100 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-neutral-100 rounded w-1/2 mb-2" />
              <div className="h-3 bg-neutral-100 rounded w-3/4 mb-2" />
              <div className="h-3 bg-neutral-100 rounded w-1/3" />
            </div>
          ))
        ) : leads.length === 0 ? (
          <p className="text-center text-neutral-400 text-sm py-12">No hay leads con los filtros aplicados</p>
        ) : (
          leads.map((lead) => (
            <div key={lead.id} className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-neutral-900 text-sm">{lead.name ?? "—"}</span>
                <PromoBadge promo={lead.metadata?.promo} />
              </div>
              {lead.email && <span className="text-xs text-neutral-500">{lead.email}</span>}
              {lead.phone && <span className="text-xs text-neutral-500">{lead.phone}</span>}
              {lead.mensaje && (
                <p className="text-xs text-neutral-500 line-clamp-2">{lead.mensaje}</p>
              )}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-neutral-400">
                  {lead.createdAt
                    ? new Date(lead.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })
                    : "—"}
                </span>
                <button
                  onClick={() => aceptarPromocion(lead)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "var(--color-primary)" }}
                >
                  Aceptar promoción
                </button>
              </div>
            </div>
          ))
        )}
        {!loading && leads.length > 0 && (
          <p className="text-xs text-neutral-400 text-right">
            {leads.length} lead{leads.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Vista desktop: tabla */}
      <div className="hidden md:block bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--color-secondary, #1B3A2D)" }}>
                {["Nombre", "Email", "Teléfono", "Promoción", "Mensaje", "Fecha", "Acciones"].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-[11px] font-semibold text-white/80 uppercase tracking-wider whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-400 text-sm">
                    No hay leads con los filtros aplicados
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                      {lead.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                      {lead.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                      {lead.phone ?? <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <PromoBadge promo={lead.metadata?.promo} />
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <MensajeCell texto={lead.mensaje} />
                    </td>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap text-xs">
                      {lead.createdAt
                        ? new Date(lead.createdAt).toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => aceptarPromocion(lead)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-opacity hover:opacity-80"
                        style={{ backgroundColor: "var(--color-primary)" }}
                      >
                        Aceptar promoción
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && leads.length > 0 && (
          <div className="px-4 py-3 border-t border-neutral-100 text-xs text-neutral-400">
            {leads.length} lead{leads.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
