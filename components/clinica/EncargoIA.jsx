"use client";

/**
 * EncargoIA — «pídele algo a la IA», dentro del registro de sesión
 * (09/09/2026, AV-0077 de Araceli).
 *
 * «Cuando estamos realizando un registro de sesión y necesitamos comunicarnos
 * con las familias de manera más detallada —mandarles un material, resolver una
 * duda concreta—, ver cómo pedirle desde el registro que nos ayude con esto…».
 *
 * ── LAS TRES DECISIONES DE PANTALLA ────────────────────────────────────────
 *
 *  1. **Se abre a mano y no hace nada sola.** «En todo momento» es que lo pueda
 *     pedir una persona cuando quiera, no que se dispare al cargar: cada
 *     llamada cuesta dinero de la clave del centro.
 *
 *  2. **Se ve QUÉ va a viajar antes de mandarlo.** Una casilla por apartado, y
 *     la lista sale de `lib/clinica/encargoIa.js`, la misma que valida el
 *     servidor. Las notas internas salen apagadas siempre y, si el texto lo va
 *     a leer la familia, bloqueadas con su motivo escrito: se enseñan
 *     bloqueadas en vez de esconderlas para que no parezca que no existen.
 *
 *  3. **De aquí no sale nada al mundo.** Lo que escribe la IA se copia o se
 *     pega en un apartado del registro; enviar se sigue haciendo desde donde se
 *     enviaba. Es la condición con la que se decidió la tarea: redactar no es
 *     enviar. Y el texto no viaja por la barra de direcciones a ninguna parte
 *     —es material clínico—, así que no hay botón que abra Correo con esto
 *     dentro: se copia y se pega.
 */

import { useEffect, useMemo, useState } from "react";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { DESTINOS, MAX_PETICION, fuentesDelEncargo } from "@/lib/clinica/encargoIa.js";

const TA = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

