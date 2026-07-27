"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import IncentiveTiersEditor from "../_components/IncentiveTiersEditor.jsx";
import IncentiveItemsEditor from "../_components/IncentiveItemsEditor.jsx";
import PerformanceEditor from "../_components/PerformanceEditor.jsx";
import { PERFORMANCE_AREAS, scoreToSemaforo } from "@/lib/clinica/performanceAreas.js";

const SEMAFORO = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-200" },
  red: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500", ring: "ring-red-200" },
  gray: { bg: "bg-neutral-100", text: "text-neutral-500", dot: "bg-neutral-400", ring: "ring-neutral-200" },
};
const sc = (level) => SEMAFORO[level] ?? SEMAFORO.gray;

function TeamLineChart({ data }) {
  if (!data?.length) return <p className="text-xs text-neutral-400">Sin histórico.</p>;
  const W = 600, H = 120, P = 16;
  const min = Math.min(...data.map((d) => d.value)) - 5;
  const max = Math.max(...data.map((d) => d.value)) + 5;
  const xStep = (W - P * 2) / Math.max(1, data.length - 1);
  const points = data.map((d, i) => ({ x: P + i * xStep, y: H - P - ((d.value - min) / (max - min || 1)) * (H - P * 2), ...d }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${H - P} L ${P} ${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
      <path d={areaPath} fill="var(--color-primary, #1B3A2D)" opacity="0.08" />
      <path d={linePath} fill="none" stroke="var(--color-primary, #1B3A2D)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="var(--color-primary, #1B3A2D)" />
          <text x={p.x} y={H - 2} fontSize="9" textAnchor="middle" fill="#9CA3AF">{p.month}</text>
          <text x={p.x} y={p.y - 7} fontSize="9" textAnchor="middle" fill="#1B3A2D" fontWeight="600">{p.value}</text>
        </g>
      ))}
    </svg>
  );
}

function SemaforoMini({ areas }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {PERFORMANCE_AREAS.map((a) => {
        const c = sc(scoreToSemaforo(areas[a.key]));
        return <span key={a.key} className={`w-2 h-2 rounded-full ${c.dot}`} title={`Área ${a.n}: ${a.name} — ${areas[a.key] ?? "—"}/100`} />;
      })}
    </div>
  );
}

