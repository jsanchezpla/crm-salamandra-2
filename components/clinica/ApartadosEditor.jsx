"use client";

/**
 * ApartadosEditor — donde se escribe un documento clínico: título, cuerpo,
 * título, cuerpo (29/08/2026, Aumenta por Rodrigo).
 *
 * (Componente propio y no dentro de cada pantalla: lo comparten el cajón del
 * INFORME y el formulario del REGISTRO DE SESIÓN, que son los dos documentos
 * que se componen por apartados. Con una copia en cada sitio, añadir un
 * apartado se comportaría distinto según por dónde entres.)
 *
 * Dos modos, y el de partida es el de siempre:
 *
 *   · Cerrado: los apartados de la plantilla con su título y su textarea. Un
 *     centro que no ha tocado nada ve exactamente el formulario de antes.
 *   · «Ordenar apartados»: renombrar, cambiar de párrafo a lista, subir, bajar,
 *     quitar y AÑADIR. Todo eso vale solo para ESTE documento —se aplica aquí y
 *     no se guarda en ninguna plantilla—, que es justo lo que se pidió para los
 *     casos concretos. Guardar la plantilla es cosa de Configuración, y de
 *     dirección.
 *
 * Lo que se escribe viaja como texto en los dos tipos: en los de lista, una
 * línea por viñeta. La conversión no está aquí sino en
 * `lib/clinica/plantillas.js` (`aFormulario` / `desdeFormulario`), para que el
 * informe y el registro la hagan igual.
 */

import { useState } from "react";
import { TIPOS_APARTADO, slugApartado } from "@/lib/clinica/plantillas.js";

const TA = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";
const TIPO_LABEL = { texto: "Párrafo", lista: "Lista" };

function IconoFlecha({ arriba }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
      <path strokeLinecap="round" strokeLinejoin="round" d={arriba ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
    </svg>
  );
}

