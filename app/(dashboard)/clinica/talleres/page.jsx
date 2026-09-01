"use client";

/**
 * Talleres — actividades de grupo, y dentro de cada una sus GRUPOS.
 *
 * Sale de la migración de Aumenta (02/08/2026): «Habilidades Sociales» venía de
 * Organízate marcada como una ESPECIALIDAD más, y son 4.287 citas. Rodrigo lo
 * corrigió: es un taller.
 *
 * ── LO QUE CAMBIÓ EL 01/09/2026 ─────────────────────────────────────────────
 * «Los talleres no dejan de ser citas múltiples a las que van varios pacientes
 * a la vez y que pueden estar impartidas por varios terapeutas la misma cita.
 * […] No como bloqueos sino como un tipo más de cita. Solo que estos tipos de
 * cita se crean desde la pestaña de talleres», y **«hay que poder poner varios
 * grupos distintos para la misma actividad»**.
 *
 * Así que esta pantalla tiene dos alturas:
 *
 *   · LA ACTIVIDAD (esta tabla) — «Habilidades sociales». Qué es y cómo se
 *     cobra. Cambia una vez al año.
 *   · EL GRUPO (el panel de la derecha) — «Grupo 1, martes a las cinco, lo dan
 *     Ana y Marta, van estos ocho». Es lo que se apunta en la agenda, lo que se
 *     cobra y lo que se registra.
 *
 * Crear un grupo crea su TIPO DE CITA (oculto en la web), y con eso el taller
 * ya se puede elegir en la agenda como uno más.
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import SesionTallerDrawer from "../../../../components/clinica/SesionTallerDrawer.jsx";
import GrupoTallerPanel from "../../../../components/clinica/GrupoTallerPanel.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function nuevoTaller() {
  return { name: "", description: "", notes: "", conceptId: "" };
}

function nuevoGrupo() {
  return { name: "", schedule: "", duration: 90, capacity: "", conceptId: "", color: "", notes: "" };
}

export default function TalleresPage() {
  const [talleres, setTalleres] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [sinMigrar, setSinMigrar] = useState(false);
  const [conceptosCatalogo, setConceptosCatalogo] = useState([]);

  // Alta/edición de la ACTIVIDAD.
  const [form, setForm] = useState(nuevoTaller);
  const [editandoId, setEditandoId] = useState(null);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState(null);

  /*
   * El panel lateral tiene DOS vistas y una sola capa: la lista de grupos de un
   * taller, y la ficha de un grupo. Se navega con «← volver» en vez de apilar
   * dos drawers, que en móvil es ilegible.
   *   `detalle`     → { id, name, … } el taller abierto (null = cerrado)
   *   `grupoAbierto`→ el id del grupo que se está viendo (null = la lista)
   */
  const [detalle, setDetalle] = useState(null);
  const [grupos, setGrupos] = useState([]);
  const [grupoAbierto, setGrupoAbierto] = useState(null);

  // Alta/edición de un GRUPO.
  const [formGrupo, setFormGrupo] = useState(nuevoGrupo);
  const [editandoGrupoId, setEditandoGrupoId] = useState(null);
  const [panelGrupo, setPanelGrupo] = useState(false);
  const [grupoError, setGrupoError] = useState(null);

  const [sesionAbierta, setSesionAbierta] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/talleres${verInactivos ? "?verInactivos=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los talleres");
      setTalleres(j.data?.talleres ?? []);
      setSinMigrar(!!j.data?.sinMigrar);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [verInactivos]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setEquipo(j.data?.members ?? []); })
      .catch(() => {});
    fetch("/api/billing/conceptos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setConceptosCatalogo(j.data?.conceptos ?? []); })
      .catch(() => {});
  }, []);

  const cargarGrupos = useCallback(async (tallerId) => {
    if (!tallerId) return;
    try {
      const r = await fetch(`/api/clinica/talleres/${tallerId}/grupos`, { cache: "no-store" });
      const j = await r.json();
      setGrupos(j?.ok ? (j.data?.grupos ?? []) : []);
    } catch {
      setGrupos([]);
    }
  }, []);

  const abrirDetalle = useCallback(async (t) => {
    setGrupoAbierto(null);
    setGrupos([]);
    setDetalle(t);
    cargarGrupos(t.id);
  }, [cargarGrupos]);

  function abrirTaller(t = null) {
    setEditandoId(t?.id ?? null);
    setForm(t ? {
      name: t.name ?? "", description: t.description ?? "",
      notes: t.notes ?? "", conceptId: t.conceptId ?? "",
    } : nuevoTaller());
    setFormError(null);
    setPanelAbierto(true);
  }

  async function guardar() {
    if (!form.name.trim()) { setFormError("El nombre es obligatorio"); return; }
    setGuardando(true);
    setFormError(null);
    try {
      const r = await fetch(editandoId ? `/api/clinica/talleres/${editandoId}` : "/api/clinica/talleres", {
        method: editandoId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setPanelAbierto(false);
      await cargar();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function retirar(t) {
    if (!confirm(`¿Retirar el taller «${t.name}»?\n\nSi ha pasado gente por él se conserva el histórico y solo deja de aparecer en las listas.`)) return;
    try {
      const r = await fetch(`/api/clinica/talleres/${t.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo retirar");
      await cargar();
    } catch (e) { setErrorMsg(e.message); }
  }

  // ── Grupos ───────────────────────────────────────────────────────────────

  function abrirGrupo(g = null) {
    setEditandoGrupoId(g?.id ?? null);
    setFormGrupo(g ? {
      name: g.name ?? "", schedule: g.schedule ?? "", duration: g.duration ?? 90,
      capacity: g.capacity ?? "", conceptId: g.conceptId ?? "", color: g.color ?? "", notes: g.notes ?? "",
    } : nuevoGrupo());
    setGrupoError(null);
    setPanelGrupo(true);
  }

  async function guardarGrupo() {
    if (!formGrupo.name.trim()) { setGrupoError("El nombre del grupo es obligatorio"); return; }
    setGuardando(true);
    setGrupoError(null);
    try {
      const url = editandoGrupoId
        ? `/api/clinica/talleres/${detalle.id}/grupos/${editandoGrupoId}`
        : `/api/clinica/talleres/${detalle.id}/grupos`;
      const r = await fetch(url, {
        method: editandoGrupoId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formGrupo,
          capacity: formGrupo.capacity === "" ? null : Number(formGrupo.capacity),
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar el grupo");
      setPanelGrupo(false);
      await cargarGrupos(detalle.id);
      await cargar();
    } catch (e) {
      setGrupoError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function retirarGrupo(g) {
    if (!confirm(`¿Retirar el grupo «${g.name}»?\n\nSi ha pasado gente por él o tiene citas, se conserva el histórico y solo deja de aparecer.`)) return;
    try {
      const r = await fetch(`/api/clinica/talleres/${detalle.id}/grupos/${g.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo retirar");
      await cargarGrupos(detalle.id);
      await cargar();
    } catch (e) { setErrorMsg(e.message); }
  }

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800 flex items-center gap-2">
            Talleres
            <HelpTooltip title="Talleres y grupos" placement="bottom">
              El <strong className="text-white">taller</strong> es la actividad («Habilidades sociales»).
              Dentro van los <strong className="text-white">grupos</strong>: cada uno con su horario, quién
              lo imparte y qué pacientes van. Cada grupo se apunta en la agenda como un tipo de cita más,
              y apuntar a un paciente le da de alta su cuota del taller.
            </HelpTooltip>
          </h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Actividades de grupo. No son especialidades: un paciente puede estar en varias, en ninguna, o
            entrar y salir cada curso.
          </p>
        </div>
        <button
          onClick={() => abrirTaller()}
          className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition"
        >
          Nuevo taller
        </button>
      </div>

      {sinMigrar && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Los talleres aún no están disponibles en este centro. Avisa a Salamandra.
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>
      )}

      <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
        <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
        Ver también los retirados
      </label>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Taller</th>
                <th className="text-right font-medium px-3 py-2">Grupos</th>
                <th className="text-right font-medium px-3 py-2">Apuntados</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={4} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && talleres.length === 0 && !sinMigrar && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-neutral-400">
                  Todavía no hay talleres. Crea el primero con «Nuevo taller».
                </td></tr>
              )}
              {!cargando && talleres.map((t) => (
                <tr key={t.id} className={`border-t border-neutral-100 ${t.active ? "" : "bg-neutral-50/60 text-neutral-400"}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => abrirDetalle(t)} className="font-medium text-neutral-800 hover:underline text-left">
                      {t.name}
                    </button>
                    {!t.active && <span className="ml-2 text-[11px] text-neutral-400">(retirado)</span>}
                    {t.description && <div className="text-[11.5px] text-neutral-400 mt-0.5">{t.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{t.grupos ?? 0}</td>
                  <td className="px-3 py-2 text-right font-medium">{t.apuntados}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => abrirDetalle(t)} className="text-neutral-500 hover:text-neutral-800 px-2">Grupos</button>
                    <button onClick={() => abrirTaller(t)} className="text-neutral-500 hover:text-neutral-800 px-2">Editar</button>
                    {t.active && (
                      <button onClick={() => retirar(t)} className="text-neutral-400 hover:text-red-600 px-2">Retirar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── El panel: grupos del taller, o la ficha de un grupo ───────────── */}
      {detalle && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetalle(null)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-lg bg-white z-50 shadow-xl overflow-y-auto p-5">
            <button
              onClick={() => setDetalle(null)}
              className="float-right text-neutral-400 hover:text-neutral-700 text-[12.5px]"
            >
              Cerrar
            </button>

            {grupoAbierto ? (
              <GrupoTallerPanel
                tallerId={detalle.id}
                grupoId={grupoAbierto}
                equipo={equipo}
                onVolver={() => { setGrupoAbierto(null); cargarGrupos(detalle.id); }}
                onCambio={() => { cargarGrupos(detalle.id); cargar(); }}
                onRegistrar={(s) => setSesionAbierta({ ...s, grupoId: grupoAbierto })}
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-neutral-800">{detalle.name}</h2>
                  {detalle.concepto && (
                    <p className="text-[12px] mt-1 text-emerald-700">
                      Se cobra con: {detalle.concepto.name} —{" "}
                      {Number(detalle.concepto.unitPrice).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €
                      {detalle.concepto.periodicity ? ` /${detalle.concepto.periodicity}` : ""}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[12px] uppercase tracking-wide text-neutral-400">
                    Grupos ({grupos.length})
                  </h3>
                  {detalle.active && (
                    <button
                      onClick={() => abrirGrupo()}
                      className="text-[12px] px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    >
                      Nuevo grupo
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-neutral-200 overflow-hidden">
                  {grupos.length === 0 && (
                    <p className="px-3 py-6 text-center text-[12.5px] text-neutral-400">
                      Este taller todavía no tiene grupos. Crea el primero: es lo que se apunta en la agenda.
                    </p>
                  )}
                  {grupos.map((g) => (
                    <div key={g.id} className={`px-3 py-2 border-b border-neutral-100 last:border-0 ${g.active ? "" : "bg-neutral-50/60"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => setGrupoAbierto(g.id)}
                          className="text-left flex-1 min-w-0"
                        >
                          <span className="text-[12.5px] font-medium text-neutral-800 hover:underline">
                            {g.name}
                          </span>
                          {!g.active && <span className="ml-2 text-[11px] text-neutral-400">(retirado)</span>}
                          <div className="text-[11.5px] text-neutral-400 truncate">
                            {g.schedule || "Sin horario"} · {g.duration} min ·{" "}
                            {g.terapeutas.length
                              ? g.terapeutas.map((t) => t.displayName).filter(Boolean).join(", ")
                              : "sin terapeuta"}
                          </div>
                        </button>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[12px] text-neutral-600">
                            {g.apuntados}
                            {g.capacity ? `/${g.capacity}` : ""}
                          </span>
                          <button onClick={() => abrirGrupo(g)} className="text-[12px] text-neutral-400 hover:text-neutral-800">
                            Editar
                          </button>
                          {g.active && (
                            <button onClick={() => retirarGrupo(g)} className="text-[12px] text-neutral-400 hover:text-red-600">
                              Retirar
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Alta y edición de la ACTIVIDAD ────────────────────────────────── */}
      {panelAbierto && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setPanelAbierto(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-800">
                {editandoId ? "Editar taller" : "Nuevo taller"}
              </h2>
              <button onClick={() => setPanelAbierto(false)} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>
            )}

            <label className="block">
              <span className="text-[12px] text-neutral-500">Nombre *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Habilidades sociales" autoFocus />
            </label>
            <label className="block">
              <span className="text-[12px] text-neutral-500">Descripción</span>
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[12px] text-neutral-500">Notas</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
            </label>
            {conceptosCatalogo.length > 0 && (
              <label className="block">
                <span className="text-[12px] text-neutral-500">Concepto de cobro (del catálogo)</span>
                <select value={form.conceptId} onChange={(e) => setForm({ ...form, conceptId: e.target.value })} className={inputCls}>
                  <option value="">— Sin concepto: no se cobra desde aquí —</option>
                  {conceptosCatalogo.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {Number(c.unitPrice).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €{c.periodicity ? ` /${c.periodicity}` : ""}
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] text-neutral-400 mt-1">
                  Es el que se le da de alta a la familia al apuntar a un paciente. Un grupo puede llevar otro distinto.
                </span>
              </label>
            )}

            <button
              onClick={guardar}
              disabled={guardando}
              className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
            >
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear taller"}
            </button>
          </div>
        </>
      )}

      {/* ── Alta y edición de un GRUPO ────────────────────────────────────── */}
      {panelGrupo && detalle && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setPanelGrupo(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-800">
                {editandoGrupoId ? "Editar grupo" : "Nuevo grupo"}
              </h2>
              <button onClick={() => setPanelGrupo(false)} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
            </div>

            {grupoError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{grupoError}</div>
            )}

            <label className="block">
              <span className="text-[12px] text-neutral-500">Nombre del grupo *</span>
              <input value={formGrupo.name} onChange={(e) => setFormGrupo({ ...formGrupo, name: e.target.value })} className={inputCls} placeholder="Grupo 1" autoFocus />
              <span className="block text-[11px] text-neutral-400 mt-1">
                En la agenda saldrá como «{detalle.name} · {formGrupo.name || "Grupo 1"}».
              </span>
            </label>
            <label className="block">
              <span className="text-[12px] text-neutral-500">Cuándo</span>
              <input value={formGrupo.schedule} onChange={(e) => setFormGrupo({ ...formGrupo, schedule: e.target.value })} className={inputCls} placeholder="Martes 17:00" />
              <span className="block text-[11px] text-neutral-400 mt-1">
                Texto libre, para verlo de un vistazo. No reserva horas: las horas son las citas que se apuntan en la agenda.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[12px] text-neutral-500">Duración (min)</span>
                <input type="number" min={1} max={480} value={formGrupo.duration} onChange={(e) => setFormGrupo({ ...formGrupo, duration: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Plazas</span>
                <input type="number" min={1} value={formGrupo.capacity} onChange={(e) => setFormGrupo({ ...formGrupo, capacity: e.target.value })} className={inputCls} placeholder="Sin tope" />
              </label>
            </div>
            {conceptosCatalogo.length > 0 && (
              <label className="block">
                <span className="text-[12px] text-neutral-500">Concepto de cobro propio</span>
                <select value={formGrupo.conceptId} onChange={(e) => setFormGrupo({ ...formGrupo, conceptId: e.target.value })} className={inputCls}>
                  <option value="">— El del taller —</option>
                  {conceptosCatalogo.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {Number(c.unitPrice).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €{c.periodicity ? ` /${c.periodicity}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-[12px] text-neutral-500">Notas</span>
              <textarea rows={2} value={formGrupo.notes} onChange={(e) => setFormGrupo({ ...formGrupo, notes: e.target.value })} className={inputCls} />
            </label>

            <button
              onClick={guardarGrupo}
              disabled={guardando}
              className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
            >
              {guardando ? "Guardando…" : editandoGrupoId ? "Guardar cambios" : "Crear grupo"}
            </button>
            {!editandoGrupoId && (
              <p className="text-[11px] text-neutral-400">
                Al crearlo se dará de alta su tipo de cita, para poder apuntarlo en la agenda. Quién lo imparte
                y quién va se marcan después, en la ficha del grupo.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Registro de una sesión del grupo ──────────────────────────────── */}
      {sesionAbierta && detalle && (
        <SesionTallerDrawer
          key={sesionAbierta.id ?? "nueva"}
          tallerId={detalle.id}
          tallerName={detalle.name}
          grupoId={sesionAbierta.grupoId ?? null}
          sesionId={sesionAbierta.id}
          onClose={() => setSesionAbierta(null)}
          onSaved={() => {
            setSesionAbierta(null);
            if (grupoAbierto) setGrupoAbierto(grupoAbierto);
            cargarGrupos(detalle.id);
          }}
        />
      )}
    </div>
  );
}
