"use client";

/**
 * PanelTallerCita — la lista de asistencia de una cita que es un TALLER
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * Se monta dentro del modal de la cita, y es lo que sustituye a todo lo que en
 * una cita normal va de UNA persona: aquí van varios, con quién lo imparte
 * arriba y la lista de quién ha venido debajo.
 *
 * ── PASAR LISTA ES LO PRINCIPAL ─────────────────────────────────────────────
 * Tres botones por niño, con el mismo vocabulario que una cita individual:
 * vino / faltó justificada / faltó sin justificar. No es un adorno: la falta
 * abre incidencia igual que las demás, y el registro de la sesión se le copia
 * SOLO a quien vino. Marcar aquí es lo que hace que las tres cosas —agenda,
 * cobro y registro— digan lo mismo.
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────────
 * Apuntar o dar de baja a nadie del grupo. Eso es del grupo, no de una tarde
 * suya, y se hace en Clínica → Talleres. Aquí solo se dice quién vino de los
 * que estaban. Para meter en esta cita a alguien apuntado DESPUÉS de crearla
 * está «Traer a los nuevos», que solo añade.
 */

import { useCallback, useEffect, useState } from "react";

const BOTONES = [
  { valor: "asistio", justified: null, texto: "Vino", clase: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { valor: "no_show", justified: true, texto: "Justificada", clase: "border-amber-300 bg-amber-50 text-amber-700" },
  { valor: "no_show", justified: false, texto: "Sin justificar", clase: "border-red-300 bg-red-50 text-red-700" },
];

function estaPuesto(a, b) {
  if (b.valor === "asistio") return a.status === "asistio";
  return a.status === "no_show" && a.justified === b.justified;
}

export default function PanelTallerCita({ bookingId, onRegistrar }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/citas/bookings/${bookingId}/taller`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el taller");
      setDatos(j.data);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setCargando(false);
    }
  }, [bookingId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function marcar(asistencia, boton) {
    setOcupado(asistencia.id);
    setErr(null);
    try {
      const r = await fetch(`/api/citas/bookings/${bookingId}/taller`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asistenciaId: asistencia.id,
          status: boton.valor,
          justified: boton.justified,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo marcar");
      setDatos(j.data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setOcupado(null);
    }
  }

  async function traerNuevos() {
    setOcupado("sync");
    setErr(null);
    try {
      const r = await fetch(`/api/citas/bookings/${bookingId}/taller`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sincronizar: true }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo actualizar la lista");
      setDatos(j.data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setOcupado(null);
    }
  }

  if (cargando) return <p className="text-xs text-neutral-400">Cargando el taller…</p>;
  if (err && !datos) {
    return <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{err}</div>;
  }
  if (!datos) return null;

  const vinieron = datos.asistentes.filter((a) => a.status === "asistio").length;
  const faltaron = datos.asistentes.filter((a) => a.status === "no_show").length;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
        <div className="text-[13px] font-medium text-neutral-800">
          {datos.grupo?.tallerName ? `${datos.grupo.tallerName} · ` : ""}
          {datos.grupo?.name ?? "Taller"}
        </div>
        <div className="text-[11.5px] text-neutral-500 mt-0.5">
          {datos.impartidores.length
            ? `Lo imparten: ${datos.impartidores.map((i) => i.displayName).filter(Boolean).join(", ")}`
            : "Sin terapeuta asignado"}
        </div>
      </div>

      {err && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{err}</div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] uppercase tracking-wide text-neutral-400">
            Asistencia ({vinieron} de {datos.asistentes.length}
            {faltaron > 0 ? `, ${faltaron} sin venir` : ""})
          </span>
          <button
            onClick={traerNuevos}
            disabled={ocupado === "sync"}
            className="text-[11px] text-neutral-400 hover:text-neutral-700 disabled:opacity-50"
            title="Añade a los que se hayan apuntado al grupo después de crear esta cita"
          >
            Traer a los nuevos
          </button>
        </div>

        <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-100 max-h-64 overflow-y-auto">
          {datos.asistentes.length === 0 && (
            <p className="px-3 py-4 text-center text-[12.5px] text-neutral-400">
              Este taller no tiene a nadie apuntado. Se apunta en Clínica → Talleres.
            </p>
          )}
          {datos.asistentes.map((a) => (
            <div key={a.id} className="px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[12.5px] text-neutral-800 truncate">{a.nombre}</span>
              <span className="flex gap-1 shrink-0">
                {BOTONES.map((b) => {
                  const puesto = estaPuesto(a, b);
                  return (
                    <button
                      key={b.texto}
                      onClick={() => marcar(a, b)}
                      disabled={ocupado === a.id}
                      className={`text-[11px] px-2 py-0.5 rounded-md border transition disabled:opacity-50 ${
                        puesto ? b.clase : "border-neutral-200 text-neutral-400 hover:text-neutral-700"
                      }`}
                    >
                      {b.texto}
                    </button>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => onRegistrar?.(datos)}
        className="w-full text-[12.5px] px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
      >
        {datos.sesion ? "Ver el registro de esta sesión" : "Registrar la sesión del grupo"}
      </button>
      <p className="text-[10.5px] text-neutral-400">
        El registro se escribe una vez y sale igual en la ficha de todos los que vinieron; cada uno lleva
        además su nota privada.
      </p>
    </div>
  );
}
