"use client";

/**
 * components/citas/CitasDelPaciente.jsx — las citas de un paciente, y CÓMO
 * ACABÓ cada una (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Quiero poder ver el resultado de completado o las faltas, o cancelar la
 * cita, dentro de cada paciente en sus citas.»
 *
 * ── QUÉ HABÍA ANTES ─────────────────────────────────────────────────────────
 * La ficha del paciente listaba sus citas con una etiqueta gris —«Realizada»,
 * «No asistió»— y nada más. Para marcar una falta había que ir a la Agenda,
 * buscar el día, encontrar la cita y abrirla. Quien está mirando la ficha de un
 * niño, con sus sesiones delante, es exactamente quien sabe si vino o no.
 *
 * Los cuatro resultados y lo que se le manda al servidor NO se deciden aquí:
 * vienen de `lib/citas/resultadoCita.js`, que es lo mismo que usa la ficha de
 * la cita en la Agenda. Si esto tuviera su propio `fetch`, en un mes una
 * pantalla mandaría `noShowJustified` y la otra no.
 *
 * Las citas que aún no han empezado no enseñan botones (`admiteResultado`):
 * marcar como falta una cita de la semana que viene no es un caso de uso.
 */

import { useState } from "react";
import { useDialogo } from "../ui/Dialogo.jsx";
import {
  RESULTADOS_CITA,
  admiteResultado,
  cuerpoDelResultado,
  etiquetaResultado,
  resultadoDeCita,
  resultadoPorClave,
} from "../../lib/citas/resultadoCita.js";

const TONO_CHIP = {
  completada: "bg-emerald-50 text-emerald-700",
  falta_justificada: "bg-violet-50 text-violet-700",
  falta_injustificada: "bg-rose-50 text-rose-700",
  cancelada: "bg-neutral-100 text-neutral-500",
};
const TONO_BOTON = {
  bien: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
  aviso: "border-violet-200 text-violet-700 hover:bg-violet-50",
  peligro: "border-rose-200 text-rose-700 hover:bg-rose-50",
};

export default function CitasDelPaciente({ citas = [], onActualizada, vacio = "Sin citas registradas para este paciente." }) {
  const [abierta, setAbierta] = useState(null); // id de la cita con los botones desplegados
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState(null);
  const { pedirTexto, dialogo } = useDialogo();

  async function poner(cita, clave) {
    const resultado = resultadoPorClave(clave);
    let motivo = null;
    if (resultado.motivo) {
      motivo = await pedirTexto({
        ...resultado.motivo,
        tono: resultado.tono === "peligro" ? "peligro" : "normal",
      });
      if (motivo === null) return; // se echó atrás
    }
    setGuardando(cita.id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${cita.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoDelResultado(clave, motivo)),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setAbierta(null);
      onActualizada?.(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(null);
    }
  }

  if (!citas.length) return <p className="text-[11px] text-neutral-400">{vacio}</p>;

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5">{error}</p>
      )}
      {[...citas]
        .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
        .map((c) => {
          const d = new Date(c.scheduledAt);
          const pasada = d < new Date();
          const clave = resultadoDeCita(c);
          const editable = admiteResultado(c);
          return (
            <div key={c.id} className={pasada ? "opacity-80" : ""}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-800 truncate">{c.eventType?.name || "Cita"}</div>
                  <div className="text-[11px] text-neutral-500">
                    {d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                    {" · "}
                    {d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    {c.teamMember?.displayName ? ` · ${c.teamMember.displayName}` : ""}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TONO_CHIP[clave] ?? "bg-neutral-100 text-neutral-600"}`}>
                    {etiquetaResultado(c)}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setAbierta((v) => (v === c.id ? null : c.id))}
                      className="text-[10px] text-neutral-400 hover:text-neutral-700 transition-colors"
                    >
                      {abierta === c.id ? "Cerrar" : "Cambiar"}
                    </button>
                  )}
                </div>
              </div>
              {abierta === c.id && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {RESULTADOS_CITA.map((r) => (
                    <button
                      key={r.clave}
                      type="button"
                      title={r.ayuda}
                      disabled={guardando === c.id || clave === r.clave}
                      onClick={() => poner(c, r.clave)}
                      className={`text-[11px] px-2.5 py-1 rounded-md border bg-white transition-colors disabled:opacity-40 ${TONO_BOTON[r.tono]}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      {dialogo}
    </div>
  );
}
