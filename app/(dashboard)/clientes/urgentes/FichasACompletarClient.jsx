"use client";

/**
 * Fichas a completar — los huecos de datos, por carpetas desplegables.
 *
 * Sale de la migración de Aumenta (Rodrigo, 03/08/2026): al traer 1.083
 * familias de Organízate quedaron miles de huecos —pacientes sin terapeuta,
 * familias sin teléfono— y no había ningún sitio donde verlos juntos.
 *
 * Tres decisiones de la pantalla:
 *
 * · DOS BLOQUES. Arriba lo que rompe algo esta semana (decenas de filas, se
 *   puede terminar); abajo la ficha incompleta (miles, es una campaña). Si
 *   todo saliera junto, lo urgente quedaría enterrado y nadie volvería a abrir
 *   la pantalla.
 * · CARPETAS con su total a la derecha, cerradas por defecto. Abrir la pantalla
 *   no debe ser recibir 3.700 nombres a la cara.
 * · Cada fila se puede marcar REVISADA. Hay huecos correctos —un paciente en
 *   lista de espera no tiene terapeuta— y sin poder archivarlos la pantalla no
 *   llega a cero nunca.
 * · LAS FICHAS ARCHIVADAS NO SALEN (25/08/2026, Lau). Eran 134 de las 171 del
 *   bloque rojo. La casilla de arriba las devuelve, y el criterio y su excepción
 *   —quien está de baja pero tiene hora cogida sí sale, marcado— viven en
 *   `lib/clients/urgentes.js`, no aquí: el total de la carpeta se cuenta con la
 *   misma regla con la que se traen las filas.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { colaDeVuelta } from "@/lib/clients/volver.js";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const fmt = (v) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v || "—";
  return new Date(v + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
};

function Carpeta({ carpeta, abierta, onToggle, onRevisar, onNoVino, conEstado, marcando }) {
  const vacia = carpeta.total === 0;
  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${carpeta.bloquea && !vacia ? "border-amber-200" : "border-neutral-200"}`}>
      <button
        onClick={onToggle}
        disabled={vacia}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition disabled:hover:bg-white"
      >
        <span className={`text-neutral-400 text-xs transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[13px] font-medium ${vacia ? "text-neutral-400" : "text-neutral-800"}`}>
            {carpeta.label}
          </span>
          <span className="block text-[11px] text-neutral-500 mt-0.5">{carpeta.ayuda}</span>
        </span>
        <span
          className={`shrink-0 text-[12px] font-medium tabular px-2.5 py-1 rounded-full ${
            vacia ? "bg-emerald-50 text-emerald-700"
              : carpeta.bloquea ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {vacia ? "✓ 0" : carpeta.total}
        </span>
      </button>

      {abierta && carpeta.filas.length > 0 && (
        <div className="border-t border-neutral-100 overflow-x-auto">
          {/* Lo que más se pregunta: por qué el número no baja solo. */}
          <div className="px-4 pt-3 text-[11px] text-neutral-500 flex items-center gap-1.5">
            <span>Rellena el dato en la ficha, o márcalo con «Está bien así».</span>
            <HelpTooltip title="«Está bien así»" placement="bottom">
              Marca esa fila como revisada y la saca de la lista, SIN inventarse el dato. Es para
              los huecos que son correctos: alguien en lista de espera no tiene terapeuta todavía,
              y no lo va a tener.
              {" "}
              <strong className="text-white">Sin esto la lista no llega a cero nunca</strong>,
              porque siempre quedarían huecos que en realidad están bien. No cambia nada de la
              ficha: solo dice «esto ya lo he mirado».
            </HelpTooltip>
          </div>
          <table className="w-full text-[12.5px]">
            <tbody>
              {carpeta.filas.map((f) => (
                <tr key={f.id} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-2">
                    {/* El enlace se lleva puesto de dónde sale, para que la
                        flecha de la ficha vuelva AQUÍ y con esta carpeta
                        abierta (26/08/2026, Lau). La cola la escribe
                        `colaDeVuelta`, no esta plantilla, para que el nombre
                        del parámetro viva en un solo sitio. */}
                    <Link
                      href={
                        (carpeta.entidad === "patient" ? `/pacientes/${f.id}` : `/clientes/${f.id}`) +
                        colaDeVuelta("urgentes", carpeta.key)
                      }
                      className="font-medium text-[var(--color-primary,#1B3A2D)] hover:underline"
                    >
                      {f.nombre}
                    </Link>
                    {f.familia && carpeta.entidad === "patient" && (
                      <span className="text-neutral-400"> · {f.familia}</span>
                    )}
                    {/* Una ficha de baja que aun así sale es la que tiene horas
                        cogidas en la agenda. Sin decirlo, parece que el filtro
                        no funciona; dicho, es el aviso de que hay que anular
                        esas citas o reactivar la ficha. */}
                    {f.de_baja && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-500 align-middle"
                        title="La ficha está dada de baja. Sale porque tiene citas reservadas."
                      >
                        Archivada
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-500 whitespace-nowrap">{fmt(f.dato)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {/*
                      «No vino» aquí y no solo en la ficha (26/08/2026, Lau).
                      Eran 90 fichas mudas sin una sola cita: abrir noventa
                      fichas para tocar un desplegable no lo hace nadie, y por
                      eso la petición había llegado como «bórralas».

                      Solo en las carpetas de FAMILIA: el estado es de la ficha,
                      y marcarlo desde la fila de un hijo diría que no vino toda
                      la familia por lo que le falta a uno.

                      Sin confirmación, igual que «Está bien así», que está al
                      lado y también hace desaparecer la fila: se deshace desde
                      la ficha, y la casilla de arriba las devuelve a la vista.
                    */}
                    {conEstado && carpeta.entidad === "client" && (
                      <button
                        onClick={() => onNoVino(carpeta, f)}
                        disabled={marcando === `${carpeta.key}|${f.id}`}
                        title="Llamó o dejó sus datos pero nunca llegó a empezar. La ficha se queda entera; solo deja de reclamar lo que le falta."
                        className="mr-3 text-[11px] text-amber-700 hover:text-amber-900 underline disabled:opacity-40"
                      >
                        No vino
                      </button>
                    )}
                    <button
                      onClick={() => onRevisar(carpeta, f)}
                      disabled={marcando === `${carpeta.key}|${f.id}`}
                      className="text-[11px] text-neutral-500 hover:text-neutral-800 underline disabled:opacity-40"
                    >
                      {marcando === `${carpeta.key}|${f.id}` ? "…" : "Está bien así"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {carpeta.total > carpeta.filas.length && (
            <div className="px-4 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">
              Se ven las {carpeta.filas.length} primeras de {carpeta.total}. Ve cerrando y aparecerán las siguientes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FichasACompletarClient({ conEstado = false }) {
  const [datos, setDatos] = useState(null);
  /*
   * La carpeta con la que se vuelve de una ficha nace ABIERTA (26/08/2026).
   *
   * Sin esto, la mitad del arreglo se pierde: la flecha te trae de vuelta a
   * esta pantalla, pero con todas las carpetas cerradas, así que hay que buscar
   * otra vez por dónde ibas. Se lee de la URL una sola vez —en el valor inicial
   * del estado— y no en un efecto: si se abriera en un efecto, cerrarla a mano
   * la volvería a abrir en la siguiente vuelta del render.
   */
  const query = useSearchParams();
  const [abiertas, setAbiertas] = useState(() => {
    const key = query.get("carpeta");
    return new Set(key ? [key] : []);
  });
  const [cargando, setCargando] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [marcando, setMarcando] = useState(null);
  const [incluirBajas, setIncluirBajas] = useState(false);

  /**
   * Número de petición, para que una respuesta vieja no pise a la nueva.
   *
   * Esta consulta tarda ~4 s en Aumenta (medido: 3.997 ms). Marcar y desmarcar
   * la casilla dentro de esos 4 s deja dos peticiones en vuelo, y si la primera
   * llega la última, la pantalla se queda enseñando las fichas archivadas con
   * la casilla apagada —justo el estado que este cambio venía a quitar— sin
   * nada que lo explique. Con el contador, la que ya no es la última se tira.
   */
  const peticion = useRef(0);

  const cargar = useCallback(async () => {
    const mia = ++peticion.current;
    setCargando(true);
    try {
      const r = await fetch(`/api/clients/urgentes${incluirBajas ? "?incluirBajas=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (peticion.current !== mia) return;
      if (!j.ok) throw new Error(j.error || "No se pudo cargar");
      setDatos(j.data);
      setErrorMsg(null);
    } catch (e) {
      if (peticion.current !== mia) return;
      setErrorMsg(e.message);
    } finally {
      // El «Cargando…» solo lo apaga la última: si lo apagara la primera en
      // llegar, la pantalla diría que ya está mientras la otra sigue viva.
      if (peticion.current === mia) setCargando(false);
    }
  }, [incluirBajas]);

  useEffect(() => { cargar(); }, [cargar]);

  function toggle(key) {
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }

  /**
   * Marcar la ficha como «No vino» sin salir de la pantalla.
   *
   * Escribe en la COLUMNA `clients.status` por la misma puerta que la ficha
   * (`estado`, no `status`: ahí `status` es el embudo comercial). La fila
   * desaparece de la carpeta porque «No vino» deja de reclamar datos
   * (`dejaDeReclamar`, en `lib/clients/estados.js`), y vuelve con la casilla de
   * arriba.
   */
  async function marcarNoVino(carpeta, fila) {
    const clientId = fila.client_id ?? fila.id;
    if (!clientId) return;
    const id = `${carpeta.key}|${fila.id}`;
    setMarcando(id);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "prospect" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `No se pudo marcar (HTTP ${r.status})`);
      await cargar();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setMarcando(null);
    }
  }

  async function revisar(carpeta, fila) {
    const id = `${carpeta.key}|${fila.id}`;
    setMarcando(id);
    try {
      await fetch("/api/clients/urgentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkKey: carpeta.key, entityId: fila.id, entidad: carpeta.entidad }),
      });
      await cargar();
    } finally {
      setMarcando(null);
    }
  }

  const todoOk = datos && datos.totalBloquea === 0 && datos.totalCompletar === 0;

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <div>
        <h1 className="text-lg font-semibold text-neutral-800 flex items-center gap-2">
          Fichas a completar
          <HelpTooltip title="Fichas a completar" placement="bottom">
            Datos que faltan en las fichas, agrupados por carpetas. Al importar cientos de
            familias quedan miles de huecos, así que esto no está pensado para vaciarse de una
            sentada: se abre una carpeta, se cierran unas cuantas y se deja.
            {" "}
            <strong className="text-white">Las carpetas no se solapan</strong>: cada ficha aparece
            en una sola —la más urgente que le toque—, para que no la arregles dos veces. Si al
            rellenar ese hueco le queda otro, reaparece en la carpeta que le corresponda.
          </HelpTooltip>
        </h1>
        <p className="text-[12.5px] text-neutral-500 mt-0.5">
          Datos que faltan en las fichas. Lo de arriba rompe algo esta semana; lo de abajo
          se puede ir cerrando poco a poco.
        </p>

        <label className="mt-3 inline-flex items-center gap-2 text-[12px] text-neutral-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={incluirBajas}
            onChange={(e) => setIncluirBajas(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
          />
          Incluir bajas y «No vino»
          <HelpTooltip title="Fichas que no reclaman" placement="bottom">
            Las fichas de quien ya no viene —«Baja»— y las de quien nunca llegó a empezar
            —«No vino»— no salen: sus huecos ya no hay que rellenarlos, y estaban enterrando
            lo que sí hay que mirar esta semana.
            {" "}
            <strong className="text-white">Con una excepción</strong>: quien está de baja pero
            tiene citas reservadas sí aparece, marcado como «Archivada». Ahí el problema no es el
            dato que falta — es que hay horas cogidas en la agenda de alguien que ya no viene.
          </HelpTooltip>
        </label>
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}
      {cargando && <div className="text-[12.5px] text-neutral-400">Cargando…</div>}

      {todoOk && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
          <div className="text-emerald-800 font-medium text-sm">No queda ninguna ficha a medias.</div>
          <div className="text-[12px] text-emerald-700 mt-1">Todo revisado. Buen trabajo.</div>
        </div>
      )}

      {datos && !todoOk && (
        <>
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-amber-800 flex items-center gap-1.5">
                Bloquea el trabajo
                <HelpTooltip title="Bloquea el trabajo" placement="bottom">
                  Huecos que impiden hacer algo esta semana: una cita que nadie puede atender, una
                  familia a la que no se puede facturar. Son pocos y hay que cerrarlos ya. Si esta
                  parte se llena de cosas que en realidad esperan, deja de mirarse.
                </HelpTooltip>
              </h2>
              <span className="text-[11px] text-neutral-400">{datos.totalBloquea} pendiente(s)</span>
            </div>
            {datos.bloquea.map((c) => (
              <Carpeta
                key={c.key} carpeta={c} abierta={abiertas.has(c.key)}
                onToggle={() => toggle(c.key)} onRevisar={revisar} onNoVino={marcarNoVino}
                conEstado={conEstado} marcando={marcando}
              />
            ))}
            {/* Las citas sin profesional ya tienen su pantalla, con asignación en
                bloque. Se enlaza en vez de repetirla aquí a medias. */}
            <Link
              href="/citas/sin-profesional"
              className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:bg-neutral-50 transition"
            >
              <span className="text-[13px] font-medium text-neutral-800">Citas del curso sin profesional →</span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                Se asignan en bloque desde Citas → Sin profesional.
              </span>
            </Link>
          </section>

          <section className="space-y-2 pt-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-neutral-700 flex items-center gap-1.5">
                Ficha incompleta
                <HelpTooltip title="Ficha incompleta" placement="bottom">
                  Datos que faltan pero no impiden trabajar hoy: un teléfono, una fecha de
                  nacimiento. Aquí hay miles y va a seguir habiéndolos — está separado del bloque
                  de arriba justo para que lo urgente no se pierda entre lo que puede esperar.
                </HelpTooltip>
              </h2>
              <span className="text-[11px] text-neutral-400">{datos.totalCompletar} pendiente(s)</span>
            </div>
            {datos.completar.map((c) => (
              <Carpeta
                key={c.key} carpeta={c} abierta={abiertas.has(c.key)}
                onToggle={() => toggle(c.key)} onRevisar={revisar} onNoVino={marcarNoVino}
                conEstado={conEstado} marcando={marcando}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
