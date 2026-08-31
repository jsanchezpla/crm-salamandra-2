"use client";

/**
 * /facturacion/acciones — TODAS las acciones requeridas, filtrables por tipo
 * (31/08/2026). El Panel enseña tres contadores; aquí está la lista completa:
 * qué factura vencida, de quién, desde cuándo y por cuánto — y lo mismo para
 * los presupuestos que caducan y los aceptados sin facturar.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const TIPOS = {
  vencida: { label: "Factura vencida", dot: "#A9503A", cta: "Ir a facturas", href: () => "/facturacion/facturas?status=overdue" },
  caduca: { label: "Presupuesto caduca", dot: "#94711F", cta: "Abrir", href: (r) => `/facturacion/presupuestos/${r.id}` },
  aceptado: { label: "Aceptado sin facturar", dot: "#3F6488", cta: "Facturar", href: (r) => `/facturacion/presupuestos/${r.id}` },
};

const FILTROS = [
  { key: "todas", label: "Todas" },
  { key: "vencida", label: "Facturas vencidas" },
  { key: "caduca", label: "Presupuestos que caducan" },
  { key: "aceptado", label: "Aceptados sin facturar" },
];

export default function AccionesRequeridasPage() {
  const [data, setData] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [filtro, setFiltro] = useState("todas");

  const load = useCallback(async () => {
    setErrorMsg(null);
    try {
      const res = await fetch("/api/billing/acciones", { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando");
      setData(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const todas = data ? [...data.vencidas, ...data.caducan, ...data.aceptados] : [];
  const filas = filtro === "todas" ? todas : todas.filter((r) => r.tipo === filtro);
  const cuenta = (tipo) => todas.filter((r) => r.tipo === tipo).length;
  const hayTope = data && (data.topes?.vencidas || data.topes?.caducan || data.topes?.aceptados);

  return (
    <div className={`${anchoPantalla("portada")} space-y-5`}>
      <div>
        <div className="eyebrow">Operativa · Acción requerida</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
          Acciones requeridas
        </h1>
        <p className="text-xs text-neutral-400 mt-1">
          Lo que espera una gestión: facturas vencidas, presupuestos a punto de caducar y aceptados sin facturar.
        </p>
      </div>

      {errorMsg && (
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filtro === f.key
                ? "bg-[var(--ink-900,#1a1a1a)] text-white border-transparent"
                : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
            }`}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-60">
              {f.key === "todas" ? todas.length : cuenta(f.key)}
            </span>
          </button>
        ))}
      </div>

      {hayTope && (
        <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          Alguna lista ha tocado su tope de {data.topes.limite} filas: lo de aquí no es todo lo que hay.
        </div>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        {!data && !errorMsg ? (
          <div className="px-4 py-8 text-sm text-neutral-400 text-center">Cargando…</div>
        ) : filas.length === 0 ? (
          <div className="px-4 py-8 text-sm text-neutral-400 text-center">
            {filtro === "todas" ? "Nada pendiente. Todo al día 🎉" : "Nada pendiente de este tipo."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-400 border-b border-neutral-100">
                  <th className="px-4 py-2.5 font-medium">Tipo</th>
                  <th className="px-4 py-2.5 font-medium">Documento</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium text-right">Importe</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => {
                  const t = TIPOS[r.tipo];
                  return (
                    <tr key={`${r.tipo}-${r.id}`} className="border-t border-neutral-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.dot }} />
                          <span className="text-neutral-700">{t.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-800 whitespace-nowrap">{r.numero}</td>
                      <td className="px-4 py-3 text-neutral-700">{r.cliente || "—"}</td>
                      <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtDate(r.fecha)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-neutral-800">{fmtMoney(r.importe)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={t.href(r)}
                          className="text-[11.5px] font-medium text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 hover:bg-emerald-50 transition whitespace-nowrap"
                        >
                          {t.cta}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
