"use client";

/**
 * SesionTallerDrawer — donde se escribe el registro de una sesión de TALLER
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * «A todos les saldrá el registro en sus sesiones como parte del taller y que
 * se pueda poner un apartado para cada paciente y que solo le salga a él. Es
 * decir, el registro general el mismo a todos menos el apartado extra privado
 * para cada paciente.»
 *
 * Por eso el formulario está partido en dos zonas que se leen distinto:
 *
 *   1. **El registro del grupo** — se escribe UNA vez, con los mismos apartados
 *      que un registro de sesión normal (`ApartadosEditor`, la plantilla del
 *      centro). Es lo que va a acabar igual en la ficha de los ocho.
 *   2. **Cada paciente** — su casilla de asistencia y SU nota, que no ve nadie
 *      más. La zona lo dice con todas las letras, porque es la única parte del
 *      CRM donde ocho familias comparten un documento y la confusión se paga
 *      cara.
 *
 * Lo que se guarda aquí lo reparte el servidor (`lib/clinica/propagarTaller.js`):
 * esta pantalla no sabe —ni tiene que saber— cómo se copia a cada ficha.
 */

import { useCallback, useEffect, useState } from "react";
import ApartadosEditor from "./ApartadosEditor.jsx";
import {
  PLANTILLA_BASE,
  aFormulario,
  apartadosConPlantillas,
  desdeFormulario,
} from "@/lib/clinica/plantillas.js";
import { ETIQUETA_NOTA_POR_DEFECTO } from "@/lib/clinica/tallerSesion.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