export default function ApartadosEditor({
  apartados,
  valores,
  onValor,
  onApartados,
  plantillas = [],
  plantillaKey = "",
  onPlantilla,
  disabled = false,
  // ¿Se pueden tocar los apartados (renombrar, mover, quitar, añadir)? El
  // informe de BECA dice que no: sus tres apartados los manda la convocatoria.
  // Ojo, esto no bloquea escribir — solo la lista.
  permiteOrdenar = true,
  // Pista bajo el título de un apartado concreto, por clave. La usa el informe
  // para explicar de dónde sale lo volcado.
  ayudas = {},
  // Apartados que la plantilla trae de serie: los demás se marcan como propios
  // de este documento, para que se vea qué se está añadiendo a mano.
  clavesDePlantilla = null,
}) {
  const [ordenando, setOrdenando] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState("texto");

  const lista = Array.isArray(apartados) ? apartados : [];
  const deSerie = clavesDePlantilla instanceof Set ? clavesDePlantilla : null;
  // Aunque el estado se quede encendido, sin permiso no se ordena nada.
  const enOrden = ordenando && permiteOrdenar;

  const cambiar = (i, cambios) => {
    onApartados(lista.map((a, idx) => (idx === i ? { ...a, ...cambios } : a)));
  };

  const mover = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    onApartados(copia);
  };

  const quitar = (i) => {
    // Lo escrito no se borra de la bolsa de valores: si el apartado vuelve,
    // vuelve con su texto. Del documento solo desaparece el apartado.
    onApartados(lista.filter((_, idx) => idx !== i));
  };

  const anadir = () => {
    const label = nuevoTitulo.trim();
    if (!label) return;
    // La clave se calcula AQUÍ y no al guardar porque hay que escribir en ella
    // mientras se teclea. Es la misma función que usa el servidor, así que el
    // apartado se guarda donde el navegador ya estaba escribiendo.
    const base = slugApartado(label) || "apartado";
    const usadas = new Set(lista.map((a) => a.key));
    let key = base;
    let n = 2;
    while (usadas.has(key)) key = `${base}_${n++}`;
    onApartados([...lista, { key, label, tipo: nuevoTipo }]);
    setNuevoTitulo("");
    setNuevoTipo("texto");
  };

  return (
    <div className="space-y-4">
      {/* ── Barra: qué plantilla y el interruptor de ordenar ─────────────── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        {plantillas.length > 1 && onPlantilla && permiteOrdenar ? (
          <label className="flex items-center gap-2 text-[11px] text-neutral-500">
            Plantilla
            <select
              className="px-2 py-1.5 text-[11px] border border-neutral-200 rounded-lg bg-white focus:outline-none focus:border-neutral-400"
              value={plantillaKey}
              disabled={disabled}
              onChange={(e) => onPlantilla(e.target.value)}
            >
              {plantillas.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-[11px] text-neutral-400">
            {plantillas[0]?.name ?? "Apartados"}
          </span>
        )}
        {permiteOrdenar && (
          <button
            type="button"
            onClick={() => setOrdenando((v) => !v)}
            disabled={disabled}
            className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40"
          >
            {ordenando ? "Terminar de ordenar" : "Ordenar apartados"}
          </button>
        )}
      </div>

      {enOrden && (
        <p className="text-[10px] text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 leading-relaxed">
          Lo que cambies aquí vale <span className="font-medium text-neutral-500">solo para este
          documento</span>: se aplica al guardarlo y no toca la plantilla del centro. Los títulos son
          los que saldrán impresos en el PDF.
        </p>
      )}

      {lista.length === 0 && (
        <p className="text-[11px] text-neutral-400">
          Este documento no tiene apartados. Añade el primero abajo.
        </p>
      )}

      {/* ── Los apartados ────────────────────────────────────────────────── */}
      {lista.map((a, i) => {
        const propio = deSerie ? !deSerie.has(a.key) : false;
        return (
          <div key={a.key ?? `nuevo-${i}`} className={enOrden ? "border border-neutral-200 rounded-lg p-3" : ""}>
            {enOrden ? (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  className="flex-1 min-w-[10rem] px-2 py-1.5 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400"
                  value={a.label}
                  disabled={disabled}
                  onChange={(e) => cambiar(i, { label: e.target.value })}
                  placeholder="Título del apartado"
                />
                <select
                  className="px-2 py-1.5 text-[11px] border border-neutral-200 rounded-lg bg-white focus:outline-none focus:border-neutral-400"
                  value={a.tipo}
                  disabled={disabled}
                  onChange={(e) => cambiar(i, { tipo: e.target.value })}
                >
                  {TIPOS_APARTADO.map((t) => (
                    <option key={t} value={t}>{TIPO_LABEL[t] ?? t}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => mover(i, -1)} disabled={disabled || i === 0}
                    className="p-1.5 rounded-md border border-neutral-200 text-neutral-500 hover:border-neutral-400 disabled:opacity-30" aria-label="Subir">
                    <IconoFlecha arriba />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={disabled || i === lista.length - 1}
                    className="p-1.5 rounded-md border border-neutral-200 text-neutral-500 hover:border-neutral-400 disabled:opacity-30" aria-label="Bajar">
                    <IconoFlecha />
                  </button>
                  <button type="button" onClick={() => quitar(i)} disabled={disabled}
                    className="text-[11px] px-2 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <div className="eyebrow mb-1">
                {a.label}
                {propio && (
                  <span className="normal-case tracking-normal text-neutral-300"> · solo en este documento</span>
                )}
              </div>
            )}

            {(ayudas[a.key] || a.tipo === "lista") && (
              <p className="text-[10px] text-neutral-400 mb-1.5">
                {ayudas[a.key] ?? "Uno por línea."}
              </p>
            )}
            <textarea
              rows={a.tipo === "lista" ? 4 : 3}
              className={TA}
              disabled={disabled}
              value={valores[a.key] ?? ""}
              onChange={(e) => onValor(a.key, e.target.value)}
            />
          </div>
        );
      })}

      {/* ── Añadir uno suelto ────────────────────────────────────────────── */}
      {enOrden && (
        <div className="border border-dashed border-neutral-300 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Añadir apartado</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="flex-1 min-w-[10rem] px-2 py-1.5 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400"
              value={nuevoTitulo}
              disabled={disabled}
              placeholder="Título del apartado nuevo"
              onChange={(e) => setNuevoTitulo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } }}
            />
            <select
              className="px-2 py-1.5 text-[11px] border border-neutral-200 rounded-lg bg-white focus:outline-none focus:border-neutral-400"
              value={nuevoTipo}
              disabled={disabled}
              onChange={(e) => setNuevoTipo(e.target.value)}
            >
              {TIPOS_APARTADO.map((t) => (
                <option key={t} value={t}>{TIPO_LABEL[t] ?? t}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={anadir}
              disabled={disabled || !nuevoTitulo.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              Añadir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
