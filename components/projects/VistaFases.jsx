"use client";

import { useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import {
  resumenDeFase,
  resumenSinFase,
  ordenarFases,
  avanceGlobal,
  ORDENES_FASE,
  hoyMadrid,
} from "@/lib/projects/faseProgreso.js";

/**
 * VistaFases — la pestaña «Fases» del proyecto (01/09/2026, Rodrigo:
 * «debería haber también una vista para ver todas las fases en orden de
 * porcentaje de compleción etc y más cosas útiles»).
 *
 * Antes esto era una lista de nombres con dos fechas: decía QUÉ fases hay y
 * nada de cómo van. Ahora cada fase enseña lo que hace falta para decidir por
 * dónde seguir —cuánto lleva, qué se está pasando de fecha, cuántas horas
 * quedan y quién anda metido— y la lista se puede ordenar por avance, por
 * fecha de fin o por retraso.
 *
 * **Cada fase tiene sus propias tareas y sus propios entregables**: al abrirla
 * se ven las dos listas, que es lo que hace que una fase signifique algo y no
 * sea una etiqueta suelta. «Entregable» es el HITO (`milestone`) de esa fase:
 * el CRM ya tenía el concepto —nombre, fecha, hecho o no, y su fase— y crear
 * una segunda tabla casi idéntica al lado habría sido duplicar por el nombre.
 *
 * Los números NO se calculan aquí: salen de `lib/projects/faseProgreso.js`,
 * que se prueba en `_smoke-fases-progreso.mjs`. Esta pantalla solo los pinta.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

// Los tonos del estado de una fase. `--color-primary` para lo que va bien: la
// portada y el resto del CRM ya usan el verde de la marca para eso.
const TONO = {
  verde: { chip: "bg-emerald-50 text-emerald-700 border-emerald-100", barra: "var(--color-primary, #1B3A2D)" },
  azul: { chip: "bg-sky-50 text-sky-700 border-sky-100", barra: "#0EA5E9" },
  rojo: { chip: "bg-rose-50 text-rose-700 border-rose-100", barra: "#E11D48" },
  gris: { chip: "bg-neutral-100 text-neutral-500 border-neutral-200", barra: "#A3A3A3" },
};

const COLOR_FASE_POR_DEFECTO = "#3B82F6";

function fmtDia(d) {
  if (!d) return null;
  const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function iniciales(nombre) {
  if (!nombre) return "??";
  return nombre.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

/** La barra de avance. Con `porcentaje === null` se pinta vacía y sin número. */
function Barra({ porcentaje, color, alto = "h-2" }) {
  return (
    <div className={`w-full ${alto} rounded-full bg-[var(--ink-100,#F0EFEA)] overflow-hidden`}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${porcentaje ?? 0}%`, background: color }}
      />
    </div>
  );
}

function Chip({ children, clase = TONO.gris.chip, title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${clase}`}>
      {children}
    </span>
  );
}

/* ── Una fase ─────────────────────────────────────────────────────────────── */

