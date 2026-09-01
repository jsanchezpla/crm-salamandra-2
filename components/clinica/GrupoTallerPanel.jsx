"use client";

/**
 * GrupoTallerPanel — la ficha de UN grupo de taller (01/09/2026, Aumenta por
 * Rodrigo).
 *
 * Es donde se hace lo que pidió: «en la propia pestaña de talleres se marca
 * quién o quiénes imparten y qué pacientes van». Tres bloques y en ese orden,
 * que es el del trabajo real:
 *
 *   1. Quién lo da — varios, con uno que coordina (de él sale el color de la
 *      caja en la agenda y quién figura como dueño de la cita).
 *   2. Quién va — y si está pagando. Apuntar a un niño le da de alta su cuota
 *      del taller, y la lista lo dice fila a fila: sin eso, «se complementan la
 *      zona de pago y las citas» sería una promesa que nadie puede comprobar.
 *   3. Qué se ha hecho — las sesiones registradas del grupo.
 *
 * El panel NO crea citas: eso se hace en la agenda, eligiendo el tipo de cita
 * del grupo. Aquí solo se dice con qué nombre sale allí.
 */

import { useCallback, useEffect, useState } from "react";
import SelectorPaciente from "../citas/SelectorPaciente.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const fmtFecha = (f) => (f ? new Date(f).toLocaleDateString("es-ES") : "—");
const nombreDe = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "—";
const euros = (n) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2 });

