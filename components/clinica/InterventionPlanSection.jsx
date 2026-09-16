"use client";

/**
 * InterventionPlanSection — plan de intervención del paciente (sprint 2026-07-29).
 *
 * Recoge lo que antes vivía disperso o directamente no existía: diagnóstico,
 * motivo de consulta, información previa, objetivos, tipos de actividad y
 * metodologías. Y la SECUENCIACIÓN: cuántos informes de objetivos y cuántos
 * registros de sesión le tocan a ESTE paciente por trimestre escolar.
 *
 * El cumplimiento (hechos vs. previstos) lo calcula el servidor contando los
 * informes y sesiones reales, así que aquí solo se pinta: no hay contadores
 * que puedan decir una cosa distinta de lo que hay en la ficha.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import useGrabadora, { fmtSegundos } from "@/components/clinica/useGrabadora.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";
import {
  normalizarObjetivos,
  cabeOtroObjetivo,
  MAX_OBJETIVOS_POR_TERAPEUTA,
  agruparPorTerapeuta,
  editarObjetivo,
  puedeEditarObjetivo,
  MAX_TEXTO_OBJETIVO,
} from "@/lib/clinica/objetivosDelPlan.js";
import { normalizarMotivos, ponerMotivo, motivoDe, MAX_TEXTO_MOTIVO } from "@/lib/clinica/motivosDelPlan.js";
import { esAdmin as esDireccion } from "@/lib/auth/permisos.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

/** Editor de una lista de textos (objetivos, actividades, metodologías). */
function ListaEditable({ etiqueta, valores, onChange, placeholder }) {
  const [borrador, setBorrador] = useState("");
  const anadir = () => {
    const v = borrador.trim();
    if (!v) return;
    if (!valores.includes(v)) onChange([...valores, v]);
    setBorrador("");
  };
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-400">{etiqueta}</label>
      <div className="mt-1 flex flex-wrap gap-1.5 mb-2">
        {valores.length === 0 && <span className="text-xs text-neutral-300">Sin definir</span>}
        {valores.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 text-[11px] text-neutral-700">
            {v}
            <button
              type="button"
              onClick={() => onChange(valores.filter((x) => x !== v))}
              className="text-neutral-400 hover:text-rose-600"
              aria-label={`Quitar ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } }}
          placeholder={placeholder}
          className={inputCls}
        />
        <button type="button" onClick={anadir} className="px-3 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 shrink-0">
          Añadir
        </button>
      </div>
    </div>
  );
}

/** «logopedia» → «Logopedia», «terapia_ocupacional» → «Terapia ocupacional». */
const rotuloEspecialidad = (k) => (k ? String(k).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);

/**
 * Objetivos POR TERAPEUTA (07/09/2026, AV-0061 de Aumenta, Estefanía: «hay
 * pacientes compartidos y los objetivos cambian según la especialidad»).
 *
 * Un grupo por terapeuta del paciente —quien escribe, primero— con sus
 * objetivos y su caja para añadir; los planes viejos (textos sin terapeuta)
 * salen en «Sin terapeuta» y cada una puede hacerlos suyos. La regla de
 * agrupar y normalizar vive en `lib/clinica/objetivosDelPlan.js`.
 *
 * ── Y SE CORRIGEN EN SITIO (09/09/2026, AV-0080, Blanca) ───────────────────
 * «Esos mismos objetivos que te genera la IA, pueda modificarse, ya que ahora
 * tan solo deja eliminarlos o añadir algún otro nuevo.» Cada objetivo pasa de
 * píldora a FILA con su botón «Editar»: con 112 caracteres de media (medido en
 * los 571 objetivos de Aumenta) la píldora redonda ya se partía en dos líneas y
 * no dejaba sitio para nada más.
 *
 * Tres decisiones que se notan al usarlo:
 *   · «Editar» está SIEMPRE visible, no al pasar el ratón: esto se usa en
 *     tablet, y una acción que solo aparece con el cursor no existe.
 *   · Escapar sin guardar NO pierde nada, y el `blur` no cierra ni guarda:
 *     perder lo escrito por clicar fuera es lo que más cabrea.
 *   · Aquí no se persiste nada. Como el resto de la pestaña, hasta «Guardar
 *     plan» no sale de la pantalla, y debajo se lo recuerda.
 *
 * Solo se corrige lo tuyo, lo que no tiene dueño, o todo si eres dirección
 * (`puedeEditarObjetivo`). La × se queda abierta para todo el equipo, como
 * estaba: el encargo era poder corregir, y cerrar el borrado es una puerta que
 * nadie ha pedido.
 */
function ObjetivosPorTerapeuta({ objetivos, onChange, terapeutas, equipo, yo, canEdit, esAdmin = false }) {
  const [borradores, setBorradores] = useState({});
  // { indice, texto } del que se está corrigiendo, y el aviso de por qué no se
  // ha podido guardar. El índice viene de `agruparPorTerapeuta` y es la
  // posición en la lista NORMALIZADA, no en `objetivos`.
  const [editando, setEditando] = useState(null);
  const [avisoEdicion, setAvisoEdicion] = useState(null);
  // Por terapeuta: «aquí ya no cabe otro» (AV-0164).
  const [avisoTope, setAvisoTope] = useState({});
  const grupos = agruparPorTerapeuta(objetivos, { terapeutas, equipo, yo });
  const anadir = (terapeutaId) => {
    const v = (borradores[terapeutaId ?? ""] ?? "").trim();
    if (!v) return;
    /*
     * Si no cabe, se DICE y no se borra lo escrito (16/09/2026, AV-0164).
     * Araceli escribió varios objetivos en un paciente compartido y la caja se
     * los tragó uno detrás de otro: `normalizarObjetivos` recorta al tope y
     * devolvía la misma lista, así que no pasaba nada y no se veía por qué.
     */
    if (!cabeOtroObjetivo(objetivos, terapeutaId)) {
      setAvisoTope((a) => ({
        ...a,
        [terapeutaId ?? ""]: `Ya hay ${MAX_OBJETIVOS_POR_TERAPEUTA} objetivos aquí, que es el tope. Quita alguno que ya esté conseguido para escribir este.`,
      }));
      return;
    }
    onChange(normalizarObjetivos([...objetivos, { texto: v, terapeutaId }]));
    setBorradores((b) => ({ ...b, [terapeutaId ?? ""]: "" }));
    setAvisoTope((a) => ({ ...a, [terapeutaId ?? ""]: null }));
  };
  // Por ÍNDICE, no por texto ni por identidad: dos terapeutas pueden tener el
  // mismo objetivo, y `agruparPorTerapeuta` devuelve copias.
  const quitar = (o) => onChange(normalizarObjetivos(objetivos).filter((_, i) => i !== o.indice));
  const hacerMio = (o) =>
    onChange(normalizarObjetivos(objetivos).map((x, i) => (i === o.indice ? { ...x, terapeutaId: yo } : x)));
  const guardarEdicion = () => {
    const r = editarObjetivo(objetivos, editando.indice, editando.texto);
    if (r.ok) { onChange(r.objetivos); setEditando(null); setAvisoEdicion(null); return; }
    if (r.motivo === "repetido") { setAvisoEdicion("Ese objetivo ya lo tienes escrito."); return; }
    if (r.motivo === "vacio") { setAvisoEdicion("Un objetivo no puede quedarse en blanco: para quitarlo, usa la ×."); return; }
    setEditando(null);
    setAvisoEdicion(null);
  };
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-400">Objetivos</label>
      {grupos.length === 0 && <div className="mt-1 text-xs text-neutral-300">Sin definir</div>}
      <div className="mt-1 space-y-3">
        {grupos.map((g) => (
          <div key={g.terapeutaId ?? "sin"} className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-2.5">
            <div className="text-[11px] font-medium text-neutral-700 mb-1.5">
              {g.nombre}
              {g.especialidad && <span className="text-neutral-400 font-normal"> · {rotuloEspecialidad(g.especialidad)}</span>}
              {g.esYo && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">tú</span>}
            </div>
            {/* Qué hace ahí ese montón (09/09/2026, AV-0097): sin esta línea,
                «Sin terapeuta» parece un fallo y no un pendiente con arreglo. */}
            {g.terapeutaId === null && g.objetivos.length > 0 && (
              <div className="text-[10px] text-neutral-400 mb-1.5">
                Escritos antes de repartir los objetivos por terapeuta. Con «Ponérmelo» te los llevas al tuyo sin reescribirlos.
              </div>
            )}
            <div className="space-y-1 mb-2">
              {g.objetivos.length === 0 && <span className="text-xs text-neutral-300">Sin objetivos todavía</span>}
              {g.objetivos.map((o) => {
                const mio = puedeEditarObjetivo(o, { yo, esAdmin });
                if (editando?.indice === o.indice) {
                  return (
                    <div key={o.indice} className="rounded-lg bg-white border border-neutral-300 px-2 py-1.5">
                      <textarea
                        autoFocus
                        rows={2}
                        maxLength={MAX_TEXTO_OBJETIVO}
                        value={editando.texto}
                        onChange={(e) => { setEditando({ ...editando, texto: e.target.value }); setAvisoEdicion(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); guardarEdicion(); }
                          if (e.key === "Escape") { e.preventDefault(); setEditando(null); setAvisoEdicion(null); }
                        }}
                        className="w-full text-[11px] text-neutral-700 bg-transparent resize-y focus:outline-none"
                      />
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[10px] text-neutral-400">
                          {MAX_TEXTO_OBJETIVO - editando.texto.length < 30
                            ? `Quedan ${MAX_TEXTO_OBJETIVO - editando.texto.length} caracteres`
                            : "Enter para guardar · Esc para dejarlo como estaba"}
                        </span>
                        <span className="flex gap-1.5 shrink-0">
                          <button type="button" onClick={() => { setEditando(null); setAvisoEdicion(null); }}
                            className="text-[10px] text-neutral-500 hover:text-neutral-800 px-1.5 py-0.5">
                            Cancelar
                          </button>
                          <button type="button" onClick={guardarEdicion}
                            className="text-[10px] font-medium text-emerald-700 hover:text-emerald-900 border border-emerald-200 rounded-md px-2 py-0.5">
                            Guardar
                          </button>
                        </span>
                      </div>
                      {avisoEdicion && <p className="text-[10px] text-amber-700 mt-1">{avisoEdicion}</p>}
                    </div>
                  );
                }
                return (
                  <div key={o.indice} className="flex items-start justify-between gap-2 rounded-lg bg-white border border-neutral-200 px-2 py-1">
                    <span className={`text-[11px] leading-snug whitespace-pre-wrap ${mio ? "text-neutral-700" : "text-neutral-500"}`}>
                      {o.texto}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0 pt-px">
                      {canEdit && mio && (
                        <button type="button" onClick={() => { setEditando({ indice: o.indice, texto: o.texto }); setAvisoEdicion(null); }}
                          className="text-[10px] text-neutral-500 hover:text-emerald-700" aria-label="Corregir este objetivo">
                          Editar
                        </button>
                      )}
                      {/*
                          SE VE (09/09/2026, AV-0097). Laura: «metí los objetivos
                          en el plan y ahora me salen en el apartado sin
                          terapeuta, ¿hay alguna forma de ponerlo en el mío sin
                          borrar todo y volver a redactarlo?».

                          Y la había desde el 07/09: este mismo botón. Pero era
                          la palabra «mío» en gris de 10 px entre «Editar» y la
                          ×, o sea invisible. Una función que nadie encuentra no
                          existe: se pidió construir lo que ya estaba hecho.
                      */}
                      {canEdit && g.terapeutaId === null && yo && (
                        <button
                          type="button"
                          onClick={() => hacerMio(o)}
                          title="Llevártelo a tu apartado sin reescribirlo"
                          className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                        >
                          Ponérmelo
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" onClick={() => quitar(o)} className="text-neutral-400 hover:text-rose-600 leading-none" aria-label={`Quitar ${o.texto}`}>
                          ×
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {canEdit && g.terapeutaId !== null && avisoTope[g.terapeutaId] && (
              <p className="text-[10px] text-amber-700 mb-1.5">{avisoTope[g.terapeutaId]}</p>
            )}
            {canEdit && g.terapeutaId !== null && (
              <div className="flex gap-2">
                <input
                  value={borradores[g.terapeutaId] ?? ""}
                  onChange={(e) => setBorradores((b) => ({ ...b, [g.terapeutaId]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(g.terapeutaId); } }}
                  placeholder={g.esYo ? "Un objetivo tuyo para este paciente" : `Un objetivo de ${g.nombre}`}
                  className={inputCls}
                />
                <button type="button" onClick={() => anadir(g.terapeutaId)} className="px-3 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 shrink-0">
                  Añadir
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Motivo de consulta POR TERAPIA (15/09/2026, AV-0143 de Aumenta, Blanca: «tal
 * y como habéis hecho en los objetivos, sería bueno tenerlo igual en el motivo
 * de consulta»). Una caja por terapeuta del paciente —quien escribe, primero—
 * y también las de quien ya no está pero dejó el suyo. Cada una escribe el
 * suyo; el de otra se lee (dirección puede todos), con la misma regla que
 * corregir un objetivo. El motivo general de arriba no se toca.
 */
function MotivosPorTerapeuta({ motivos, onChange, terapeutas, equipo, yo, canEdit, esAdmin = false }) {
  const escritos = normalizarMotivos(motivos);
  const ids = [...new Set([...terapeutas.map((t) => t.id), ...escritos.map((m) => m.terapeutaId)])];
  if (!ids.length) return null;
  const nombreDe = (id) =>
    terapeutas.find((t) => t.id === id)?.nombre ?? equipo.find((m) => m.id === id)?.displayName ?? "Terapeuta que ya no está";
  const grupos = ids
    .map((id) => ({ id, nombre: nombreDe(id), especialidad: terapeutas.find((t) => t.id === id)?.especialidad ?? null, esYo: id === yo }))
    .sort((a, b) => (a.esYo === b.esYo ? a.nombre.localeCompare(b.nombre, "es") : a.esYo ? -1 : 1));
  const valorDe = (id) => (Array.isArray(motivos) ? motivos : []).find((m) => m?.terapeutaId === id)?.texto ?? "";
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-400">Motivo de consulta por terapia</label>
      <div className="mt-1 grid md:grid-cols-2 gap-3">
        {grupos.map((g) => {
          const puede = canEdit && puedeEditarObjetivo({ terapeutaId: g.id }, { yo, esAdmin });
          return (
            <div key={g.id} className="rounded-lg border border-neutral-100 bg-neutral-50/50 p-2.5">
              <div className="text-[11px] font-medium text-neutral-700 mb-1.5">
                {g.nombre}
                {g.especialidad && <span className="text-neutral-400 font-normal"> · {rotuloEspecialidad(g.especialidad)}</span>}
                {g.esYo && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">tú</span>}
              </div>
              {puede ? (
                <textarea
                  rows={2}
                  maxLength={MAX_TEXTO_MOTIVO}
                  value={valorDe(g.id)}
                  onChange={(e) => onChange(ponerMotivo(motivos, g.id, e.target.value))}
                  placeholder={g.esYo ? "Por qué acude a tu terapia" : `Por qué acude a la terapia de ${g.nombre}`}
                  className={inputCls}
                />
              ) : (
                <div className={`text-[11px] whitespace-pre-wrap ${valorDe(g.id) ? "text-neutral-600" : "text-neutral-300"}`}>
                  {valorDe(g.id) || "Sin escribir"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Objetivos con IA (02/09/2026, Aumenta por el buzón AV-0019, Laura): la
 * terapeuta escribe las ideas clave, Claude redacta objetivos de intervención
 * adaptados al paciente y ella marca cuáles entran en el plan. No se guarda
 * nada hasta pulsar «Guardar plan». El endpoint recibe lo que hay EN PANTALLA
 * (`plan`) para no repetir objetivos ni ignorar un diagnóstico sin guardar.
 */
function ObjetivosConIa({ patientId, plan, onAnadir }) {
  const [abierto, setAbierto] = useState(false);
  const [ideas, setIdeas] = useState("");
  const [pidiendo, setPidiendo] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [propuesta, setPropuesta] = useState(null); // [{ texto, marcado }]
  const [esEnsayo, setEsEnsayo] = useState(false);

  /*
   * Dictar las ideas clave (03/09/2026, vuelta de AV-0019): un audio —grabado
   * aquí o elegido— pasa por Whisper (`plan/transcribir`) y el texto cae en la
   * caja de ideas; proponer los objetivos sigue siendo el botón de siempre.
   */
  const [transcribiendo, setTranscribiendo] = useState(false);
  const fileRef = useRef(null);
  async function dictar(file) {
    if (!file) return;
    setTranscribiendo(true);
    setFallo(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "audio");
      const res = await fetch(`/api/pacientes/${patientId}/plan/transcribir`, { method: "POST", body: fd });
      const j = await leerRespuestaApi(res);
      if (!j.ok) throw new Error(j.error || "No se ha podido transcribir el audio");
      const texto = String(j.data?.texto ?? "").trim();
      setIdeas((prev) => (prev.trim() ? `${prev.trim()}\n${texto}` : texto).slice(0, 2000));
      if (j.data?.fake) setEsEnsayo(true);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setTranscribiendo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  const grabadora = useGrabadora({ onAudio: dictar, onError: setFallo });

  async function proponer() {
    setPidiendo(true);
    setFallo(null);
    try {
      const res = await fetch(`/api/pacientes/${patientId}/plan/objetivos-ia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideas,
          plan: {
            diagnosis: plan.diagnosis,
            consultationReasons: plan.consultationReasons,
            consultationReasonsByTherapist: normalizarMotivos(plan.consultationReasonsByTherapist),
            previousInfo: plan.previousInfo,
            objectives: plan.objectives,
          },
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "La IA no ha podido redactar los objetivos");
      setPropuesta(j.data.objetivos.map((texto) => ({ texto, marcado: true })));
      setEsEnsayo(Boolean(j.data.fake));
    } catch (e) {
      setFallo(e.message);
    } finally {
      setPidiendo(false);
    }
  }

  function anadirMarcados() {
    const elegidos = (propuesta ?? []).filter((p) => p.marcado).map((p) => p.texto);
    if (!elegidos.length) return;
    onAnadir(elegidos);
    setPropuesta(null);
    setIdeas("");
  }

  /*
   * DICTAR SE VE DESDE FUERA (05/09/2026, AV-0050 de Aumenta: «aún no nos sale
   * la opción de poder grabar audio en el apartado de plan»).
   *
   * Estaba puesto y funcionaba, pero DENTRO de este panel: con el panel plegado
   * —que es como se abre la pestaña Plan— lo único que se veía era el enlace de
   * la IA, y «Redactar objetivos con IA» no es donde nadie busca un micrófono.
   * Así que el botón sale también aquí y hace las dos cosas de una vez: abre el
   * panel y empieza a grabar. Un botón que aparece y ya está grabando es lo que
   * ella esperaba encontrar.
   */
  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline"
        >
          ✨ Redactar objetivos con IA a partir de ideas clave
        </button>
        {grabadora.soportado && (
          <button
            type="button"
            onClick={() => { setAbierto(true); grabadora.empezar(); }}
            title="Dictar las ideas clave con el micrófono"
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"
          >
            ● Dictar
          </button>
        )}
      </div>
    );
  }

  const marcados = (propuesta ?? []).filter((p) => p.marcado).length;

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">Objetivos con IA</div>
        <button type="button" onClick={() => setAbierto(false)} className="text-neutral-400 hover:text-neutral-700 text-lg leading-none" aria-label="Cerrar">×</button>
      </div>
      <p className="text-[11px] text-neutral-500">
        Escribe las ideas clave que quieres trabajar (áreas, conductas, apoyos…). La IA propone objetivos de
        intervención adaptados a la edad y al plan de este paciente; tú eliges cuáles entran. Al modelo no le
        llega el nombre del paciente.
      </p>
      <textarea
        rows={3}
        value={ideas}
        onChange={(e) => setIdeas(e.target.value)}
        maxLength={2000}
        placeholder="Ej.: respetar turnos de palabra, frases de tres elementos, tolerar la frustración en juegos de reglas"
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={proponer}
          disabled={pidiendo || transcribiendo || ideas.trim().length < 3}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {pidiendo ? "Redactando…" : propuesta ? "Volver a proponer" : "Proponer objetivos"}
        </button>
        {/* Dictar en vez de teclear: graba aquí o elige un audio; el texto
            entra en la caja de arriba y se puede retocar antes de proponer. */}
        {grabadora.soportado && (
          <button
            type="button"
            onClick={grabadora.grabando ? grabadora.parar : grabadora.empezar}
            disabled={pidiendo || transcribiendo}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border disabled:opacity-40 ${grabadora.grabando ? "border-rose-300 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"}`}
            title={grabadora.grabando ? "Parar y transcribir" : "Dictar las ideas clave con el micrófono"}
          >
            {grabadora.grabando ? `■ Parar · ${fmtSegundos(grabadora.segundos)}` : "● Dictar"}
          </button>
        )}
        {!grabadora.grabando && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pidiendo || transcribiendo}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 disabled:opacity-40"
          >
            {transcribiendo ? "Transcribiendo…" : "Añadir audio"}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4"
          className="hidden"
          onChange={(e) => dictar(e.target.files?.[0])}
        />
        {fallo && <span className="text-[11px] text-red-700">{fallo}</span>}
      </div>

      {propuesta && (
        <div className="space-y-1.5 pt-1">
          {esEnsayo && (
            <p className="text-[11px] text-amber-700">Propuesta simulada: en la demo la IA no se llama de verdad.</p>
          )}
          {propuesta.map((p, i) => (
            <label key={i} className="flex items-start gap-2 text-[12px] text-neutral-700 cursor-pointer">
              <input
                type="checkbox"
                checked={p.marcado}
                onChange={() => setPropuesta(propuesta.map((x, j) => (j === i ? { ...x, marcado: !x.marcado } : x)))}
                className="mt-0.5"
              />
              <span>{p.texto}</span>
            </label>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={anadirMarcados}
              disabled={marcados === 0}
              className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Añadir {marcados === 1 ? "este objetivo" : `estos ${marcados} objetivos`} al plan
            </button>
            <span className="text-[11px] text-neutral-400">Después, «Guardar plan».</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Cumplimiento({ datos }) {
  if (!datos?.trimestres?.length) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
          Seguimiento del curso {datos.curso}
        </div>
        <div className="text-[11px] text-neutral-400">
          {datos.previstos.informes} informe(s) y {datos.previstos.registros} registro(s) por trimestre
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {datos.trimestres.map((t) => {
          // `completo === null` = este paciente no tiene secuenciación puesta:
          // "0 de 0" no es un objetivo cumplido, es que no hay objetivo.
          const color =
            t.completo === null ? "border-neutral-200" : t.completo ? "border-emerald-300" : "border-amber-300";
          return (
            <div key={t.key} className={`rounded-lg border ${color} px-3 py-2.5`}>
              <div className="text-xs font-semibold text-neutral-700">{t.label}</div>
              <div className="mt-1.5 text-[11px] text-neutral-600 tabular-nums">
                Informes <strong>{t.informes.hechos}</strong>/{t.informes.previstos}
              </div>
              <div className="text-[11px] text-neutral-600 tabular-nums">
                Registros <strong>{t.registros.hechos}</strong>/{t.registros.previstos}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function InterventionPlanSection({ patientId, canEdit = true }) {
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState(null);
  const [cumplimiento, setCumplimiento] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [form, setForm] = useState({
    diagnosis: "", consultationReasons: "", consultationReasonsByTherapist: [], previousInfo: "",
    objectives: [], activityTypes: [], methodologies: [],
    objectivesReportsPerTrimester: 0, sessionRecordsPerTrimester: 0,
  });
  // Para agrupar los objetivos por terapeuta (AV-0061): los del paciente, el
  // equipo (nombres de quien ya no esté) y quien escribe.
  const [terapeutas, setTerapeutas] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [yo, setYo] = useState(null);
  // Lo que se puede traer de la entrevista inicial (09/09/2026, AV-0103).
  const [trayendo, setTrayendo] = useState(false);
  /*
   * El ROL, para saber si quien mira es dirección (09/09/2026, AV-0080). Sale
   * de `/api/auth/me` y NO de `/api/team/me`, que devuelve la ficha de equipo
   * sin rol; es el mismo camino que ya usa `/equipo` por la misma razón.
   *
   * Aquí el rol solo sirve para PINTAR: quien decide de verdad quién puede
   * escribir en un plan es el servidor.
   */
  const [rol, setRol] = useState("user");
  useEffect(() => {
    let vivo = true;
    fetch(`/api/pacientes/${patientId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!vivo) return;
      const lista = Array.isArray(j?.data?.therapists) ? j.data.therapists : [];
      setTerapeutas(lista.map((t) => ({ id: t.teamMemberId ?? t.id, nombre: t.displayName ?? "Terapeuta", especialidad: t.specialty ?? null })).filter((t) => t.id));
    }).catch(() => {});
    fetch(`/api/team?status=all&limit=200`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo) setEquipo(j?.data?.members ?? []); }).catch(() => {});
    fetch(`/api/team/me`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo) setYo(j?.data?.member?.id ?? null); }).catch(() => {});
    // El rol va en `data.role`, no en `data.user.role`: la respuesta de
    // `/api/auth/me` es el usuario, no un sobre con un usuario dentro.
    fetch(`/api/auth/me`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo) setRol(j?.data?.role ?? "user"); }).catch(() => {});
    return () => { vivo = false; };
  }, [patientId]);

  const cargar = useCallback(() => {
    setCargando(true);
    fetch(`/api/pacientes/${patientId}/plan`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "No se pudo cargar el plan");
        const p = j.data.plan;
        setCumplimiento(j.data.cumplimiento);
        if (p) {
          setForm({
            diagnosis: p.diagnosis ?? "",
            consultationReasons: p.consultationReasons ?? "",
            consultationReasonsByTherapist: normalizarMotivos(p.consultationReasonsByTherapist),
            previousInfo: p.previousInfo ?? "",
            objectives: normalizarObjetivos(p.objectives ?? []),
            activityTypes: p.activityTypes ?? [],
            methodologies: p.methodologies ?? [],
            objectivesReportsPerTrimester: p.reportSchedule?.objectivesReportsPerTrimester ?? 0,
            sessionRecordsPerTrimester: p.reportSchedule?.sessionRecordsPerTrimester ?? 0,
          });
        }
      })
      .catch((e) => setErr(e.message))
      .finally(() => setCargando(false));
  }, [patientId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    setGuardando(true);
    setErr(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/pacientes/${patientId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          objectivesReportsPerTrimester: Number(form.objectivesReportsPerTrimester) || 0,
          sessionRecordsPerTrimester: Number(form.sessionRecordsPerTrimester) || 0,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setAviso("Plan guardado.");
      cargar(); // recalcula el cumplimiento con la secuenciación nueva
    } catch (e) {
      setErr(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <div className="text-xs text-neutral-400">Cargando el plan…</div>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  /**
   * Trae de la entrevista inicial lo que el Plan tenga vacío (AV-0103).
   *
   * No guarda: rellena el formulario y lo dice. Como el resto de la pestaña,
   * hasta «Guardar plan» no sale de la pantalla.
   */
  async function traerDeLaEntrevista() {
    setTrayendo(true);
    setErr(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/pacientes/${patientId}/plan/desde-entrevista`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se ha podido leer la entrevista inicial");
      if (!j.data.hayEntrevista) {
        setAviso("Este paciente no tiene entrevista inicial escrita, así que no hay de dónde traerlo.");
        return;
      }
      const rellena = j.data.rellena ?? {};
      if (!Object.keys(rellena).length) {
        setAviso("No hay nada que traer: el motivo de consulta y la información previa ya están escritos.");
        return;
      }
      setForm((f) => ({ ...f, ...rellena }));
      const que = Object.keys(rellena)
        .map((k) => (k === "consultationReasons" ? "el motivo de consulta" : "la información previa"))
        .join(" y ");
      setAviso(`Traído ${que} de la entrevista inicial. Revísalo y pulsa «Guardar plan». ${j.data.resumen?.diagnostico ?? ""}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setTrayendo(false);
    }
  }

  /**
   * Trae de los informes PDF subidos el motivo de cada terapia (15/09/2026,
   * AV-0103) y sus objetivos (16/09/2026, AV-0163). Como el de la entrevista:
   * no guarda, y solo toca lo que en pantalla siga vacío, aunque esté a medio
   * escribir sin guardar.
   */
  async function traerDeLosInformes() {
    setTrayendo(true);
    setErr(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/pacientes/${patientId}/plan/desde-informes`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se han podido leer los informes");
      const d = j.data;
      if (!d.hayInformes) {
        setAviso("Este paciente no tiene informes en PDF subidos en Documentos, así que no hay de dónde traerlo.");
        return;
      }
      const nombreDe = (id) =>
        terapeutas.find((t) => t.id === id)?.nombre ?? equipo.find((m) => m.id === id)?.displayName ?? "su terapeuta";
      // Solo lo que siga vacío; se vuelve a mirar al aplicar por si se ha
      // escrito algo mientras se leían los PDF.
      const motivos = (d.motivos ?? []).filter((m) => !motivoDe(form.consultationReasonsByTherapist, m.terapeutaId));
      // Los objetivos, solo a quien no tenga ninguno escrito (AV-0163).
      const tieneObjetivos = (id) => form.objectives.some((o) => (o.terapeutaId ?? null) === id);
      const objetivos = (d.objetivos ?? []).filter((o) => !tieneObjetivos(o.terapeutaId ?? null));
      const general = d.general && !form.consultationReasons.trim() ? d.general : null;
      const diagnostico = d.diagnostico && !form.diagnosis.trim() ? d.diagnostico : null;
      // La lista de objetivos se arma AQUÍ y no dentro del setForm: el Plan
      // admite 40 en total, así que hay que contar cuántos entran de verdad
      // para no decir «20 objetivos» cuando han cabido 6.
      let listaObjetivos = normalizarObjetivos(form.objectives);
      const puestos = [];
      for (const o of objetivos) {
        const id = o.terapeutaId ?? null;
        const antes = listaObjetivos.length;
        listaObjetivos = normalizarObjetivos([...listaObjetivos, ...o.textos.map((texto) => ({ texto, terapeutaId: id }))]);
        puestos.push({ ...o, cuantos: listaObjetivos.length - antes });
      }
      setForm((f) => {
        const nuevo = { ...f };
        for (const m of motivos) {
          if (motivoDe(nuevo.consultationReasonsByTherapist, m.terapeutaId)) continue;
          nuevo.consultationReasonsByTherapist = ponerMotivo(nuevo.consultationReasonsByTherapist, m.terapeutaId, m.texto);
        }
        if (puestos.some((o) => o.cuantos)) nuevo.objectives = listaObjetivos;
        if (general && !f.consultationReasons.trim()) nuevo.consultationReasons = general.texto;
        if (diagnostico && !f.diagnosis.trim()) nuevo.diagnosis = diagnostico.texto;
        return nuevo;
      });
      const traido = [
        ...motivos.map((m) => `el motivo de ${nombreDe(m.terapeutaId)} de «${m.fileName}»`),
        ...puestos
          .filter((o) => o.cuantos)
          .map(
            (o) =>
              `${o.cuantos} objetivo${o.cuantos > 1 ? "s" : ""} ${
                o.terapeutaId ? `para ${nombreDe(o.terapeutaId)}` : "sin terapeuta, para que los repartas"
              } de «${o.fileName}»`,
          ),
        general ? `el motivo general de «${general.fileName}»` : null,
        diagnostico ? `el diagnóstico, tal cual lo escribe «${diagnostico.fileName}»` : null,
      ].filter(Boolean);
      const c = d.cuenta ?? {};
      const aMano = [
        c.sinTexto ? `${c.sinTexto} sin texto (escaneado${c.sinTexto > 1 ? "s" : ""})` : null,
        c.cifrados ? `${c.cifrados} con contraseña` : null,
      ].filter(Boolean);
      const nota =
        (aMano.length ? ` No se ha podido leer: ${aMano.join(" y ")}; esos hay que mirarlos a mano.` : "") +
        // Un párrafo entero no entra en un objetivo y se prefiere dejarlo fuera
        // a meterlo cortado por la mitad (AV-0163).
        (puestos.some((o) => o.cuantos) && c.objetivosQueNoCaben
          ? ` Se han quedado fuera ${c.objetivosQueNoCaben} párrafo(s) demasiado largos para un objetivo: están en el informe.`
          : "");
      setAviso(
        traido.length
          ? `Traído ${traido.join(", ")}. Revísalo y pulsa «Guardar plan».${nota}`
          : `Leídos ${c.leidos ?? 0} informes y no hay nada que traer: o no traen «Motivo de consulta» ni «Objetivos», o lo de su terapia ya está escrito.${nota}`,
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setTrayendo(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}
      {aviso && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{aviso}</div>}

      <Cumplimiento datos={cumplimiento} />

      <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        {/*
            TRAER DE LA ENTREVISTA INICIAL (09/09/2026, AV-0103). Silvia pidió
            «el botón de la IA en el Plan para que se rellenen diagnóstico,
            motivo de consulta e información previa», y esto no es un trabajo
            para la IA: el motivo y los antecedentes ya están escritos, palabra
            por palabra, en la entrevista. Traerlos no cuesta un céntimo de la
            cuenta del centro y no puede inventarse nada.

            El diagnóstico no se trae, y el botón lo dice al pulsarlo: la
            entrevista tiene una IMPRESIÓN clínica, que es una hipótesis, y
            volcarla en un campo llamado «Diagnóstico» la convertiría en un
            diagnóstico por el camino.
        */}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={traerDeLaEntrevista}
              disabled={trayendo}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
            >
              {trayendo ? "Buscando…" : "Traer de la entrevista inicial"}
            </button>
            {/* De los informes PDF subidos (15/09/2026, AV-0103): los apartados
                «Motivo de consulta» y «Objetivos» (AV-0163) copiados tal cual,
                a la terapia del informe. */}
            <button
              type="button"
              onClick={traerDeLosInformes}
              disabled={trayendo}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 disabled:opacity-50"
            >
              {trayendo ? "Buscando…" : "Traer de los informes subidos"}
            </button>
            <span className="text-[10px] text-neutral-400">
              Rellena con lo que ya escribisteis, copiado tal cual. No pisa lo que tengas puesto.
            </span>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Diagnóstico</label>
            <textarea rows={2} value={form.diagnosis} onChange={set("diagnosis")} disabled={!canEdit}
              className={`mt-1 ${inputCls}`} placeholder="Diagnóstico o hipótesis de trabajo" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Motivo de consulta general</label>
            <textarea rows={2} value={form.consultationReasons} onChange={set("consultationReasons")} disabled={!canEdit}
              className={`mt-1 ${inputCls}`} placeholder="Por qué acude a consulta" />
          </div>
        </div>

        <MotivosPorTerapeuta
          motivos={form.consultationReasonsByTherapist}
          onChange={(v) => setForm((f) => ({ ...f, consultationReasonsByTherapist: v }))}
          terapeutas={terapeutas}
          equipo={equipo}
          yo={yo}
          canEdit={canEdit}
          esAdmin={esDireccion(rol)}
        />

        <div>
          <label className="text-[10px] uppercase tracking-wider text-neutral-400">Información previa</label>
          <textarea rows={3} value={form.previousInfo} onChange={set("previousInfo")} disabled={!canEdit}
            className={`mt-1 ${inputCls}`} placeholder="Informes anteriores, valoraciones externas, antecedentes relevantes…" />
        </div>

        <ObjetivosPorTerapeuta
          objetivos={form.objectives}
          onChange={(v) => setForm({ ...form, objectives: v })}
          terapeutas={terapeutas}
          equipo={equipo}
          yo={yo}
          canEdit={canEdit}
          esAdmin={esDireccion(rol)}
        />
        {canEdit && (
          <ObjetivosConIa
            patientId={patientId}
            plan={form}
            // Lo que propone la IA entra a nombre de quien escribe (AV-0061).
            onAnadir={(nuevos) =>
              setForm((f) => ({ ...f, objectives: normalizarObjetivos([...f.objectives, ...nuevos.map((texto) => ({ texto, terapeutaId: yo ?? null }))]) }))
            }
          />
        )}
        <ListaEditable etiqueta="Tipos de actividad" valores={form.activityTypes} placeholder="Juego de reglas"
          onChange={(v) => setForm({ ...form, activityTypes: v })} />
        <ListaEditable etiqueta="Metodologías" valores={form.methodologies} placeholder="Autoinstrucciones"
          onChange={(v) => setForm({ ...form, methodologies: v })} />

        <div className="pt-2 border-t border-neutral-100">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
            Secuenciación por trimestre
          </div>
          <p className="text-[11px] text-neutral-400 mb-3 max-w-xl">
            Cuántos informes de objetivos y cuántos registros de sesión le corresponden a este
            paciente en CADA trimestre escolar. El curso va de septiembre a junio; el seguimiento
            de arriba cuenta solo lo que hay registrado de verdad.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Informes</label>
              <input type="number" min="0" max="999" value={form.objectivesReportsPerTrimester} disabled={!canEdit}
                onChange={set("objectivesReportsPerTrimester")} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Registros de sesión</label>
              <input type="number" min="0" max="999" value={form.sessionRecordsPerTrimester} disabled={!canEdit}
                onChange={set("sessionRecordsPerTrimester")} className={`mt-1 ${inputCls}`} />
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex justify-end pt-2">
            <button onClick={guardar} disabled={guardando}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {guardando ? "Guardando…" : "Guardar plan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