export default function DireccionPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [adjust, setAdjust] = useState(null); // { id, name, value }
  const [editor, setEditor] = useState(null); // null | { initial } (abre el editor de evaluación)
  const [dash, setDash] = useState(null); // datos operativos (productividad + incidencias)

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/clinica/performance/team", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/clinica/dashboard", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ok: false })),
    ])
      .then(([t, d]) => {
        if (t.ok) setData(t.data); else setErrorMsg(t.error);
        if (d.ok) setDash(d.data);
      })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const patch = async (id, body) => {
    setBusy(true); setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/performance/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo actualizar");
      setAdjust(null); load();
    } catch (e) { setErrorMsg(e.message); } finally { setBusy(false); }
  };
  const approveAll = async () => {
    setBusy(true); setErrorMsg(null);
    try {
      const r = await fetch("/api/clinica/performance/approve-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo aprobar");
      load();
    } catch (e) { setErrorMsg(e.message); } finally { setBusy(false); }
  };

  const ranking = data?.ranking ?? [];
  const kpis = data?.kpis ?? {};
  const alerts = data?.alerts ?? [];
  const totalProposed = data?.totalProposed ?? 0;
  const pendingCount = ranking.filter((r) => !r.approved).length;
  const therapists = data?.therapists ?? [];
  const tiers = data?.tiers ?? [];
  // Periodo por defecto para una evaluación nueva: el del panel, o el mes actual.
  const now = new Date();
  const defaultPeriod = data?.period?.value ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const openEditRow = (r) => setEditor({ initial: { therapistId: r.therapistId, therapistName: r.therapist?.name, areaScores: r.areas, complements: r.complements, notes: r.notes } });

  const KPI_CARDS = [
    { label: "Equipo activo", value: loading ? "—" : (kpis.teamActive ?? 0), sub: "Terapeutas" },
    { label: "Puntuación media", value: loading ? "—" : (kpis.media ?? 0), sub: "/100 · Equipo" },
    { label: "Entregas en plazo", value: loading ? "—" : (kpis.onTimePct != null ? `${kpis.onTimePct}%` : "—"), sub: "Informes entregados" },
    { label: "Quejas registradas", value: loading ? "—" : (kpis.complaints ?? 0), sub: "Periodo en curso" },
  ];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Equipo
      </Link>

      <div>
        <div className="eyebrow">Equipo · Dirección</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Panel de dirección</h1>
        <p className="text-xs text-neutral-400 mt-1">Visión global del equipo · Periodo de {data?.period ? `${["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][data.period.month]} ${data.period.year}` : "—"}</p>
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPI_CARDS.map((k) => (
          <div key={k.label} className="bg-white border border-neutral-100 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">{k.label}</div>
            <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{k.value}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Operativa del mes: productividad + incidencias */}
      {dash && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Link href="/equipo/productividad" className="group bg-white border border-neutral-100 rounded-xl p-4 hover:border-[var(--color-primary,#1B3A2D)] transition-colors">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Productividad media</div>
              <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{dash.productividad?.teamPct != null ? `${dash.productividad.teamPct}%` : "N/D"}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{dash.productividad?.configuredCount ?? 0}/{dash.productividad?.memberCount ?? 0} con objetivo</div>
            </Link>
            <Link href="/equipo/incidencias" className="group bg-white border border-neutral-100 rounded-xl p-4 hover:border-[var(--color-primary,#1B3A2D)] transition-colors">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Incidencias abiertas</div>
              <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{dash.incidencias?.open ?? 0}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{dash.incidencias?.pending ?? 0} pendientes · {dash.incidencias?.inProgress ?? 0} en proceso</div>
            </Link>
            <div className="bg-white border border-neutral-100 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Urgentes</div>
              <div className={`font-display text-2xl mt-1 tabular ${dash.incidencias?.urgent ? "text-red-600" : "text-[var(--ink-900)]"}`}>{dash.incidencias?.urgent ?? 0}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">Prioridad alta abiertas</div>
            </div>
            <div className="bg-white border border-neutral-100 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Resueltas (mes)</div>
              <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{dash.incidencias?.resolvedMonth ?? 0}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">Cerradas este mes</div>
            </div>
          </div>

          {(dash.incidencias?.byCategory?.length > 0 || dash.incidencias?.recentOpen?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
                <h2 className="eyebrow mb-3">Incidencias abiertas por categoría</h2>
                {dash.incidencias.byCategory.length === 0 ? (
                  <p className="text-[11px] text-neutral-400">Sin incidencias abiertas.</p>
                ) : (
                  <div className="space-y-2">
                    {dash.incidencias.byCategory.map((c) => {
                      const max = dash.incidencias.byCategory[0]?.count || 1;
                      return (
                        <div key={c.key} className="flex items-center gap-2">
                          <span className="text-[11px] text-neutral-600 w-40 shrink-0 truncate">{c.label}</span>
                          <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(c.count / max) * 100}%`, background: "var(--color-primary, #1B3A2D)" }} />
                          </div>
                          <span className="text-[11px] tabular text-neutral-500 w-6 text-right">{c.count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="eyebrow">Incidencias recientes</h2>
                  <Link href="/equipo/incidencias" className="text-[10px] text-[var(--color-primary,#1B3A2D)] hover:underline">Ver todas</Link>
                </div>
                {dash.incidencias.recentOpen.length === 0 ? (
                  <p className="text-[11px] text-neutral-400">Sin incidencias abiertas.</p>
                ) : (
                  <ul className="space-y-2">
                    {dash.incidencias.recentOpen.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 text-xs">
                        <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${i.priority === "high" ? "bg-red-500" : i.priority === "medium" ? "bg-amber-400" : "bg-neutral-300"}`} />
                        <span className="flex-1 min-w-0 truncate text-[var(--ink-900)]">{i.title}</span>
                        <span className="shrink-0 text-[10px] text-neutral-400">{i.categoryLabel}</span>
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${i.statusLevel === "amber" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{i.statusLabel}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ranking */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
          <h2 className="eyebrow">Ranking del equipo</h2>
          <button
            onClick={() => setEditor({ initial: null })}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Nueva evaluación
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50/50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Terapeuta</th>
                <th className="px-4 py-2 font-medium tabular text-right">Total</th>
                <th className="px-4 py-2 font-medium">Áreas</th>
                <th className="px-4 py-2 font-medium">Complementos</th>
                <th className="px-4 py-2 font-medium tabular text-right">Incentivo</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-400">Cargando…</td></tr>}
              {!loading && ranking.map((r, idx) => {
                const t = r.therapist ?? { name: "—", initials: "?", color: "#666", position: "" };
                const c = sc(r.totalLevel);
                return (
                  <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                    <td className="px-4 py-3 font-display text-base text-neutral-400 tabular w-8">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-display" style={{ backgroundColor: t.color ?? "#1B3A2D" }}>{t.initials}</div>
                        <div>
                          <div className="text-[var(--ink-900)] font-medium leading-tight">{t.name}</div>
                          <div className="text-[10px] text-neutral-400">{t.position}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[11px] font-medium px-2 py-0.5 rounded-full tabular`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{r.totalScore}
                      </span>
                    </td>
                    <td className="px-4 py-3"><SemaforoMini areas={r.areas} /></td>
                    <td className="px-4 py-3 text-[11px] text-neutral-600">{r.complementsLabel}</td>
                    <td className="px-4 py-3 text-right tabular text-[var(--ink-900)] font-medium">{r.proposedIncentive} €</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      <button onClick={() => openEditRow(r)} className="text-[11px] text-neutral-500 hover:underline">Editar</button>
                      <Link href={`/equipo/mi-desempeno?therapistId=${r.therapistId}`} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">Ver</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 lg:px-5 py-3 border-t border-neutral-100 bg-neutral-50/40 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
          <span className="uppercase tracking-wider text-neutral-400">Leyenda áreas:</span>
          {PERFORMANCE_AREAS.map((a) => (
            <span key={a.key} className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-neutral-300" /> {a.n}. {a.name}</span>
          ))}
        </div>
      </div>

      {/* Alertas + Evolución */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-3">
        <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="eyebrow">Alertas</h2>
            <span className="text-[10px] text-neutral-400">{alerts.length} activas</span>
          </div>
          {alerts.length === 0 ? (
            <p className="text-[11px] text-neutral-400">Sin alertas en el periodo. 🎉</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => {
                const c = sc(a.severity === "high" ? "red" : "amber");
                return (
                  <div key={a.id} className={`flex items-start gap-3 rounded-lg ring-1 ${c.ring} ${c.bg} p-3`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-4 h-4 mt-0.5 shrink-0 ${c.text}`}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium ${c.text}`}>{a.therapistName ?? "—"}</div>
                      <div className="text-[11px] text-neutral-700 leading-snug mt-0.5">{a.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="eyebrow">Evolución del equipo</h2>
            <span className="text-[10px] text-neutral-400">Últimos 6 meses</span>
          </div>
          <TeamLineChart data={data?.history} />
          {data?.trend != null && (
            <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-500">
              <span>{data.trend >= 0 ? "Tendencia positiva" : "Tendencia a la baja"}</span>
              <span className={`font-medium ${data.trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>{data.trend >= 0 ? "+" : ""}{data.trend} pts (6m)</span>
            </div>
          )}
        </div>
      </div>

      {/* Configuración de tramos de incentivo */}
      <IncentiveTiersEditor onSaved={load} />

      {/* Incentivos escritos a mano (conceptos con € o % del sueldo) */}
      <IncentiveItemsEditor period={defaultPeriod} onChanged={load} />

      {/* Propuesta incentivos */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
          <div>
            <h2 className="eyebrow">Propuesta de incentivos</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">{pendingCount} pendiente{pendingCount !== 1 ? "s" : ""} de aprobar</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">Total propuesto</div>
            <div className="font-display text-xl text-[var(--ink-900)] tabular">{totalProposed} €</div>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-neutral-50/50">
            <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
              <th className="px-4 py-2 font-medium">Terapeuta</th>
              <th className="px-4 py-2 font-medium tabular text-right">Por puntuación</th>
              <th className="px-4 py-2 font-medium tabular text-right">Escritos</th>
              <th className="px-4 py-2 font-medium tabular text-right">Propuesto</th>
              <th className="px-4 py-2 font-medium tabular text-right">Aprobado</th>
              <th className="px-4 py-2 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="px-4 py-3 text-[var(--ink-900)]">{r.therapist?.name ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular text-neutral-600">{r.proposedIncentive} €</td>
                <td className="px-4 py-3 text-right tabular text-neutral-600">{r.extrasIncentive ? `${r.extrasIncentive} €` : <span className="text-neutral-300">—</span>}</td>
                <td className="px-4 py-3 text-right tabular font-medium">{r.totalProposed ?? r.proposedIncentive} €</td>
                <td className="px-4 py-3 text-right tabular">
                  {r.approved ? <span className="text-emerald-700 font-medium">{r.approvedIncentive} €</span> : <span className="text-neutral-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  {r.approved ? (
                    <button disabled={busy} onClick={() => patch(r.id, { action: "unapprove" })} className="text-[11px] text-neutral-500 hover:underline disabled:opacity-50">Revertir</button>
                  ) : (
                    <>
                      <button disabled={busy} onClick={() => patch(r.id, { action: "approve" })} className="text-[11px] text-emerald-700 hover:underline font-medium disabled:opacity-50">Aprobar</button>
                      <button disabled={busy} onClick={() => setAdjust({ id: r.id, name: r.therapist?.name, value: String(r.totalProposed ?? r.proposedIncentive ?? 0) })} className="text-[11px] text-neutral-500 hover:underline disabled:opacity-50">Ajustar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 lg:px-5 py-3 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-neutral-50/40">
          <span className="text-[11px] text-neutral-500">Propuesto = tramos según puntuación + incentivos escritos del mes. Aprobar usa ese total; Ajustar permite cualquier importe.</span>
          <button disabled={busy || pendingCount === 0} onClick={approveAll} className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            {busy ? "Procesando…" : pendingCount === 0 ? "Todo aprobado" : `Aprobar todos (${pendingCount})`}
          </button>
        </div>
      </div>

      {/* Modal ajustar incentivo */}
      {adjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setAdjust(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg text-[var(--ink-900)] mb-1">Ajustar incentivo</h3>
            <p className="text-[11px] text-neutral-400 mb-3">{adjust.name}</p>
            <div className="flex items-center gap-2">
              <input type="number" min={0} step={10} value={adjust.value} onChange={(e) => setAdjust({ ...adjust, value: e.target.value })} className="flex-1 px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular" autoFocus />
              <span className="text-sm text-neutral-500">€</span>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setAdjust(null)} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
              <button onClick={() => patch(adjust.id, { approvedIncentive: Number(adjust.value) })} disabled={busy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>{busy ? "Guardando…" : "Aprobar ajustado"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Editor de evaluación (nueva / editar) */}
      {editor && (
        <PerformanceEditor
          therapists={therapists}
          defaultPeriod={defaultPeriod}
          tiers={tiers}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}