export default function EncargoIA({ sesionId, bloques = [], valores = {}, onPegar }) {
  const [abierto, setAbierto] = useState(false);
  const [destino, setDestino] = useState("familia");
  const [peticion, setPeticion] = useState("");
  const [marcadas, setMarcadas] = useState(null);
  const [extras, setExtras] = useState({ hayEntrevista: false, hayPlan: false });
  const [pidiendo, setPidiendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [donde, setDonde] = useState("");

  // Qué tiene este paciente además del registro. Se pregunta al abrir y no
  // antes: es una lectura, pero no hay por qué hacerla en cada registro que se
  // escriba sin usar esto.
  useEffect(() => {
    if (!abierto || !sesionId) return;
    fetch(`/api/clinica/sessions/${sesionId}/encargo`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) setExtras({ hayEntrevista: !!j.data.hayEntrevista, hayPlan: !!j.data.hayPlan });
      })
      .catch(() => {});
  }, [abierto, sesionId]);

  const fuentes = useMemo(
    () => fuentesDelEncargo(bloques, { destino, ...extras }),
    [bloques, destino, extras]
  );

  // Lo marcado. `null` hasta que se toca: así lo que viene de fábrica se
  // recalcula si cambia el destino, y deja de hacerlo en cuanto ella elige.
  const elegidas = useMemo(() => {
    if (marcadas) return new Set([...marcadas].filter((c) => fuentes.some((f) => f.clave === c && !f.bloqueada)));
    return new Set(fuentes.filter((f) => f.porDefecto).map((f) => f.clave));
  }, [marcadas, fuentes]);

  const apartadosPegables = useMemo(() => bloques.filter((b) => b.tipo !== "lista"), [bloques]);

  async function pedir() {
    setPidiendo(true);
    setAviso(null);
    setCopiado(false);
    try {
      const r = await fetch(`/api/clinica/sessions/${sesionId}/encargo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peticion, destino, claves: [...elegidas], valores }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "La IA no ha podido escribirlo");
      setTexto(j.data.texto ?? "");
      if (j.data.descartadas?.length) {
        setAviso(`No ha viajado: ${j.data.descartadas.join(", ")}. Lo que va a leer la familia no lleva notas internas.`);
      }
    } catch (e) {
      setAviso(e.message);
    } finally {
      setPidiendo(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setAviso("No se ha podido copiar. Selecciónalo y cópialo a mano.");
    }
  }

  if (!sesionId) {
    return (
      <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 text-[11px] text-neutral-500">
        <span className="font-medium text-neutral-700">¿Necesitas pedirle algo a la IA?</span> Guarda el
        registro primero. Después podrás pedirle desde aquí un correo para la familia, una pauta o lo que
        te haga falta, con lo que hayas escrito.
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full text-left bg-white border border-dashed border-neutral-300 rounded-xl p-4 hover:border-neutral-400 transition-colors"
      >
        <span className="text-sm font-semibold text-neutral-800">Pídele algo a la IA</span>
        <span className="block text-[11px] text-neutral-400 mt-0.5">
          Un correo para la familia, una pauta para casa, explicar un material. Con lo que ya has escrito
          aquí y sin que se envíe nada.
        </span>
      </button>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4 lg:p-5 space-y-3" data-testid="encargo-ia">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-neutral-800">
            Pídele algo a la IA
            <HelpTooltip title="Qué viaja y qué no" className="ml-2">
              Solo viaja lo que dejes marcado abajo, de este registro. La IA no manda nada: escribe un
              borrador que lees tú y decides tú. Las notas internas nunca salen en un texto para la
              familia, aunque estén marcadas.
            </HelpTooltip>
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Escríbele lo que necesitas con tus palabras.
          </p>
        </div>
        <button type="button" onClick={() => setAbierto(false)} className="text-[11px] text-neutral-400 hover:text-neutral-600">
          Cerrar
        </button>
      </div>

      <div>
        <div className="text-[11px] font-medium text-neutral-700 mb-1">¿Quién lo va a leer?</div>
        <div className="flex flex-wrap gap-1.5">
          {DESTINOS.map((d) => (
            <button
              key={d.clave}
              type="button"
              onClick={() => setDestino(d.clave)}
              title={d.ayuda}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors ${
                destino === d.clave
                  ? "border-neutral-800 bg-neutral-800 text-white"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {d.rotulo}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-neutral-400 mt-1">{DESTINOS.find((d) => d.clave === destino)?.ayuda}</p>
      </div>

      <textarea
        className={TA}
        rows={3}
        maxLength={MAX_PETICION}
        placeholder="Escríbele un correo a la familia explicando el ejercicio de soplo que hemos hecho hoy y cómo repetirlo en casa…"
        value={peticion}
        onChange={(e) => setPeticion(e.target.value)}
      />

      <div>
        <div className="text-[11px] font-medium text-neutral-700 mb-1">Qué le mandas de este registro</div>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {fuentes.map((f) => (
            <label
              key={f.clave}
              className={`flex items-start gap-2 text-[11px] ${f.bloqueada ? "text-neutral-300" : "text-neutral-600"}`}
              title={f.bloqueada || f.aviso || undefined}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!!f.bloqueada}
                checked={elegidas.has(f.clave)}
                onChange={(e) => {
                  const s = new Set(elegidas);
                  if (e.target.checked) s.add(f.clave);
                  else s.delete(f.clave);
                  setMarcadas(s);
                }}
              />
              <span>
                {f.rotulo}
                {f.de === "paciente" && <span className="text-neutral-300"> · de la ficha</span>}
                {f.bloqueada && <span className="block text-[10px] text-amber-600">{f.bloqueada}</span>}
                {f.aviso && !f.bloqueada && <span className="block text-[10px] text-amber-600">{f.aviso}</span>}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={pedir}
          disabled={pidiendo || !peticion.trim()}
          className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {pidiendo ? "Escribiendo…" : "Pedírselo"}
        </button>
        {aviso && <span className="text-[11px] text-amber-700">{aviso}</span>}
      </div>

      {texto && (
        <div className="border-t border-neutral-100 pt-3 space-y-2">
          <div className="text-[11px] font-medium text-neutral-700">
            El borrador. Léelo y cámbialo antes de usarlo.
          </div>
          <textarea className={TA} rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copiar}
              className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-300 text-neutral-700 hover:border-neutral-400"
            >
              {copiado ? "Copiado" : "Copiar"}
            </button>
            {onPegar && apartadosPegables.length > 0 && (
              <>
                <select
                  value={donde}
                  onChange={(e) => setDonde(e.target.value)}
                  className="rounded-md border border-neutral-200 px-2 py-1.5 text-[11px] text-neutral-600"
                  aria-label="Apartado donde pegarlo"
                >
                  <option value="">Pegarlo en un apartado…</option>
                  {apartadosPegables.map((b) => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!donde}
                  onClick={() => {
                    onPegar(donde, texto);
                    setDonde("");
                    setCopiado(false);
                    setAviso("Pegado. Acuérdate de guardar el registro.");
                  }}
                  className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-300 text-neutral-700 hover:border-neutral-400 disabled:opacity-40"
                >
                  Pegar
                </button>
              </>
            )}
            <span className="text-[10px] text-neutral-400 ml-auto">
              De aquí no se envía nada: cópialo y mándalo desde Correo o desde donde toque.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
