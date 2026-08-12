"use client";

import { useEffect, useState } from "react";

/**
 * Buscador de pacientes para el alta manual de citas.
 *
 * POR QUÉ EXISTE (2026-07-22, petición de Rodrigo): el alta manual pedía
 * nombre, email y teléfono como tres campos de texto libre. Además del trabajo
 * de teclearlo todo, bastaba escribir el correo con una mayúscula distinta a
 * la de la ficha para que la cita NO apareciera luego en ella — el cruce
 * ficha↔citas se hacía comparando cadenas de email.
 *
 * Ahora se escribe y se filtra entre las fichas de cliente, al elegir una se
 * rellenan solos el email y el teléfono, y la cita queda ENLAZADA a esa ficha
 * por clave real. Donde el centro marca quién es paciente desde la ficha
 * (nutrición o clínica) la lista se acota a esos; donde esa marca no la usa
 * nadie, se ofrecen todos — ver `/api/citas/clientes`.
 *
 * CON SALIDA A PROPÓSITO: si la persona no está en la lista se puede seguir
 * escribiendo el nombre a mano y crear la cita igual. Es el caso de quien
 * llama por teléfono sin ser cliente todavía; un desplegable cerrado dejaría
 * a la usuaria sin poder darle hora, que es peor problema que el que resuelve.
 *
 * Compartido a propósito entre `modules/default/CitasModule` (Aumenta y demás)
 * y `modules/overrides/nutri-laura/CitasModule`: el comportamiento debe ser el
 * mismo en las dos clínicas.
 *
 * Props:
 *   nombre         texto actual del campo
 *   vinculadaA     id de la ficha enlazada, o null
 *   onEscribir     (texto) => void — teclear rompe el enlace anterior
 *   onElegir       (cliente) => void — { id, name, email, phone }
 *   onDesvincular  () => void
 *   etiqueta       texto de la etiqueta (por defecto "Paciente *")
 */
export default function BuscadorPaciente({
  nombre,
  vinculadaA,
  onEscribir,
  onElegir,
  onDesvincular,
  etiqueta = "Paciente *",
}) {
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [soloPacientes, setSoloPacientes] = useState(true);

  // Búsqueda con freno: una petición por pausa al teclear, no por tecla.
  useEffect(() => {
    if (vinculadaA) return undefined;
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/citas/clientes?q=${encodeURIComponent(nombre || "")}`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!vivo) return;
        const datos = j.data || j;
        setResultados(Array.isArray(datos?.clientes) ? datos.clientes : []);
        setSoloPacientes(datos?.soloPacientes !== false);
      } catch {
        if (vivo) setResultados([]);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [nombre, vinculadaA]);

  return (
    <div className="relative">
      <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        {etiqueta}
      </label>

      {vinculadaA ? (
        <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
          </svg>
          <span className="text-sm text-emerald-900 font-medium flex-1 min-w-0 truncate">{nombre}</span>
          <span className="text-[10px] text-emerald-700 uppercase tracking-wide hidden sm:inline">
            ficha enlazada
          </span>
          <button
            type="button"
            onClick={onDesvincular}
            className="text-xs text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
          >
            cambiar
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={nombre}
            onChange={(e) => { onEscribir(e.target.value); setAbierto(true); }}
            onFocus={() => setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 180)}
            placeholder="Escribe para buscar entre tus pacientes…"
            autoComplete="off"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
          />

          {abierto && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
              {buscando && <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>}

              {!buscando && resultados.length === 0 && (
                <div className="px-3 py-2.5 text-xs text-gray-500 leading-relaxed">
                  {nombre?.trim() ? (
                    <>Nadie con ese nombre. Puedes <strong>seguir escribiendo</strong> y crear la cita igual.</>
                  ) : (
                    /*
                     * Con la caja vacía y sin resultados solo puede pasar una
                     * cosa: que no haya ninguna ficha todavía. El cartel que
                     * había aquí («aún no hay pacientes con módulo asistencial
                     * activado») salía en centros con mil fichas, porque el
                     * servidor filtraba por una marca que allí no usa nadie —
                     * ya no filtra (ver `/api/citas/clientes`).
                     */
                    <>Todavía no hay ninguna ficha de cliente. Puedes escribir el nombre y crear la cita igual.</>
                  )}
                </div>
              )}

              {!buscando && resultados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  // mousedown antes que blur: sin esto el desplegable se cierra
                  // antes de que el click llegue a registrarse.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onElegir(c); setAbierto(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                >
                  <div className="text-sm text-gray-900 font-medium truncate">{c.name}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "sin email ni teléfono en la ficha"}
                  </div>
                </button>
              ))}

              {!buscando && soloPacientes && resultados.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-gray-400 bg-gray-50 sticky bottom-0">
                  Solo pacientes de nutrición o clínica
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
