"use client";

/**
 * Talleres — actividades de grupo a las que se apunta quien quiere.
 *
 * Sale de la migración de Aumenta (02/08/2026): «Habilidades Sociales» venía de
 * Organízate marcada como una ESPECIALIDAD más, y son 4.287 citas. Rodrigo lo
 * corrigió: es un taller. Un taller se da de alta, se retira y la gente entra y
 * sale de él; una especialidad no.
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const nombreDe = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "—";
const fmtFecha = (f) => (f ? new Date(f).toLocaleDateString("es-ES") : "—");

function nuevoTaller() {
  return { name: "", description: "", schedule: "", teamMemberId: "", notes: "" };
}

export default function TalleresPage() {
  const [talleres, setTalleres] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [sinMigrar, setSinMigrar] = useState(false);

  const [form, setForm] = useState(nuevoTaller);
  const [editandoId, setEditandoId] = useState(null);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState(null);

  const [detalle, setDetalle] = useState(null);
  const [aApuntar, setAApuntar] = useState("");

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
    fetch("/api/pacientes?limit=500", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setPacientes(j.data?.patients ?? j.data?.pacientes ?? []); })
      .catch(() => {});
  }, []);

  const abrirDetalle = useCallback(async (t) => {
    setAApuntar("");
    try {
      const r = await fetch(`/api/clinica/talleres/${t.id}`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setDetalle(j.data);
    } catch { /* si falla, no se abre */ }
  }, []);

  function abrirTaller(t = null) {
    setEditandoId(t?.id ?? null);
    setForm(t ? {
      name: t.name ?? "", description: t.description ?? "", schedule: t.schedule ?? "",
      teamMemberId: t.teamMemberId ?? "", notes: t.notes ?? "",
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

  async function apuntar() {
    if (!aApuntar || !detalle) return;
    try {
      const r = await fetch(`/api/clinica/talleres/${detalle.id}/inscripciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: aApuntar }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo apuntar");
      setAApuntar("");
      await abrirDetalle(detalle);
      await cargar();
    } catch (e) { setErrorMsg(e.message); }
  }

  async function darDeBaja(inscripcionId) {
    if (!detalle) return;
    try {
      const r = await fetch(`/api/clinica/talleres/${detalle.id}/inscripciones?inscripcionId=${inscripcionId}`, { method: "DELETE" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo dar de baja");
      await abrirDetalle(detalle);
      await cargar();
    } catch (e) { setErrorMsg(e.message); }
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

  // Los que ya están apuntados no deben salir en el desplegable de apuntar.
  const yaApuntados = new Set((detalle?.apuntados ?? []).map((i) => i.patientId));

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800 flex items-center gap-2">
            Talleres
            <HelpTooltip title="Retirar un taller" placement="bottom">
              Es para el taller que ya no se da: sale de la lista y deja de admitir gente. Si
              nunca se apuntó nadie, se borra; si pasó gente, se conserva su historial y lo sigues
              viendo con «Ver también los retirados».{" "}
              <strong className="text-white">No se puede volver a activar</strong> y su nombre se
              queda ocupado.
            </HelpTooltip>
          </h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Actividades de grupo a las que se apunta quien quiere. No son especialidades:
            un paciente puede estar en varios, en ninguno, o entrar y salir cada curso.
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
                <th className="text-left font-medium px-3 py-2">Cuándo</th>
                <th className="text-left font-medium px-3 py-2">Lo lleva</th>
                <th className="text-right font-medium px-3 py-2">Apuntados</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && talleres.length === 0 && !sinMigrar && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-400">
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
                  <td className="px-3 py-2 text-neutral-500">{t.schedule || "—"}</td>
                  <td className="px-3 py-2 text-neutral-500">{t.responsable?.name || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{t.apuntados}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
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

      {/* ── Ficha del taller: quién está y quién estuvo ───────────────────── */}
      {detalle && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetalle(null)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-lg bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-neutral-800">{detalle.name}</h2>
                <p className="text-[12px] text-neutral-500 mt-0.5">
                  {detalle.schedule || "Sin horario indicado"}
                  {detalle.responsable?.name ? ` · ${detalle.responsable.name}` : ""}
                </p>
              </div>
              <button onClick={() => setDetalle(null)} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
            </div>

            {detalle.active && (
              <div className="flex gap-2">
                <select value={aApuntar} onChange={(e) => setAApuntar(e.target.value)} className={inputCls}>
                  <option value="">— Apuntar a un paciente —</option>
                  {pacientes.filter((p) => !yaApuntados.has(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{nombreDe(p)}</option>
                  ))}
                </select>
                <button
                  onClick={apuntar}
                  disabled={!aApuntar}
                  className="shrink-0 px-4 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
                >
                  Apuntar
                </button>
              </div>
            )}

            <div>
              <h3 className="text-[12px] uppercase tracking-wide text-neutral-400 mb-2">
                Apuntados ahora ({detalle.apuntados?.length ?? 0})
              </h3>
              <div className="rounded-lg border border-neutral-200 overflow-hidden">
                {(detalle.apuntados ?? []).length === 0 && (
                  <p className="px-3 py-4 text-center text-[12.5px] text-neutral-400">Nadie apuntado todavía.</p>
                )}
                {(detalle.apuntados ?? []).map((i) => (
                  <div key={i.id} className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 last:border-0">
                    <span className="text-[12.5px] text-neutral-800">{nombreDe(i.patient)}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-[11.5px] text-neutral-400">desde {fmtFecha(i.joinedAt)}</span>
                      <button onClick={() => darDeBaja(i.id)} className="text-[12px] text-neutral-400 hover:text-red-600">
                        Dar de baja
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {(detalle.pasaron ?? []).length > 0 && (
              <div>
                <h3 className="text-[12px] uppercase tracking-wide text-neutral-400 mb-2">
                  Pasaron por él ({detalle.pasaron.length})
                </h3>
                <div className="rounded-lg border border-neutral-200 overflow-hidden">
                  {detalle.pasaron.map((i) => (
                    <div key={i.id} className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 last:border-0 text-neutral-500">
                      <span className="text-[12.5px]">{nombreDe(i.patient)}</span>
                      <span className="text-[11.5px] text-neutral-400">
                        {fmtFecha(i.joinedAt)} → {fmtFecha(i.leftAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Alta y edición ────────────────────────────────────────────────── */}
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
              <span className="text-[12px] text-neutral-500">Cuándo</span>
              <input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} className={inputCls} placeholder="Martes 17:00" />
              <span className="block text-[11px] text-neutral-400 mt-1">
                Texto libre, para que se vea de un vistazo. No reserva horas en la agenda.
              </span>
            </label>
            <label className="block">
              <span className="text-[12px] text-neutral-500">Lo lleva</span>
              <select value={form.teamMemberId} onChange={(e) => setForm({ ...form, teamMemberId: e.target.value })} className={inputCls}>
                <option value="">— Sin asignar —</option>
                {equipo.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-neutral-500">Notas</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
            </label>

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
    </div>
  );
}