export default function GrupoTallerPanel({ tallerId, grupoId, equipo = [], onVolver, onCambio, onRegistrar }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [aApuntar, setAApuntar] = useState("");
  const [guardandoEquipo, setGuardandoEquipo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/talleres/${tallerId}/grupos/${grupoId}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el grupo");
      setDatos(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [tallerId, grupoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const grupo = datos?.grupo ?? null;
  const marcados = new Set((grupo?.terapeutas ?? []).map((t) => t.teamMemberId));

  /**
   * Guarda la lista entera de quien imparte. Es un reemplazo, no un añadido:
   * la pantalla manda quién está, y quitar a alguien es no mandarlo.
   */
  async function guardarEquipo(ids, coordinaId) {
    setGuardandoEquipo(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/talleres/${tallerId}/grupos/${grupoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terapeutas: ids, coordinaId }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      await cargar();
      onCambio?.();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setGuardandoEquipo(false);
    }
  }

  function alternarTerapeuta(memberId) {
    const ids = marcados.has(memberId)
      ? [...marcados].filter((x) => x !== memberId)
      : [...marcados, memberId];
    // Si se quita a quien coordinaba, coordina el primero que quede.
    const coordina = ids.includes(grupo?.coordinaId) ? grupo.coordinaId : ids[0] ?? null;
    guardarEquipo(ids, coordina);
  }

  async function apuntar() {
    if (!aApuntar) return;
    setErrorMsg(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/clinica/talleres/${tallerId}/inscripciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: aApuntar, grupoId }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo apuntar");
      // Si no se le pudo crear la cuota, se dice: callarlo dejaría a un niño
      // apuntado y sin cobrar sin que nadie se enterase.
      if (j.data?.cuota?.motivo) setAviso(j.data.cuota.motivo);
      setAApuntar("");
      await cargar();
      onCambio?.();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  async function darDeBaja(inscripcionId, nombre) {
    if (!confirm(`¿Dar de baja a ${nombre} de este grupo?\n\nSe conserva su historial y se cierra su cuota del taller.`)) return;
    setErrorMsg(null);
    setAviso(null);
    try {
      const r = await fetch(
        `/api/clinica/talleres/${tallerId}/inscripciones?inscripcionId=${inscripcionId}`,
        { method: "DELETE" }
      );
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo dar de baja");
      if (j.data?.cuota?.motivo) setAviso(j.data.cuota.motivo);
      await cargar();
      onCambio?.();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  const lleno = grupo?.capacity && (datos?.apuntados?.length ?? 0) >= grupo.capacity;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={onVolver} className="text-[12px] text-neutral-400 hover:text-neutral-700">
            ← Grupos de {datos?.taller?.name ?? "este taller"}
          </button>
          <h2 className="text-base font-semibold text-neutral-800 mt-1">{grupo?.name ?? "…"}</h2>
          <p className="text-[12px] text-neutral-500 mt-0.5">
            {grupo?.schedule || "Sin horario indicado"}
            {grupo?.duration ? ` · ${grupo.duration} min` : ""}
            {grupo?.capacity ? ` · hasta ${grupo.capacity}` : ""}
            {grupo && !grupo.active ? " · retirado" : ""}
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>
      )}
      {aviso && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">{aviso}</div>
      )}
      {cargando && <p className="text-[12.5px] text-neutral-400">Cargando…</p>}

      {/* ── Cómo sale en la agenda ─────────────────────────────────────────
          El grupo tiene su propio tipo de cita, que es lo que hace que se pueda
          elegir en la agenda como uno más. Se enseña para que quien apunte la
          cita sepa qué buscar en el desplegable. */}
      {grupo?.tipoCita && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-800">
          En la agenda, este grupo se apunta eligiendo el tipo de cita{" "}
          <strong>«{grupo.tipoCita.name}»</strong>. La cita sale con todos los apuntados dentro.
        </div>
      )}

      {datos?.concepto && (
        <div className="rounded-lg border border-neutral-200 px-3 py-2 text-[12px] text-neutral-600">
          Al apuntar a un paciente se le da de alta la cuota{" "}
          <strong>{datos.concepto.name}</strong> — {euros(datos.concepto.unitPrice)} €
          {datos.concepto.periodicity ? ` /${datos.concepto.periodicity}` : ""}.
        </div>
      )}

      {/* ── 1. Quién lo imparte ──────────────────────────────────────────── */}
      <div>
        <h3 className="text-[12px] uppercase tracking-wide text-neutral-400 mb-2">
          Quién lo imparte ({grupo?.terapeutas?.length ?? 0})
        </h3>
        <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-100 max-h-56 overflow-y-auto">
          {equipo.length === 0 && (
            <p className="px-3 py-4 text-center text-[12.5px] text-neutral-400">No hay equipo dado de alta.</p>
          )}
          {equipo.map((m) => {
            const puesto = marcados.has(m.id);
            const coordina = grupo?.coordinaId === m.id;
            return (
              <div key={m.id} className="flex items-center justify-between px-3 py-2">
                <label className="flex items-center gap-2 text-[12.5px] text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={puesto}
                    disabled={guardandoEquipo}
                    onChange={() => alternarTerapeuta(m.id)}
                  />
                  {m.displayName}
                </label>
                {puesto && (
                  <button
                    onClick={() => guardarEquipo([...marcados], m.id)}
                    disabled={guardandoEquipo || coordina}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                      coordina
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-neutral-200 text-neutral-400 hover:text-neutral-700"
                    }`}
                    title="Quien coordina figura como responsable de la cita en la agenda"
                  >
                    {coordina ? "Coordina" : "Que coordine"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. Quién va, y si está pagando ───────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-[12px] uppercase tracking-wide text-neutral-400">
            Apuntados ({datos?.apuntados?.length ?? 0})
          </h3>
          {lleno && <span className="text-[11px] text-amber-700">Grupo completo</span>}
        </div>

        {grupo?.active && (
          <div className="flex gap-2 mb-2">
            <SelectorPaciente
              value={aApuntar}
              onChange={(v) => setAApuntar(v)}
              placeholder="— Apuntar a un paciente —"
              className="flex-1"
            />
            <button
              onClick={apuntar}
              disabled={!aApuntar}
              className="shrink-0 px-4 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
            >
              Apuntar
            </button>
          </div>
        )}

        <div className="rounded-lg border border-neutral-200 overflow-hidden">
          {(datos?.apuntados ?? []).length === 0 && !cargando && (
            <p className="px-3 py-4 text-center text-[12.5px] text-neutral-400">Nadie apuntado todavía.</p>
          )}
          {(datos?.apuntados ?? []).map((i) => (
            <div key={i.id} className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 last:border-0">
              <span className="text-[12.5px] text-neutral-800">{nombreDe(i.patient)}</span>
              <span className="flex items-center gap-3 shrink-0">
                {i.cuota?.active ? (
                  <span className="text-[11px] text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">Con cuota</span>
                ) : (
                  <span className="text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">Sin cuota</span>
                )}
                <span className="text-[11.5px] text-neutral-400">desde {fmtFecha(i.joinedAt)}</span>
                <button
                  onClick={() => darDeBaja(i.id, nombreDe(i.patient))}
                  className="text-[12px] text-neutral-400 hover:text-red-600"
                >
                  Dar de baja
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Lo que se ha hecho ────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-[12px] uppercase tracking-wide text-neutral-400">
            Sesiones ({datos?.sesiones?.length ?? 0})
          </h3>
          <button
            onClick={() => onRegistrar?.({ id: null })}
            className="text-[12px] px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          >
            Registrar sesión
          </button>
        </div>
        <div className="rounded-lg border border-neutral-200 overflow-hidden">
          {(datos?.sesiones ?? []).length === 0 && (
            <p className="px-3 py-4 text-center text-[12.5px] text-neutral-400">
              Todavía no hay ninguna sesión registrada de este grupo.
            </p>
          )}
          {(datos?.sesiones ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => onRegistrar?.({ id: s.id })}
              className="w-full text-left flex items-center justify-between px-3 py-2 border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition"
            >
              <span className="text-[12.5px] text-neutral-800">
                {fmtFecha(s.sessionDate)}
                {s.teamMemberName ? <span className="text-neutral-400"> · {s.teamMemberName}</span> : null}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {s.bookingId && <span className="text-[11px] text-neutral-400">desde la agenda</span>}
                {s.status === "published" && (
                  <span className="text-[11px] text-neutral-500 bg-neutral-100 rounded px-1.5 py-0.5">Cerrada</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {(datos?.pasaron ?? []).length > 0 && (
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-neutral-400 mb-2">
            Pasaron por él ({datos.pasaron.length})
          </h3>
          <div className="rounded-lg border border-neutral-200 overflow-hidden">
            {datos.pasaron.map((i) => (
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
  );
}
