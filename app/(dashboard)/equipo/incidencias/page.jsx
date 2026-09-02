"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import IncidenciaModal from "../_components/IncidenciaModal.jsx";
import { INCIDENCIA_CATEGORIES } from "@/lib/clinica/incidencias.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const STATUS_TABS = [
  { key: "", label: "Todas" },
  { key: "pending", label: "Pendientes" },
  { key: "in_progress", label: "En proceso" },
  { key: "resolved", label: "Resueltas" },
];
const STATUS_PILL = {
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  // La verificación «no resuelta» tiene su propio color: en la lista, «En
  // proceso» no distingue entre «va a medias» y «se intentó y no funcionó».
  red: "bg-rose-50 text-rose-700",
  gray: "bg-neutral-100 text-neutral-500",
};
const PRIORITY_DOT = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-neutral-300" };
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—");

export default function IncidenciasPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState("");
  const [category, setCategory] = useState("");
  // Quién la registró y quién es responsable (31/08/2026, Rodrigo): con los
  // dos combinados salen «todas las mías», «todas las de X» y «las que le
  // mandé yo a X». Las opciones son la misma lista de equipo que usa el
  // formulario, que ya viene en la respuesta.
  const [registroId, setRegistroId] = useState("");
  /*
   * ── SE ABRE EN LAS MÍAS (01/09/2026, Rodrigo) ────────────────────────────
   *
   * `null` no es «cualquiera»: es «las que me atañen a mí», que es como se
   * abre la pantalla. Se manda `mine=1` y el servidor resuelve quién soy —el
   * navegador no lo sabe: /api/auth/me da el usuario, no su ficha de equipo—,
   * y de vuelta llega `yoSoy` para que el desplegable enseñe mi nombre en vez
   * de un hueco. Elegir «Cualquier responsable» pone "" y quita el filtro.
   */
  const [responsableId, setResponsableId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [modal, setModal] = useState(null); // { mode, incidencia }
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setIsAdmin(["admin", "superadmin"].includes(j.data?.role)); })
      .catch(() => {});
  }, []);

  // `silencioso` (02/09/2026): refresco de fondo al volver a la pestaña, sin
  // sustituir la lista por «Cargando…» mientras llega.
  const load = ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true);
    setErrorMsg(null);
    const params = new URLSearchParams();
    if (statusTab) params.set("status", statusTab);
    if (category) params.set("category", category);
    if (registroId) params.set("reportedById", registroId);
    // `assignedToId` filtra por la tabla de responsables, así que encuentra
    // también a quien es segundo responsable (ver el GET del endpoint).
    if (responsableId === null) params.set("mine", "1");
    else if (responsableId) params.set("assignedToId", responsableId);
    fetch(`/api/clinica/incidencias?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setData(j.data); else setErrorMsg(j.error); })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [statusTab, category, registroId, responsableId]);

  // Deep-link desde la campana (02/09/2026): `?incidencia=<id>` abre ESA ficha
  // fresca del servidor, no la copia del listado. Se lee de window.location y
  // no de useSearchParams por lo mismo que en /soporte: la Suspense boundary
  // que exige no se resolvía. Se limpia la URL para que un F5 no la reabra.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("incidencia");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    fetch(`/api/clinica/incidencias/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setModal({ mode: "view", incidencia: j.data }); else setErrorMsg(j.error); })
      .catch(() => {});
  }, []);

  // Un compañero comenta mientras esta pestaña está en segundo plano: al volver,
  // el listado se pone al día solo. Antes solo se recargaba al cambiar un filtro.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === "visible") load({ silencioso: true }); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab, category, registroId, responsableId]);

  const rows = data?.incidencias ?? [];
  // ¿Se está filtrando por responsable? Con `null` («las mías») solo si el
  // servidor sabe quién soy: quien no tiene ficha de equipo las ve todas, y
  // decirle «con estos filtros» sería mentirle.
  // Quien no es dirección solo ve las suyas (02/09/2026, Aumenta): para ella no
  // hay filtro de responsable que valga, el alcance ya es «las mías».
  const soloLasMias = data?.alcance === "mias";
  const filtrandoPorResponsable = soloLasMias
    ? false
    : responsableId === null ? Boolean(data?.yoSoy) : Boolean(responsableId);
  const counts = data?.counts ?? { pending: 0, in_progress: 0, resolved: 0 };
  const totalCount = counts.pending + counts.in_progress + counts.resolved;
  const tabCount = (k) => (k === "" ? totalCount : counts[k] ?? 0);

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Equipo
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Equipo · Incidencias</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Incidencias
            <HelpTooltip title="Pestañas" className="ml-2">
              Agrupan por estado, y la etiqueta de la derecha de cada línea dice cómo acabó.
              «Parcial» y «No resuelta» están dentro de «En proceso»: no tienen pestaña propia.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {soloLasMias
              ? "Ves las incidencias que registraste tú o que tienes asignadas. Dirección las ve todas."
              : "Registro y seguimiento de incidencias del equipo."}
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create", incidencia: null })}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity self-start lg:self-auto"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          Nueva incidencia
        </button>
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button key={t.key} onClick={() => setStatusTab(t.key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${statusTab === t.key ? "text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}
              style={statusTab === t.key ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
              {t.label} <span className="opacity-70">· {tabCount(t.key)}</span>
            </button>
          ))}
        </div>
        {/* Cada persona sale con su NOMBRE a secas (01/09/2026, Rodrigo):
            repetir «Registrada por X» / «Responsable: X» en cada línea de los
            dos desplegables era ruido. Cuál es cuál lo dice la opción neutra
            de cada uno, que es la que se ve mientras no hay filtro puesto. */}
        <div className="sm:ml-auto flex flex-wrap gap-2">
          {/* Los dos filtros por persona solo tienen sentido para quien ve las
              de todo el equipo: a una terapeuta el servidor ya le da las suyas. */}
          {!soloLasMias && (
            <>
              <Select value={registroId} onChange={setRegistroId} aria-label="Filtrar por quién registró la incidencia"
                options={[{ value: "", label: "Registrada por cualquiera" }, ...(data?.therapists ?? []).map((t) => ({ value: t.id, label: t.name }))]}
                className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer" />
              <Select value={responsableId ?? data?.yoSoy ?? ""} onChange={setResponsableId} aria-label="Filtrar por responsable"
                options={[{ value: "", label: "Cualquier responsable" }, ...(data?.therapists ?? []).map((t) => ({ value: t.id, label: t.name }))]}
                className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer" />
            </>
          )}
          <Select value={category} onChange={setCategory}
            options={[{ value: "", label: "Todas las categorías" }, ...INCIDENCIA_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))]}
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer" />
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-neutral-400 text-sm">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-neutral-400 text-sm">No hay incidencias{statusTab || category || registroId || filtrandoPorResponsable ? " con estos filtros" : ""}.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setModal({ mode: "view", incidencia: r })} className="w-full text-left px-4 lg:px-5 py-3 hover:bg-neutral-50/60 transition-colors flex items-center gap-3">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[r.priority] ?? "bg-neutral-300"}`} title={`Prioridad ${r.priorityLabel}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--ink-900)] font-medium truncate">{r.title}</span>
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">{r.categoryLabel}{r.subcategory ? ` · ${r.subcategory}` : ""}</span>
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                      {fmt(r.date)}
                      {r.patient ? ` · ${r.patient.name}` : ""}
                      {/* Con varios responsables se enseñan todos: era el
                          punto del cambio, ver solo al principal lo dejaba a
                          medias. */}
                      {r.assignees?.length
                        ? ` · ${r.assignees.map((a) => a.name).join(", ")}`
                        : " · sin asignar"}
                    </div>
                  </div>
                  {r.docsCount > 0 && (
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-neutral-400" title={`${r.docsCount} documento${r.docsCount === 1 ? "" : "s"} adjunto${r.docsCount === 1 ? "" : "s"}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                      </svg>
                      {r.docsCount}
                    </span>
                  )}
                  {r.comments?.length > 0 && (
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-neutral-400" title={`${r.comments.length} comentario${r.comments.length === 1 ? "" : "s"}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                      {r.comments.length}
                    </span>
                  )}
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[r.verificationLevel ?? r.statusLevel] ?? STATUS_PILL.gray}`}>
                    {r.verificationLabel ?? r.statusLabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modal && (
        <IncidenciaModal
          mode={modal.mode}
          incidencia={modal.incidencia}
          therapists={data?.therapists ?? []}
          patients={data?.patients ?? []}
          isAdmin={isAdmin}
          yoSoy={data?.yoSoy ?? null}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
