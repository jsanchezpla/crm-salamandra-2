"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import MultiSelect from "@/components/ui/MultiSelect.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import IncidenciaModal from "../_components/IncidenciaModal.jsx";
import { INCIDENCIA_CATEGORIES } from "@/lib/clinica/incidencias.js";
import { AYUDA_VISTO } from "@/lib/clinica/vistoIncidencia.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

/*
 * ── LAS PESTAÑAS SE SUMAN (18/09/2026, AV-198 de Aumenta) ───────────────────
 * Rosa, por el Buzón: «poder filtrar más de un tipo de incidencia (ej: faltas,
 * pendientes y en proceso)». Dejan de ser pestañas excluyentes y pasan a ser
 * marcas: ninguna marcada = todas, y las que se marquen se SUMAN. «Todas» es la
 * que las quita. El servidor recibe un `status` por cada una (y `faltas=1`) y
 * las junta con O — ver `lib/clinica/filtroIncidencias.js`.
 */
const STATUS_TABS = [
  { key: "pending", label: "Pendientes" },
  { key: "in_progress", label: "En proceso" },
  { key: "resolved", label: "Resueltas" },
  // Las faltas van aparte (03/09/2026, AV-0038 de Aumenta): las que abre sola
  // la agenda al marcar una falta, con su ciclo (huecos, respuesta, recuperación).
  // El número es el de las que siguen sin cerrar.
  { key: "faltas", label: "Faltas" },
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
  const [pestanas, setPestanas] = useState([]); // [] = todas (ver STATUS_TABS)
  /*
   * ── LOS TRES FILTROS SON DE VARIOS (18/09/2026, AV-198 de Aumenta) ──────
   * «Que el filtro sea múltiple y no solo de una opción». Contrato de
   * `MultiSelect`: `null` = todos (que NO es tenerlos todos marcados), `[a,b]`
   * = solo esos, `[]` no existe. El servidor los recibe repetidos
   * (`?category=a&category=b`) y los junta con O.
   */
  const [categorias, setCategorias] = useState(null);
  // Quién la registró y quién es responsable (31/08/2026, Rodrigo): con los
  // dos combinados salen «todas las mías», «todas las de X» y «las que le
  // mandé yo a X». Las opciones son la misma lista de equipo que usa el
  // formulario, que ya viene en la respuesta.
  const [registradaPor, setRegistradaPor] = useState(null);
  const [responsables, setResponsables] = useState(null);
  /*
   * ── SE ABRE EN LAS MÍAS (01/09/2026, Rodrigo; rehecho el 18/09/2026) ──────
   *
   * Un interruptor aparte del filtro de responsable, porque no son lo mismo.
   * Rosa, por el Buzón (AV-198): «que aparecieran por defecto en cada usuario
   * las que ha registrado y debe resolver ese usuario, aunque luego puedas
   * filtrar otras» — o sea las DOS cosas, y el filtro de responsable solo sabía
   * de una: a dirección no le salían las que ella misma había apuntado para
   * otra persona. Se manda `mine=1` y quién soy lo resuelve el servidor —el
   * navegador no lo sabe: /api/auth/me da el usuario, no su ficha de equipo—.
   * Quien no es dirección no lo ve: su alcance YA es ese.
   */
  const [soloMias, setSoloMias] = useState(true);
  // Buscador por texto (02/09/2026, AV-0011): asunto, descripción o nombre del
  // paciente. Se manda al servidor con 300 ms de calma para no consultar a
  // cada tecla.
  const [q, setQ] = useState("");
  const [qBuscada, setQBuscada] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQBuscada(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  /*
   * ── LAS QUE YA HE DADO POR VISTAS (04/09/2026, Rodrigo) ──────────────────
   * El botón «Visto» de la ficha aparta la incidencia de esta lista sin
   * cerrarla para el resto del equipo. Apartada, no escondida: este
   * interruptor las devuelve, y solo aparece si hay alguna — a quien no usa
   * el botón no le sale nunca.
   */
  const [verVistas, setVerVistas] = useState(false);
  const [panelFiltros, setPanelFiltros] = useState(false);
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
  // Los mismos parámetros para la lista y para el Excel (11/09/2026, AV-0125):
  // lo que se exporta es exactamente lo que se está viendo.
  const paramsActuales = () => {
    const params = new URLSearchParams();
    for (const p of pestanas) {
      if (p === "faltas") params.set("faltas", "1");
      else params.append("status", p);
    }
    for (const c of categorias ?? []) params.append("category", c);
    for (const r of registradaPor ?? []) params.append("reportedById", r);
    if (soloMias) params.set("mine", "1");
    // `assignedToId` filtra por la tabla de responsables, así que encuentra
    // también a quien es segundo responsable (ver el GET del endpoint).
    for (const r of responsables ?? []) params.append("assignedToId", r);
    if (qBuscada) params.set("q", qBuscada);
    if (verVistas) params.set("vistas", "1");
    return params;
  };
  const exportUrl = `/api/clinica/incidencias/export?${paramsActuales()}`;

  /*
   * ── MANDA LA ÚLTIMA QUE SE PIDIÓ, NO LA ÚLTIMA QUE LLEGA (18/09/2026) ─────
   * Visto al probar los tipos: se marcan dos seguidos y la lista se queda con
   * las de antes. Aquí salen varias peticiones a la vez —cada filtro lanza la
   * suya, y el refresco de fondo al volver a la pestaña lanza otra— y sin esto
   * gana la que conteste más tarde, que puede ser la más vieja: los botones
   * dicen una cosa y la lista enseña otra. Cada petición coge un número y solo
   * la última pinta.
   */
  const ultimaPeticion = useRef(0);
  const load = ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true);
    setErrorMsg(null);
    const params = paramsActuales();
    const mia = ++ultimaPeticion.current;
    fetch(`/api/clinica/incidencias?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (mia !== ultimaPeticion.current) return; // llegó tarde: ya hay otra en camino
        if (j.ok) setData(j.data); else setErrorMsg(j.error);
      })
      .catch((e) => { if (mia === ultimaPeticion.current) setErrorMsg(e.message); })
      .finally(() => { if (mia === ultimaPeticion.current) setLoading(false); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [pestanas, categorias, registradaPor, responsables, soloMias, qBuscada, verVistas]);

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
  }, [pestanas, categorias, registradaPor, responsables, soloMias, qBuscada, verVistas]);

  const rows = data?.incidencias ?? [];
  // ¿Se está filtrando por responsable? Con `null` («las mías») solo si el
  // servidor sabe quién soy: quien no tiene ficha de equipo las ve todas, y
  // decirle «con estos filtros» sería mentirle.
  // Quien no es dirección solo ve las suyas (02/09/2026, Aumenta): para ella no
  // hay filtro de responsable que valga, el alcance ya es «las mías».
  const soloLasMias = data?.alcance === "mias";
  // «Solo las mías» solo tiene sentido para quien las ve todas: a una terapeuta
  // el servidor ya le da las suyas y el interruptor no haría nada.
  const puedeVerTodas = !soloLasMias;
  const misMarcado = puedeVerTodas && soloMias && Boolean(data?.yoSoy);
  /*
   * ── UN SOLO BOTÓN EN VEZ DE CUATRO CONTROLES (18/09/2026, AV-198) ────────
   * Aumenta: «se quejan de que hay mucho filtro y es muy confuso». Arriba se
   * quedan las pestañas de estado y el buscador, que son los de todos los días;
   * los tres desplegables y el interruptor de las vistas se recogen en este
   * panel, que dice en el botón cuántos hay puestos y se quita de en medio con
   * «Quitar filtros». Panel plegable en el flujo de la página, no un cajón
   * flotante: no tapa nada y en móvil baja el contenido en vez de taparlo.
   */
  const filtrosPuestos =
    (categorias?.length ?? 0) +
    (puedeVerTodas ? (registradaPor?.length ?? 0) + (responsables?.length ?? 0) + (misMarcado ? 1 : 0) : 0) +
    (verVistas ? 1 : 0);
  const quitarFiltros = () => {
    setCategorias(null);
    setRegistradaPor(null);
    setResponsables(null);
    setSoloMias(false);
    setVerVistas(false);
  };
  const alternarPestana = (k) => setPestanas((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const counts = data?.counts ?? { pending: 0, in_progress: 0, resolved: 0, faltas: 0 };
  // Las faltas no suman en «Todas»: son otra lista (ver STATUS_TABS).
  const totalCount = counts.pending + counts.in_progress + counts.resolved;
  const tabCount = (k) => counts[k] ?? 0;

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
            <HelpTooltip title="Los tipos" className="ml-2">
              Agrupan por estado y se SUMAN: puedes ver a la vez pendientes, en proceso y faltas.
              Sin ninguno marcado salen todas. La etiqueta de la derecha de cada línea dice cómo
              acabó: «Parcial» y «No resuelta» están dentro de «En proceso», no tienen tipo propio.
            </HelpTooltip>
          </h1>
          {/* Decir SIEMPRE qué se está viendo (18/09/2026, AV-198): la pantalla se
              abre acotada a quien mira, y sin esta línea parecía que había menos
              incidencias de las que hay. Con el porqué al lado del remedio. */}
          <p className="text-xs text-neutral-400 mt-1">
            {soloLasMias
              ? "Ves las incidencias que registraste tú o que tienes asignadas. Dirección las ve todas."
              : misMarcado
                ? "Ves las que registraste tú o tienes asignadas. Quita «Solo las mías» en Filtros para verlas todas."
                : "Registro y seguimiento de incidencias del equipo."}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-auto">
          {/* El listado tal cual se ve, en Excel (11/09/2026, AV-0125 de Aumenta):
              un enlace, sin JavaScript, con los filtros de la pantalla. */}
          <a
            href={exportUrl}
            title="Descarga en Excel las incidencias que se ven ahora, con estos filtros"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-[var(--ink-200,#e5e7eb)] bg-white text-[var(--ink-700,#374151)] hover:bg-neutral-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
            </svg>
            Exportar Excel
          </a>
          <button
            onClick={() => setModal({ mode: "create", incidencia: null })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Nueva incidencia
          </button>
        </div>
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Los tipos se marcan y se suman (18/09/2026, AV-198). «Todas» no es uno
            más: es el que los quita, y se ve marcado cuando no hay ninguno. */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipos de incidencia">
          <button
            onClick={() => setPestanas([])}
            aria-pressed={pestanas.length === 0}
            className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${pestanas.length === 0 ? "text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}
            style={pestanas.length === 0 ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
          >
            Todas <span className="opacity-70">· {totalCount}</span>
          </button>
          {STATUS_TABS.map((t) => {
            const marcada = pestanas.includes(t.key);
            return (
              <button key={t.key} onClick={() => alternarPestana(t.key)} aria-pressed={marcada}
                className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${marcada ? "text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}
                style={marcada ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
                {t.label} <span className="opacity-70">· {tabCount(t.key)}</span>
              </button>
            );
          })}
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por asunto, paciente o palabra…"
            aria-label="Buscar incidencias por asunto, paciente o palabra"
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 focus:outline-none focus:border-neutral-400 flex-1 sm:flex-none sm:w-56"
          />
          <button
            type="button"
            onClick={() => setPanelFiltros((v) => !v)}
            aria-expanded={panelFiltros}
            aria-controls="panel-filtros-incidencias"
            className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${filtrosPuestos ? "border-[var(--color-primary,#1B3A2D)] text-[var(--color-primary,#1B3A2D)] bg-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            Filtros
            {filtrosPuestos > 0 && (
              <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] text-white" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                {filtrosPuestos}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* El panel: los tres desplegables de varios y las dadas por vistas.
          Plegado por defecto — se abre con el botón de arriba. Va en el flujo
          de la página y no flotando: no tapa la lista y en móvil la empuja
          hacia abajo en vez de taparla. */}
      {panelFiltros && (
        <div id="panel-filtros-incidencias" className="bg-white border border-neutral-100 rounded-xl p-3 lg:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Cada persona sale con su NOMBRE a secas (01/09/2026, Rodrigo):
                repetir «Registrada por X» / «Responsable: X» en cada línea de
                los dos desplegables era ruido. Cuál es cuál lo dice el rótulo
                de encima. Los dos filtros por persona solo tienen sentido para
                quien ve las de todo el equipo: a una terapeuta el servidor ya
                le da las suyas. */}
            {!soloLasMias && (
              <>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-neutral-400">Registrada por</label>
                  <MultiSelect
                    value={registradaPor}
                    onChange={setRegistradaPor}
                    options={(data?.therapists ?? []).map((t) => ({ value: t.id, label: t.name }))}
                    etiquetaTodos="Cualquiera"
                    resumen={(n) => `${n} personas`}
                    searchable
                    aria-label="Filtrar por quién registró la incidencia"
                    className="mt-1 w-full text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-neutral-400">Responsable</label>
                  <MultiSelect
                    value={responsables === "mias" ? (data?.yoSoy ? [data.yoSoy] : null) : responsables}
                    onChange={setResponsables}
                    options={(data?.therapists ?? []).map((t) => ({ value: t.id, label: t.name }))}
                    etiquetaTodos="Cualquiera"
                    resumen={(n) => `${n} personas`}
                    searchable
                    aria-label="Filtrar por responsable"
                    className="mt-1 w-full text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Categoría</label>
              <MultiSelect
                value={categorias}
                onChange={setCategorias}
                options={INCIDENCIA_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
                etiquetaTodos="Todas"
                resumen={(n) => `${n} categorías`}
                aria-label="Filtrar por categoría"
                className="mt-1 w-full text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
              />
            </div>
          </div>
          {/* Lo primero del panel, porque es lo que más acota la lista. */}
          {puedeVerTodas && (
            <label className="flex items-start gap-2 text-[11px] text-neutral-600 cursor-pointer select-none border-t border-neutral-100 pt-3">
              <input type="checkbox" className="mt-0.5" checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} />
              <span>
                Solo las mías
                <span className="block text-neutral-400">
                  Las que registré yo o tengo asignadas.
                  {!data?.yoSoy && " Esta cuenta no tiene ficha de equipo, así que ahora mismo no acota nada."}
                </span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {/* Solo sale si hay alguna dada por vista: a quien no usa el botón
                no le aparece un interruptor que no le dice nada. */}
            {data?.vistasTotales > 0 ? (
              <label className="flex items-center gap-2 text-[11px] text-neutral-500 cursor-pointer select-none" title={AYUDA_VISTO}>
                <input type="checkbox" checked={verVistas} onChange={(e) => setVerVistas(e.target.checked)} />
                Ver las {data.vistasTotales} que ya diste por vistas
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={quitarFiltros}
              disabled={filtrosPuestos === 0}
              className="text-[11px] font-medium text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] disabled:text-neutral-300 disabled:cursor-default transition-colors"
            >
              Quitar filtros
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-neutral-400 text-sm">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-neutral-400 text-sm">No hay incidencias{pestanas.length || filtrosPuestos || qBuscada ? " con estos filtros" : ""}.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setModal({ mode: "view", incidencia: r })} className="w-full text-left px-4 lg:px-5 py-3 hover:bg-neutral-50/60 transition-colors flex items-center gap-3">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[r.priority] ?? "bg-neutral-300"}`} title={`Prioridad ${r.priorityLabel}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--ink-900)] font-medium truncate">{r.title}</span>
                      {r.falta ? (
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${r.falta.respuesta === "aceptada" ? "bg-emerald-50 text-emerald-700" : r.falta.respuesta === "rechazada" ? "bg-neutral-100 text-neutral-500" : "bg-amber-50 text-amber-800"}`}>
                          {r.faltaResumen}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">{r.categoryLabel}{r.subcategory ? ` · ${r.subcategory}` : ""}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                      {/* El paciente PRIMERO (07/09/2026, AV-0052 de Aumenta):
                          el subtítulo se recorta por el final, y con varias
                          responsables lo que no puede caerse es de quién va. */}
                      {r.patient ? `${r.patient.name} · ` : ""}
                      {fmt(r.date)}
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
                  {/* Tu «Visto» — solo se ve al pedir las apartadas, que es
                      cuando hace falta distinguirlas de las que siguen vivas. */}
                  {r.visto && (
                    <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700" title="La diste por vista: sigue abierta para el resto del equipo">
                      ✓ Visto
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
