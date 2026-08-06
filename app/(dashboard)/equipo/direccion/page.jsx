"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import IncentiveTiersEditor from "../_components/IncentiveTiersEditor.jsx";
import IncentiveItemsEditor from "../_components/IncentiveItemsEditor.jsx";
import PerformanceEditor from "../_components/PerformanceEditor.jsx";
import { scoreToSemaforo } from "@/lib/clinica/performanceAreas.js";

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

// Puntos de área por fila: usa las áreas y los umbrales del ROL de esa fila
// (desempeño por roles: cada fila puede tener un set de áreas distinto).
function SemaforoMini({ areas, roleAreas = [], thresholds }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {roleAreas.map((a, i) => {
        const c = sc(scoreToSemaforo(areas?.[a.key], thresholds));
        return <span key={a.key} className={`w-2 h-2 rounded-full ${c.dot}`} title={`Área ${a.n ?? i + 1}: ${a.name} — ${areas?.[a.key] ?? "—"}/100`} />;
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
  const [editorTherapistId, setEditorTherapistId] = useState(""); // persona elegida en el editor → resuelve su rol
  const [roleFilter, setRoleFilter] = useState(""); // "" = todos los roles
  const [dash, setDash] = useState(null); // datos operativos (productividad + incidencias)
  // Cumplimiento de los planes de intervención por terapeuta (punto 1.4 del
  // sprint): lo que cada uno lleva del trimestre, para el programa de
  // incentivos. Antes había que abrir las fichas una a una y sumar a mano.
  const [planes, setPlanes] = useState(null);
  const [trimestre, setTrimestre] = useState("");

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

  useEffect(() => {
    fetch(`/api/clinica/performance/planes${trimestre ? `?trimestre=${trimestre}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return;
        setPlanes(j.data);
        if (!trimestre && j.data.trimestre?.key) setTrimestre(j.data.trimestre.key);
      })
      .catch(() => {});
  }, [trimestre]);

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

  // ── Desempeño por roles: bloque `roles` de la config (viene en el GET team) ──
  const rolesList = Array.isArray(data?.roles) ? data.roles : (data?.roles?.roles ?? []);
  const roleByKey = Object.fromEntries(rolesList.map((r) => [r.key, r]));
  const defaultRole = rolesList.find((r) => r.isDefault) ?? rolesList[0] ?? null;
  const roleForRow = (r) => roleByKey[r.roleKey] ?? defaultRole;
  // Rol de una persona para una evaluación NUEVA: el roleKey que traiga la lista
  // de evaluables (si el backend lo aporta) o el rol por defecto.
  const roleKeyForTherapist = (id) => {
    const t = therapists.find((x) => x.id === id);
    return t?.roleKey && roleByKey[t.roleKey] ? t.roleKey : (defaultRole?.key ?? null);
  };
  const editorRole = editor ? (roleByKey[roleKeyForTherapist(editorTherapistId)] ?? defaultRole) : null;
  // Filtro por rol del ranking (solo visible si hay >1 rol configurado).
  const visibleRanking = roleFilter ? ranking.filter((r) => (roleForRow(r)?.key ?? "") === roleFilter) : ranking;
  // Leyenda de áreas: la del rol filtrado, o la del único rol configurado.
  const legendRole = roleFilter ? roleByKey[roleFilter] : (rolesList.length === 1 ? rolesList[0] : null);

  // Periodo por defecto para una evaluación nueva: el del panel, o el mes actual.
  const now = new Date();
  const defaultPeriod = data?.period?.value ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const openEditRow = (r) => {
    setEditorTherapistId(r.therapistId);
    setEditor({ initial: { therapistId: r.therapistId, therapistName: r.therapist?.name, areaScores: r.areas, complements: r.complements, notes: r.notes } });
  };

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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Equipo · Dirección</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Panel de dirección</h1>
          <p className="text-xs text-neutral-400 mt-1">
            Visión global del equipo · Periodo de {data?.period ? `${["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][data.period.month]} ${data.period.year}` : "—"}
            <HelpTooltip title="Periodo" className="ml-1">
              Es el último mes con evaluaciones guardadas, no siempre el mes en curso. Manda en el
              ranking, en la puntuación media y en los incentivos.{" "}
              <strong className="text-white">No manda en productividad ni en incidencias</strong>:
              esas tarjetas van por el mes actual. Y «Entregas en plazo» no mira ningún periodo:
              son todos los informes entregados hasta hoy.
            </HelpTooltip>
          </p>
        </div>
        <Link
          href="/equipo/desempeno-config"
          className="inline-flex items-center gap-1.5 self-start lg:self-auto text-[11px] font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 transition-colors"
          title="Roles, áreas, pesos y metas de la evaluación"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.164-.398.142-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Configurar desempeño
        </Link>
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

      {/* Cumplimiento de planes por terapeuta (punto 1.4) */}
      {planes?.aplicable && planes.terapeutas.length > 0 && (
        <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden mb-4">
          <div className="px-4 lg:px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100">
            <h2 className="eyebrow">Planes de intervención · cumplimiento del trimestre</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-neutral-400">Curso {planes.curso}</span>
              <select
                value={trimestre}
                onChange={(e) => setTrimestre(e.target.value)}
                className="text-[11px] border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white"
              >
                {(planes.trimestres ?? []).map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-neutral-100 text-[10px] uppercase tracking-wider text-neutral-400">
                  <th className="text-left px-4 py-2 font-medium">Terapeuta</th>
                  <th className="text-right px-4 py-2 font-medium">Pacientes</th>
                  <th className="text-right px-4 py-2 font-medium">Informes</th>
                  <th className="text-right px-4 py-2 font-medium">Registros</th>
                  <th className="text-right px-4 py-2 font-medium">Al día</th>
                  <th className="text-right px-4 py-2 font-medium">Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {planes.terapeutas.map((t) => (
                  <tr key={t.therapistId ?? "sin"} className="border-b border-neutral-50">
                    <td className="px-4 py-2.5 text-xs text-neutral-800">
                      {t.name}
                      {t.position && <span className="text-neutral-400"> · {t.position}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right text-neutral-600 tabular">{t.pacientes}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular text-neutral-600">
                      {t.informes.hechos}/{t.informes.previstos}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right tabular text-neutral-600">
                      {t.registros.hechos}/{t.registros.previstos}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right tabular text-neutral-600">
                      {t.alDia}/{t.pacientes}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {t.cumplimiento == null ? (
                        <span className="text-[11px] text-neutral-400">sin plan</span>
                      ) : (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${t.cumplimiento >= 85 ? "bg-emerald-50 text-emerald-700" : t.cumplimiento >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                          {t.cumplimiento}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-neutral-400 border-t border-neutral-50">
            Se cuenta sobre los informes y las sesiones reales del trimestre, igual que la pestaña
            «Plan» de cada paciente: no hay contadores guardados que puedan desfasarse.
          </p>
        </div>
      )}

      {/* Ranking */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100">
          <h2 className="eyebrow">Ranking del equipo</h2>
          <div className="flex items-center gap-2">
            {rolesList.length > 1 && (
              <Select
                value={roleFilter}
                onChange={setRoleFilter}
                options={[{ value: "", label: "Todos los roles" }, ...rolesList.map((r) => ({ value: r.key, label: r.name }))]}
                className="text-[11px] border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white hover:border-neutral-300 cursor-pointer"
                aria-label="Filtrar por rol"
              />
            )}
            <button
              onClick={() => { setEditorTherapistId(""); setEditor({ initial: null }); }}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-opacity"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              Nueva evaluación
            </button>
          </div>
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
              {!loading && visibleRanking.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-400">Sin evaluaciones{roleFilter ? " para este rol" : ""} en el periodo.</td></tr>}
              {!loading && visibleRanking.map((r, idx) => {
                const t = r.therapist ?? { name: "—", initials: "?", color: "#666", position: "" };
                const c = sc(r.totalLevel);
                const rowRole = roleForRow(r);
                return (
                  <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                    <td className="px-4 py-3 font-display text-base text-neutral-400 tabular w-8">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-display" style={{ backgroundColor: t.color ?? "#1B3A2D" }}>{t.initials}</div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[var(--ink-900)] font-medium leading-tight">{t.name}</span>
                            {rowRole && (
                              <span className="inline-flex items-center bg-neutral-100 text-neutral-500 text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap" title="Rol de desempeño de esta evaluación">{r.roleName ?? rowRole.name}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-neutral-400">{t.position}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[11px] font-medium px-2 py-0.5 rounded-full tabular`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{r.totalScore}
                      </span>
                    </td>
                    <td className="px-4 py-3"><SemaforoMini areas={r.areas} roleAreas={rowRole?.areas ?? []} thresholds={rowRole?.thresholds} /></td>
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
          {legendRole ? (
            <>
              <span className="uppercase tracking-wider text-neutral-400">Leyenda áreas ({legendRole.name}):</span>
              {(legendRole.areas ?? []).map((a, i) => (
                <span key={a.key} className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-neutral-300" /> {a.n ?? i + 1}. {a.name}</span>
              ))}
            </>
          ) : (
            <span className="text-neutral-400">Cada rol tiene sus propias áreas: pasa el ratón por los puntos, o filtra por rol para ver su leyenda.</span>
          )}
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
          areas={editorRole?.areas ?? []}
          thresholds={editorRole?.thresholds}
          roleKey={editorRole?.key ?? null}
          onTherapistChange={setEditorTherapistId}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}
