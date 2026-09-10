"use client";

import { useEffect, useState } from "react";

import { rotuloDePacientes } from "../../lib/clients/buscarFichas.js";

/**
 * Quién viene a consulta en esta ficha, y qué se lee en la primera línea.
 *
 * Dos listas, y en este orden: `pacientes` son los que han hecho la
 * coincidencia —si se ha tecleado «thiago», ese es el que hay que leer— y
 * `pacientesFicha` los de la familia, para cuando se ha buscado por el apellido
 * de la madre y ninguno casa. La regla de cuántos caben y en qué orden es la
 * misma que la de los desplegables (`lib/clients/buscarFichas.js`).
 *
 * Una ficha sin pacientes —un adulto que es su propia ficha, una empresa— se
 * lee por su nombre, que es todo lo que hay.
 */
function pacientesDeLaFicha(ficha) {
  const casan = Array.isArray(ficha?.pacientes) ? ficha.pacientes : [];
  return casan.length ? casan : ficha?.pacientesFicha;
}

const tienePacientes = (ficha) => Boolean(rotuloDePacientes({ pacientes: pacientesDeLaFicha(ficha) }));
const rotuloDeLaFicha = (ficha) =>
  rotuloDePacientes({ pacientes: pacientesDeLaFicha(ficha) }) || ficha?.name || "";

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
 * Y SE BUSCA TAMBIÉN POR EL NOMBRE DEL HIJO (28/08/2026, Lau de Aumenta):
 * recepción teclea el nombre de quien viene a la sesión, no el de la familia
 * que paga. Escribir «thiago» respondía «Nadie con ese nombre» aunque el
 * paciente estuviera dado de alta — de los 1.174 pacientes de Aumenta, 934 no
 * se podían encontrar así. Cada ficha se lee POR SU PACIENTE, con la familia
 * debajo (10/09/2026): es el nombre que se teclea y el que hay que reconocer.
 *
 * CON SALIDA A PROPÓSITO: si la persona no está en la lista se puede seguir
 * escribiendo el nombre a mano y crear la cita igual. Es el caso de quien
 * llama por teléfono sin ser cliente todavía; un desplegable cerrado dejaría
 * a la usuaria sin poder darle hora, que es peor problema que el que resuelve.
 *
 * Y esa salida es justo la razón de que las fichas ARCHIVADAS también salgan
 * (25/08/2026): si no salieran, quien vuelve a los dos meses no se encontraría,
 * recepción tiraría de la salida a mano y la cita nacería suelta de su ficha —
 * el fallo que este buscador vino a arreglar. Salen marcadas y al final.
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
  const [hayMas, setHayMas] = useState(false);

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
        setHayMas(Boolean(datos?.hayMas));
      } catch {
        if (vivo) { setResultados([]); setHayMas(false); }
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
                  <div className="flex items-center gap-1.5">
                    {/*
                      PRIMERO EL PACIENTE (10/09/2026, Rodrigo: «en los
                      buscadores debería salir el paciente primero»). Quien
                      teclea en recepción escribe el nombre del niño; leerlo en
                      la tercera línea de cada resultado, debajo de un apellido
                      que no reconoce, es justo el trabajo que este buscador
                      venía a ahorrar. La familia baja a la línea de debajo, que
                      es donde hace falta para saber a quién se le cobra.
                    */}
                    <span className="text-sm text-gray-900 font-medium truncate">{rotuloDeLaFicha(c)}</span>
                    {/* Archivada = dada de baja desde su ficha. Sale igual, y al
                        final de la lista, para que quien vuelve a los dos meses
                        se pueda enlazar a SU ficha en vez de acabar en una cita
                        suelta. El distintivo es el mismo que en Clientes. */}
                    {c.status === "inactive" && (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500"
                        title="Ficha archivada. Se le puede dar hora igual; si vuelve, reactívala desde su ficha."
                      >
                        Archivada
                      </span>
                    )}
                  </div>
                  {/*
                    DE QUIÉN ES LA FICHA (28/08/2026, Lau de Aumenta; orden
                    cambiado el 10/09/2026). Al buscar por el nombre del hijo,
                    la ficha que aparece es la de la familia — y sin decirlo,
                    quien teclea «thiago» ve un apellido que no reconoce y da
                    por hecho que no es. Ahora arriba va el niño y aquí la
                    familia, que es a quien se le cobra; cuando la ficha no
                    tiene pacientes, arriba ya está su nombre y esta línea
                    sobra.
                  */}
                  {tienePacientes(c) && (
                    <div className="text-[11px] text-[var(--color-primary,#1B3A2D)] truncate">
                      {c.name}
                    </div>
                  )}
                  <div className="text-[11px] text-gray-500 truncate">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "sin email ni teléfono en la ficha"}
                  </div>
                </button>
              ))}

              {/* «Hay más de los que caben». Sin esto, una lista llena y una
                  lista completa se ven igual: quien no encuentra a alguien da
                  por hecho que no está y escribe el nombre a mano, y así nacen
                  las citas sin ficha. */}
              {!buscando && hayMas && (
                <div className="px-3 py-1.5 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-100">
                  Hay más fichas que coinciden. Escribe un poco más del nombre.
                </div>
              )}

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