function FilaFase({ r, projectId, canEdit, abierta, onAbrir, onChange }) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({
    name: r.nombre,
    color: r.color || COLOR_FASE_POR_DEFECTO,
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
  });
  const [guardando, setGuardando] = useState(false);

  const esSinFase = r.id === null;
  const tono = TONO[r.estado.tono] ?? TONO.gris;
  const color = r.color || tono.barra;

  async function guardar() {
    if (!form.name.trim()) return;
    setGuardando(true);
    try {
      await fetch(`/api/projects/${projectId}/phases/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          color: form.color,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        }),
      });
      setEditando(false);
      onChange();
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!confirm(`¿Borrar la fase «${r.nombre}»? Sus tareas y entregables se quedan sin fase, no se borran.`)) return;
    await fetch(`/api/projects/${projectId}/phases/${r.id}`, { method: "DELETE" });
    onChange();
  }

  /** Marcar la fase entera como completada (o reabrirla). */
  async function alternarCompletada() {
    await fetch(`/api/projects/${projectId}/phases/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completedAt: r.fase.completedAt ? null : new Date().toISOString() }),
    });
    onChange();
  }

  return (
    <li className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {/* Cabecera: se pulsa para abrir la fase */}
      <div className="flex items-stretch">
        <span className="w-1.5 shrink-0" style={{ background: color }} aria-hidden="true" />
        <button
          type="button"
          onClick={onAbrir}
          aria-expanded={abierta}
          className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`font-medium ${esSinFase ? "text-neutral-500 italic" : "text-neutral-800"}`}>
              {r.nombre}
            </span>
            <Chip clase={tono.chip}>{r.estado.etiqueta}</Chip>
            {r.totales.vencidas > 0 && (
              <Chip clase={TONO.rojo.chip} title="Tareas y entregables que se han pasado de fecha">
                {r.totales.vencidas} con retraso
              </Chip>
            )}
            <span className="ml-auto flex items-center gap-2 shrink-0">
              {r.personas.slice(0, 4).map((p) => (
                <span
                  key={p.id}
                  title={p.displayName}
                  className="w-6 h-6 -ml-2 first:ml-0 rounded-full bg-neutral-200 ring-2 ring-white flex items-center justify-center text-[9px] font-semibold text-neutral-700"
                  style={p.avatarColor ? { background: p.avatarColor, color: "white" } : undefined}
                >
                  {iniciales(p.displayName)}
                </span>
              ))}
              <span className="font-display text-[18px] leading-none tabular-nums text-neutral-800 w-12 text-right">
                {r.porcentaje === null ? "—" : `${r.porcentaje}%`}
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${abierta ? "rotate-180" : ""}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </div>

          <div className="mt-2">
            <Barra porcentaje={r.porcentaje} color={color} />
          </div>

          <div className="mt-2 flex items-center gap-3 flex-wrap text-[11.5px] text-neutral-500">
            <span>
              {r.totales.tareasHechas}/{r.totales.tareas} {r.totales.tareas === 1 ? "tarea" : "tareas"}
            </span>
            <span className="text-neutral-300">·</span>
            <span>
              {r.totales.entregablesHechos}/{r.totales.entregables}{" "}
              {r.totales.entregables === 1 ? "entregable" : "entregables"}
            </span>
            {r.totales.horasEstimadas > 0 && (
              <>
                <span className="text-neutral-300">·</span>
                <span>{r.totales.horasEstimadas} h estimadas</span>
              </>
            )}
            {(r.startDate || r.endDate) && (
              <>
                <span className="text-neutral-300">·</span>
                <span>
                  {fmtDia(r.startDate) ?? "?"} → {fmtDia(r.endDate) ?? "?"}
                </span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* Abierta: sus tareas y sus entregables */}
      {abierta && (
        <div className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-3">
          {editando ? (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 mb-3">
              <input
                className={inputCls + " sm:col-span-2"}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nombre de la fase"
              />
              <input
                type="color"
                className="h-10 w-full border border-neutral-200"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                aria-label="Color de la fase"
              />
              <input type="date" className={inputCls} value={form.startDate ?? ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              <input type="date" className={inputCls} value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              <div className="flex items-center gap-2">
                <button
                  onClick={guardar}
                  disabled={guardando || !form.name.trim()}
                  className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-xs font-medium disabled:opacity-50"
                >
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
                <button onClick={() => setEditando(false)} className="text-xs text-neutral-500 hover:text-neutral-800">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            canEdit &&
            !esSinFase && (
              <div className="flex items-center gap-3 mb-3 text-xs">
                <button onClick={() => setEditando(true)} className="text-neutral-600 hover:text-neutral-900 underline underline-offset-2">
                  Editar fase
                </button>
                <button onClick={alternarCompletada} className="text-neutral-600 hover:text-neutral-900 underline underline-offset-2">
                  {r.fase.completedAt ? "Reabrir la fase" : "Dar la fase por completada"}
                </button>
                <button onClick={borrar} className="ml-auto text-rose-600 hover:text-rose-700">
                  Borrar
                </button>
              </div>
            )
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400 mb-1.5">
                Tareas
              </div>
              {r.tareas.length === 0 ? (
                <p className="text-xs text-neutral-400">Ninguna tarea en esta fase.</p>
              ) : (
                <ul className="rounded-lg border border-neutral-200 bg-white divide-y divide-neutral-100">
                  {r.tareas.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: t.boardColumn?.color || "#D4D4D4" }}
                        title={t.boardColumn?.name || "Sin estado"}
                      />
                      <span className={`flex-1 min-w-0 truncate ${t.boardColumn?.isDoneColumn ? "line-through text-neutral-400" : "text-neutral-800"}`}>
                        {t.title}
                      </span>
                      {t.dueDate && (
                        <span className="shrink-0 text-[11px] text-neutral-400">{fmtDia(t.dueDate)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400 mb-1.5">
                Entregables
              </div>
              {r.entregables.length === 0 ? (
                <p className="text-xs text-neutral-400">Ningún entregable en esta fase.</p>
              ) : (
                <ul className="rounded-lg border border-neutral-200 bg-white divide-y divide-neutral-100">
                  {r.entregables.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          m.status === "completed" ? "bg-emerald-500" : m.status === "missed" ? "bg-rose-500" : "bg-neutral-300"
                        }`}
                        title={m.status === "completed" ? "Entregado" : m.status === "missed" ? "No entregado" : "Pendiente"}
                      />
                      <span className={`flex-1 min-w-0 truncate ${m.status === "completed" ? "line-through text-neutral-400" : "text-neutral-800"}`}>
                        {m.name}
                      </span>
                      {m.dueDate && <span className="shrink-0 text-[11px] text-neutral-400">{fmtDia(m.dueDate)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/* ── La vista ─────────────────────────────────────────────────────────────── */

export default function VistaFases({ projectId, phases = [], milestones = [], tasks = [], canEdit = false, onChange }) {
  const [orden, setOrden] = useState("plan");
  const [abierta, setAbierta] = useState(null);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({ name: "", color: COLOR_FASE_POR_DEFECTO, startDate: "", endDate: "" });
  const [guardando, setGuardando] = useState(false);

  const hoy = hoyMadrid();

  const resumenes = useMemo(
    () => phases.map((p) => resumenDeFase(p, { tareas: tasks, entregables: milestones, hoy })),
    [phases, tasks, milestones, hoy]
  );
  // Lo que no cuelga de ninguna fase se enseña al final, y SOLO si existe: es
  // trabajo real sin colocar, y esconderlo sería enseñar un proyecto más
  // ordenado de lo que está.
  const huerfanas = useMemo(
    () => resumenSinFase({ tareas: tasks, entregables: milestones, hoy }),
    [tasks, milestones, hoy]
  );
  const global = useMemo(() => avanceGlobal([...resumenes, huerfanas]), [resumenes, huerfanas]);
  const ordenadas = useMemo(() => ordenarFases(resumenes, orden), [resumenes, orden]);

  async function crear(e) {
    e.preventDefault();
    if (!nueva.name.trim()) return;
    setGuardando(true);
    try {
      await fetch(`/api/projects/${projectId}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nueva.name.trim(),
          color: nueva.color,
          startDate: nueva.startDate || null,
          endDate: nueva.endDate || null,
        }),
      });
      setNueva({ name: "", color: COLOR_FASE_POR_DEFECTO, startDate: "", endDate: "" });
      setCreando(false);
      onChange();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 lg:p-5">
      {/* Cabecera: el avance del proyecto entero, con el mismo criterio que el
          de cada fase (unidades hechas / unidades totales, no la media de los
          porcentajes — ver lib/projects/faseProgreso.js). */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div className="min-w-0">
          <h2 className="font-medium text-neutral-800">Fases del proyecto</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {phases.length === 0
              ? "Sin fases definidas."
              : `${global.fasesCompletadas} de ${phases.length} completadas · ${global.hechas} de ${global.unidades} cosas hechas` +
                (global.vencidas > 0 ? ` · ${global.vencidas} con retraso` : "")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {phases.length > 1 && (
            <Select
              className={inputCls + " w-52"}
              value={orden}
              onChange={setOrden}
              options={ORDENES_FASE.map((o) => ({ value: o.clave, label: o.etiqueta }))}
            />
          )}
          {canEdit && (
            <button
              onClick={() => setCreando((c) => !c)}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {creando ? "Cancelar" : "+ Nueva fase"}
            </button>
          )}
        </div>
      </div>

      {global.unidades > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <Barra porcentaje={global.porcentaje} color="var(--color-primary, #1B3A2D)" alto="h-2.5" />
            <span className="font-display text-[20px] leading-none tabular-nums text-neutral-800 shrink-0">
              {global.porcentaje}%
            </span>
          </div>
        </div>
      )}

      {creando && canEdit && (
        <form onSubmit={crear} className="mb-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
          <input
            className={inputCls + " sm:col-span-2"}
            placeholder="Nombre de la fase"
            value={nueva.name}
            onChange={(e) => setNueva({ ...nueva, name: e.target.value })}
            autoFocus
          />
          <input
            type="color"
            className="w-full h-10 border border-neutral-200"
            value={nueva.color}
            onChange={(e) => setNueva({ ...nueva, color: e.target.value })}
            aria-label="Color de la fase"
          />
          <input type="date" className={inputCls} value={nueva.startDate} onChange={(e) => setNueva({ ...nueva, startDate: e.target.value })} />
          <input type="date" className={inputCls} value={nueva.endDate} onChange={(e) => setNueva({ ...nueva, endDate: e.target.value })} />
          <button
            disabled={guardando || !nueva.name.trim()}
            className="sm:col-span-5 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50"
          >
            {guardando ? "Añadiendo…" : "Añadir fase"}
          </button>
        </form>
      )}

      {phases.length === 0 && huerfanas.totales.unidades === 0 ? (
        <p className="text-sm text-neutral-400">
          Todavía no hay fases. Una fase es un tramo del proyecto con sus tareas y sus entregables
          — «Preparación», «Ejecución», «Cierre».
        </p>
      ) : (
        <ul className="space-y-2">
          {ordenadas.map((r) => (
            <FilaFase
              key={r.id}
              r={r}
              projectId={projectId}
              canEdit={canEdit}
              abierta={abierta === r.id}
              onAbrir={() => setAbierta((a) => (a === r.id ? null : r.id))}
              onChange={onChange}
            />
          ))}
          {huerfanas.totales.unidades > 0 && (
            <FilaFase
              r={huerfanas}
              projectId={projectId}
              canEdit={false}
              abierta={abierta === "sin-fase"}
              onAbrir={() => setAbierta((a) => (a === "sin-fase" ? null : "sin-fase"))}
              onChange={onChange}
            />
          )}
        </ul>
      )}
    </section>
  );
}