/** "2026-09-01T17:00:00Z" → "2026-09-01" y "19:00" en hora de Madrid. */
function partirEnMadrid(valor) {
  const d = valor ? new Date(valor) : new Date();
  if (Number.isNaN(d.getTime())) return { fecha: "", hora: "" };
  const p = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

export default function SesionTallerDrawer({ tallerId, tallerName, sesionId, onClose, onSaved }) {
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);

  const [plantillas, setPlantillas] = useState([PLANTILLA_BASE.registro]);
  const [apartados, setApartados] = useState([]);
  const [valores, setValores] = useState({});
  const [etiquetaNota, setEtiquetaNota] = useState(ETIQUETA_NOTA_POR_DEFECTO);

  const hoy = partirEnMadrid(null);
  const [fecha, setFecha] = useState(hoy.fecha);
  const [hora, setHora] = useState(hoy.hora);
  const [duracion, setDuracion] = useState("");
  const [internas, setInternas] = useState("");
  const [cerrada, setCerrada] = useState(false);
  /** [{ patientId, nombre, asistio, nota, enviada, yaNoApuntado }] */
  const [asistentes, setAsistentes] = useState([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      // Las plantillas del centro: son las que deciden con qué apartados se
      // escribe, igual que en un registro de sesión normal.
      const rp = await fetch("/api/clinica/plantillas", { cache: "no-store" });
      const jp = await rp.json();
      const lista = jp?.ok && Array.isArray(jp.data?.registro) && jp.data.registro.length
        ? jp.data.registro
        : [PLANTILLA_BASE.registro];
      setPlantillas(lista);

      if (sesionId) {
        const r = await fetch(`/api/clinica/taller-sesiones/${sesionId}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "No se ha podido abrir la sesión");
        const d = j.data;
        const aps = apartadosConPlantillas(d.contentSections, lista);
        setApartados(aps);
        setValores(aFormulario(d.contentSections, aps));
        const p = partirEnMadrid(d.sessionDate);
        setFecha(p.fecha);
        setHora(p.hora);
        setDuracion(d.duration ?? "");
        setInternas(d.internalNotes ?? "");
        setCerrada(d.status === "published");
        setEtiquetaNota(d.etiquetaNota || ETIQUETA_NOTA_POR_DEFECTO);
        setAsistentes(d.asistentes ?? []);
      } else {
        const aps = apartadosConPlantillas({}, lista);
        setApartados(aps);
        setValores(aFormulario({}, aps));
        // Sesión nueva: vienen marcados los que están apuntados al taller, que
        // es lo que pasa casi siempre. Quien falte se desmarca.
        const r = await fetch(`/api/clinica/talleres/${tallerId}`, { cache: "no-store" });
        const j = await r.json();
        const apuntados = j?.ok ? (j.data?.apuntados ?? []) : [];
        setAsistentes(
          apuntados.map((i) => ({
            patientId: i.patientId,
            nombre: [i.patient?.firstName, i.patient?.lastName].filter(Boolean).join(" ") || "—",
            asistio: true,
            nota: "",
          }))
        );
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setCargando(false);
    }
  }, [sesionId, tallerId]);

  useEffect(() => { cargar(); }, [cargar]);

  function cambiarAsistente(patientId, campo, valor) {
    setAsistentes((prev) => prev.map((a) => (a.patientId === patientId ? { ...a, [campo]: valor } : a)));
  }

  async function guardar() {
    setErr(null);
    if (!fecha) { setErr("Pon la fecha de la sesión"); return; }
    setGuardando(true);
    try {
      /*
       * La hora se manda como un ISO completo construido en el navegador. Aquí
       * NO hace falta la ceremonia de los bloqueos (fecha + hora por separado,
       * que el servidor interpreta en Madrid): el navegador de quien escribe
       * está en la hora del centro y el ISO que sale de aquí ya lleva su zona,
       * así que no hay ambigüedad que resolver en el servidor.
       */
      const cuando = new Date(`${fecha}T${hora || "00:00"}`);
      if (Number.isNaN(cuando.getTime())) throw new Error("La fecha o la hora no se entienden");

      const cuerpo = {
        sessionDate: cuando.toISOString(),
        duration: duracion === "" ? null : Number(duracion),
        contentSections: { ...desdeFormulario(valores, apartados), apartados },
        internalNotes: internas,
        etiquetaNota,
        status: cerrada ? "published" : "registered",
        // Solo los que vinieron. A los desmarcados se les quita su registro —
        // salvo que ya se le haya enviado a su familia, que eso lo frena el
        // servidor y lo cuenta en la respuesta.
        asistentes: asistentes.filter((a) => a.asistio).map((a) => ({ patientId: a.patientId, nota: a.nota ?? "" })),
      };

      const r = await fetch(
        sesionId ? `/api/clinica/taller-sesiones/${sesionId}` : `/api/clinica/talleres/${tallerId}/sesiones`,
        {
          method: sesionId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        }
      );
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se ha podido guardar");
      onSaved?.(j.data);
    } catch (e) {
      setErr(e.message);
      setGuardando(false);
    }
  }

  const vinieron = asistentes.filter((a) => a.asistio).length;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      {/* top-14 lg:top-0 … bottom-0: la barra móvil (regla 13). */}
      <div className="fixed top-14 lg:top-0 right-0 bottom-0 z-50 w-full max-w-2xl bg-white shadow-pop flex flex-col">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Registro de taller</div>
            <h3 className="font-display text-lg text-neutral-900 mt-0.5 truncate">{tallerName || "Taller"}</h3>
          </div>
          <button
            type="button"
            onClick={() => !guardando && onClose()}
            className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors shrink-0"
          >
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {cargando ? (
            <p className="text-xs text-neutral-400">Cargando…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs">
                  <span className="block text-neutral-500 mb-1">Día</span>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs">
                  <span className="block text-neutral-500 mb-1">Hora</span>
                  <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs">
                  <span className="block text-neutral-500 mb-1">Duración (min)</span>
                  <input
                    type="number" min="1" value={duracion} placeholder="90"
                    onChange={(e) => setDuracion(e.target.value)} className={inputCls}
                  />
                </label>
              </div>

              {/* ── 1. El registro del grupo ───────────────────────────── */}
              <section>
                <div className="text-sm font-semibold text-neutral-800">Registro del grupo</div>
                <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
                  Se escribe una vez y sale <strong>igual</strong> en la ficha de todos los que vinieron.
                </p>
                <ApartadosEditor
                  apartados={apartados}
                  valores={valores}
                  onValor={(k, v) => setValores((prev) => ({ ...prev, [k]: v }))}
                  onApartados={setApartados}
                  plantillas={plantillas}
                  disabled={guardando}
                />
              </section>

              {/* ── 2. Cada paciente ───────────────────────────────────── */}
              <section>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="text-sm font-semibold text-neutral-800">
                    Quién vino <span className="font-normal text-neutral-400">({vinieron} de {asistentes.length})</span>
                  </div>
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
                  Lo que escribas aquí <strong>solo sale en la ficha de esa persona</strong>. Nadie más lo ve, ni
                  las otras familias del taller.
                </p>

                <label className="text-xs block mb-3">
                  <span className="block text-neutral-500 mb-1">Cómo se titula ese apartado en su registro</span>
                  <input
                    value={etiquetaNota}
                    onChange={(e) => setEtiquetaNota(e.target.value)}
                    placeholder={ETIQUETA_NOTA_POR_DEFECTO}
                    className={inputCls}
                  />
                </label>

                {asistentes.length === 0 ? (
                  <p className="text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-lg px-4 py-5 text-center">
                    No hay nadie apuntado a este taller todavía. Se apunta gente desde su ficha.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {asistentes.map((a) => (
                      <li key={a.patientId} className="border border-neutral-200 rounded-lg p-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!a.asistio}
                            onChange={(e) => cambiarAsistente(a.patientId, "asistio", e.target.checked)}
                            className="accent-[var(--color-primary,#1B3A2D)]"
                          />
                          <span className="text-sm font-medium text-neutral-800">{a.nombre}</span>
                          {a.yaNoApuntado && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                              ya no está apuntado
                            </span>
                          )}
                          {a.enviada && (
                            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
                              ya enviado a su familia
                            </span>
                          )}
                        </label>
                        {a.asistio && (
                          <textarea
                            rows={2}
                            value={a.nota ?? ""}
                            onChange={(e) => cambiarAsistente(a.patientId, "nota", e.target.value)}
                            placeholder={`${etiquetaNota || ETIQUETA_NOTA_POR_DEFECTO} de ${a.nombre}…`}
                            className="mt-2 w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {asistentes.some((a) => !a.asistio && a.enviada) && (
                  <p className="text-[11px] text-amber-700 mt-2">
                    A quien ya tenga el registro enviado a su familia no se le borra aunque lo desmarques: ese
                    documento ya está en su área privada.
                  </p>
                )}
              </section>

              {/* ── 3. Notas internas del grupo ────────────────────────── */}
              <section>
                <div className="text-sm font-semibold text-neutral-800">Notas internas del grupo</div>
                <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
                  Solo para el equipo. <strong>No sale del CRM</strong>: ni en la ficha de los pacientes, ni en
                  informes, ni en lo que recibe la familia.
                </p>
                <textarea
                  rows={3}
                  value={internas}
                  onChange={(e) => setInternas(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed"
                />
              </section>

              <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cerrada}
                  onChange={(e) => setCerrada(e.target.checked)}
                  className="accent-[var(--color-primary,#1B3A2D)]"
                />
                Cerrar el registro (queda cerrado también en la ficha de cada paciente)
              </label>
            </>
          )}

          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
          <button
            type="button" onClick={() => !guardando && onClose()}
            className="px-3 py-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={guardar} disabled={guardando || cargando}
            className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </>
  );
}
