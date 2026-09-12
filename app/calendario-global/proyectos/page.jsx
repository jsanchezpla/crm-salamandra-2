"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MarcoGlobal from "../../../components/calendario-global/MarcoGlobal.jsx";
import SelectorClientes from "../../../components/calendario-global/SelectorClientes.jsx";
import Aviso from "../../../components/calendario-global/Aviso.jsx";
import Chip from "../../../components/calendario-global/Chip.jsx";
import BarraAvance from "../../../components/calendario-global/BarraAvance.jsx";
import BotonAbrirCrm from "../../../components/calendario-global/BotonAbrirCrm.jsx";
import { IconoBuscar } from "../../../components/calendario-global/Iconos.jsx";
import { useClientes } from "../../../components/calendario-global/useClientes.js";
import { usePreferencia } from "../../../components/calendario-global/almacen.js";
import { pedirJson } from "../../../components/calendario-global/api.js";
import { FOCO } from "../../../components/calendario-global/estilos.js";
import { ESTADO_PROYECTO, diaCorto, hoyMadrid, notaDelSalto } from "../../../components/calendario-global/formato.js";

/**
 * Pestaña «Proyectos» del calendario global (12/09/2026, Rodrigo): «Debería
 * tener acceso a los proyectos también aparte de los calendarios».
 *
 * Los proyectos de todos los clientes que se miran, agrupados por cliente, en
 * una tabla densa: código, nombre (y para quién es), estado, avance, fecha
 * límite y tareas vencidas. Un clic en la fila abre su tablero aquí mismo
 * (`/calendario-global/proyectos/<slug>/<id>`), donde se mueven tarjetas y
 * fechas; la flecha de la derecha abre el proyecto en el CRM del cliente.
 *
 * ── LA MISMA SELECCIÓN QUE EL CALENDARIO ────────────────────────────────────
 * La barra lateral es la de la pestaña Calendario (`useClientes`): quien acota
 * a tres clientes allí los encuentra acotados aquí. Viaja al servidor en
 * `?slugs=` para no abrir la base de los que no se miran. Un cliente sin el
 * módulo Proyectos no sale en la lista; lo dice su pista en la barra.
 *
 * El avance es el mismo número que la ficha del proyecto en el CRM
 * (`lib/projects/faseProgreso.js`, calculado en el servidor).
 *
 * ── «ABRIR EN EL CRM» VA EN CADA FILA, NO EN LA CABECERA DEL CLIENTE ────────
 * El pase de salto solo sabe llevar a tres sitios (lista blanca de
 * `lib/calendario-global/salto.js`): el calendario, un proyecto o su tablero.
 * No hay «la lista de proyectos», y mandar desde aquí al calendario del
 * cliente sería dejarlo en otra pantalla —en uno sin Calendario, en una que no
 * puede abrir—. Así que la flecha va por proyecto, y la cabecera del cliente
 * dice una vez con qué cuenta se entrará o que no hay ninguna.
 */

const CLAVE_ESTADO = "calendario-global:proyectos:estado";

// Una sola rejilla para la cabecera y las filas: así las columnas cuadran.
// El `pr-11` deja sitio a la flecha del CRM, que va fuera del enlace (un botón
// dentro de un enlace no es válido y el lector de pantalla lo lee mal).
const REJILLA =
  "md:grid md:grid-cols-[84px_minmax(0,1fr)_96px_132px_92px_80px] md:items-center md:gap-3 pr-11";

// En una lista con esquinas redondeadas y `overflow-hidden`, el anillo de foco
// va por dentro o se recorta.
const FOCO_FILA = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3E5C57]";

function EsqueletoLista() {
  return (
    <div aria-label="Cargando proyectos" className="flex flex-col gap-3">
      {[4, 2].map((filas, g) => (
        <div key={g} className="rounded-[10px] border border-[#E7E7E1] bg-white overflow-hidden">
          <div className="h-10 px-3 flex items-center gap-2 border-b border-[#EDEDE8] bg-[#FBFBF9]">
            <span className="w-2.5 h-2.5 rounded-[3px] bg-[#E3E3DD]" />
            <span className="h-2.5 w-32 rounded bg-[#EDEDE8]" />
          </div>
          {Array.from({ length: filas }, (_, i) => (
            <div key={i} className="h-[52px] px-3 flex items-center gap-4 border-b last:border-b-0 border-[#F0F0EB]">
              <span className="hidden md:block h-2.5 w-14 rounded bg-[#EDEDE8]" />
              <span className="h-2.5 rounded bg-[#EDEDE8]" style={{ width: `${30 + ((i * 17) % 25)}%` }} />
              <span className="ml-auto h-1.5 w-24 rounded-full bg-[#EDEDE8]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FilaProyecto({ fila, ficha, hoy, onError }) {
  const estado = ESTADO_PROYECTO[fila.status] ?? ESTADO_PROYECTO.active;
  const cerrado = fila.status === "completed" || fila.status === "cancelled";
  const vencido = !cerrado && typeof fila.dueDate === "string" && fila.dueDate.slice(0, 10) < hoy;
  const vencidas = Number(fila.tareas?.vencidas) || 0;
  const hito = fila.proximoHito;
  const detalle = [
    fila.clientName,
    hito?.name ? `Próximo hito: ${hito.name}${hito.dueDate ? `, ${diaCorto(hito.dueDate, { conSemana: false })}` : ""}` : null,
  ].filter(Boolean);
  const href = `/calendario-global/proyectos/${encodeURIComponent(fila.slug)}/${encodeURIComponent(fila.id)}`;

  return (
    <li className="relative">
      <Link href={href} className={`block px-3 py-2.5 hover:bg-[#FAFAF7] ${REJILLA} ${FOCO_FILA}`}>
        <span className="hidden md:block truncate text-[12px] tabular-nums text-[#5C6461]" title={fila.code || undefined}>
          {fila.code || "—"}
        </span>
        <span className="block min-w-0">
          <span className="block truncate text-[13.5px] font-medium text-[#1C2B27]">
            {fila.code && <span className="md:hidden font-normal text-[#8A918E]">{fila.code} · </span>}
            {fila.name}
          </span>
          {detalle.length > 0 && (
            <span className="block truncate text-[12px] text-[#8A918E]">{detalle.join(" · ")}</span>
          )}
        </span>
        <span className="mt-1.5 md:mt-0 flex md:contents flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex">
            <Chip tono={estado.tono}>{estado.etiqueta}</Chip>
          </span>
          <BarraAvance valor={fila.avance} className="w-[132px] md:w-auto" />
          <span className={`text-[12.5px] tabular-nums ${vencido ? "text-[#A33A30]" : "text-[#3F4845]"}`}>
            {fila.dueDate ? (
              <>
                <span className="md:hidden text-[#8A918E]">Límite </span>
                {diaCorto(fila.dueDate, { conSemana: false })}
              </>
            ) : (
              <span className="text-[#B5BAB8]">Sin fecha</span>
            )}
          </span>
          <span className="text-[12.5px] tabular-nums">
            {vencidas > 0 ? (
              <span className="text-[#A33A30]">
                {vencidas} vencida{vencidas === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="hidden md:inline text-[#B5BAB8]">—</span>
            )}
          </span>
        </span>
      </Link>
      <div className="absolute right-2 top-2.5 md:top-1/2 md:-translate-y-1/2">
        <BotonAbrirCrm
          ficha={ficha}
          destino={{ tipo: "proyecto", projectId: fila.id }}
          variante="icono"
          texto={`Abrir ${fila.name} en el CRM`}
          onError={onError}
        />
      </div>
    </li>
  );
}

export default function ProyectosGlobalPage() {
  const seleccion = useClientes();
  const { clientes, visibles, fusionarFichas } = seleccion;
  const [estado, setEstado] = usePreferencia(CLAVE_ESTADO, "activos", ["activos", "todos"]);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState({ clave: null, datos: null, error: null });
  const [errorSalto, setErrorSalto] = useState(null);

  const listo = !seleccion.cargando && !seleccion.error;
  const slugs = visibles.join(",");
  const clave = listo && visibles.length > 0 ? `${slugs}|${estado}|${q}|${intento}` : null;

  // La búsqueda va al servidor, pero no con cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setQ(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    if (!clave) return undefined;
    const ctrl = new AbortController();
    const params = new URLSearchParams({ slugs, estado });
    if (q) params.set("q", q);
    pedirJson(`/api/calendario-global/proyectos?${params}`, { signal: ctrl.signal })
      .then((datos) => {
        setResultado({ clave, datos, error: null });
        // Las fichas frescas traen `fallo`: la barra marca «no responde».
        fusionarFichas(datos?.clientes);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setResultado({ clave, datos: null, error: e?.message || "No se han podido cargar los proyectos." });
      });
    return () => ctrl.abort();
  }, [clave, slugs, estado, q, fusionarFichas]);

  const cargando = Boolean(clave) && resultado.clave !== clave;
  // Mientras llega la respuesta nueva se sigue viendo la anterior (con la
  // franja de carga): así la lista no parpadea con cada letra del buscador.
  const datos = clave ? resultado.datos : null;
  const error = clave && !cargando ? resultado.error : null;
  const hoy = hoyMadrid();

  const fichaPorSlug = new Map(clientes.map((c) => [c.slug, c]));
  const grupos = (Array.isArray(datos?.clientes) ? datos.clientes : []).map((c) => {
    const filas = (datos?.proyectos ?? []).filter((p) => p.slug === c.slug);
    return { cliente: { ...(fichaPorSlug.get(c.slug) ?? {}), ...c }, filas };
  });
  const conFilas = grupos.filter((g) => g.filas.length > 0);
  const caidos = grupos.filter((g) => g.cliente.fallo);
  const vacios = grupos.filter((g) => !g.cliente.fallo && g.filas.length === 0);
  const totalProyectos = conFilas.reduce((n, g) => n + g.filas.length, 0);

  const sinClientes = listo && clientes.length === 0;
  const ningunoVisible = listo && clientes.length > 0 && visibles.length === 0;
  const ningunoConModulo = datos && grupos.length === 0;

  const lateral = <SelectorClientes seleccion={seleccion} modulo="proyectos" />;

  return (
    <MarcoGlobal lateral={lateral} contador={listo ? visibles.length : null}>
      <div className="w-full max-w-6xl flex flex-col gap-3 p-3 lg:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Buscar proyecto por nombre o código</span>
            <IconoBuscar className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9AA09D] pointer-events-none" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código"
              className="w-full h-8 pl-8 pr-2 rounded-md border border-[#E7E7E1] bg-white text-[13px] text-[#1C2B27] placeholder:text-[#9AA09D] focus:border-[#3E5C57] focus:outline-none"
            />
          </label>
          <div role="group" aria-label="Qué proyectos" className="inline-flex p-0.5 rounded-md border border-[#E7E7E1] bg-[#F2F2EE]">
            {[
              ["activos", "Activos"],
              ["todos", "Todos"],
            ].map(([valor, etiqueta]) => {
              const puesto = estado === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={puesto}
                  onClick={() => setEstado(valor)}
                  title={valor === "activos" ? "Borrador, activos y en pausa" : "También completados y cancelados"}
                  className={`h-7 px-2.5 rounded-[5px] text-[12.5px] ${
                    puesto ? "bg-white text-[#1C2B27] font-medium shadow-[0_0_0_1px_#E7E7E1]" : "text-[#5C6461] hover:text-[#1C2B27]"
                  } ${FOCO}`}
                >
                  {etiqueta}
                </button>
              );
            })}
          </div>
          {datos && (
            <span role="status" className="ml-auto text-[12.5px] tabular-nums text-[#8A918E]">
              {totalProyectos} proyecto{totalProyectos === 1 ? "" : "s"}
              {conFilas.length > 1 ? ` en ${conFilas.length} clientes` : ""}
            </span>
          )}
        </div>

        {seleccion.error && (
          <Aviso tono="error" accion={{ texto: "Reintentar", onClick: seleccion.reintentar }}>
            No se ha podido cargar la lista de clientes. {seleccion.error}
          </Aviso>
        )}
        {sinClientes && <Aviso tono="info">Tu cuenta no ve ningún cliente todavía.</Aviso>}
        {ningunoVisible && (
          <Aviso tono="info" accion={{ texto: "Ver todos", onClick: seleccion.todos }}>
            No hay ningún cliente a la vista.
          </Aviso>
        )}
        {error && (
          <Aviso tono="error" accion={{ texto: "Reintentar", onClick: () => setIntento((n) => n + 1) }}>
            {error}
          </Aviso>
        )}
        {errorSalto && (
          <Aviso tono="error" onCerrar={() => setErrorSalto(null)}>
            {errorSalto}
          </Aviso>
        )}

        <div className="relative">
          {cargando && datos && (
            <div role="status" aria-label="Actualizando" className="absolute left-3 right-3 -top-1.5 h-0.5 rounded-full bg-[#3E5C57]/40 animate-pulse" />
          )}

          {(seleccion.cargando || (cargando && !datos)) && <EsqueletoLista />}

          {ningunoConModulo && (
            <p className="px-1 py-6 text-[13px] text-[#5C6461]">Ninguno de los clientes a la vista tiene el módulo Proyectos.</p>
          )}

          {datos && grupos.length > 0 && conFilas.length === 0 && caidos.length === 0 && (
            <p className="px-1 py-6 text-[13px] text-[#5C6461]">
              {q
                ? `Ningún proyecto con «${q}».`
                : estado === "activos"
                  ? "No hay proyectos activos en los clientes a la vista."
                  : "No hay proyectos en los clientes a la vista."}
            </p>
          )}

          {conFilas.length > 0 && (
            <div className={`flex flex-col gap-3 ${cargando ? "opacity-70" : ""}`}>
              <div
                aria-hidden="true"
                className={`hidden md:grid px-3 -mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A918E] ${REJILLA}`}
              >
                <span>Código</span>
                <span>Proyecto</span>
                <span>Estado</span>
                <span>Avance</span>
                <span>Límite</span>
                <span>Vencidas</span>
              </div>

              {conFilas.map(({ cliente, filas }) => (
                <section
                  key={cliente.slug}
                  aria-label={cliente.nombre}
                  className="rounded-[10px] border border-[#E7E7E1] bg-white overflow-hidden"
                >
                  <header className="min-h-10 px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-[#EDEDE8] bg-[#FBFBF9]">
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: cliente.color || "#94A3B8" }} />
                    <h2 className="text-[13px] font-semibold text-[#1C2B27] truncate">{cliente.nombre}</h2>
                    <span className="text-[12px] tabular-nums text-[#8A918E]">
                      {filas.length} proyecto{filas.length === 1 ? "" : "s"}
                    </span>
                    {/* La versión corta del aviso, que aquí no cabe más; la larga
                        (que cierra la sesión del CRM abierta) va en el `title`
                        y en la flecha de cada fila (12/09/2026). */}
                    <span
                      className="ml-auto text-[12px] text-[#8A918E] truncate max-w-full"
                      title={cliente.saltoComo === "admin" ? notaDelSalto(cliente) : undefined}
                    >
                      {!cliente.saltoComo
                        ? "Sin cuenta para abrir su CRM"
                        : cliente.saltoComo === "admin"
                          ? notaDelSalto(cliente, { corta: true })
                          : null}
                    </span>
                  </header>
                  <ul className="divide-y divide-[#F0F0EB]">
                    {filas.map((fila) => (
                      <FilaProyecto key={fila.id} fila={fila} ficha={cliente} hoy={hoy} onError={setErrorSalto} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {datos && (caidos.length > 0 || (vacios.length > 0 && !q && conFilas.length > 0)) && (
            <div className="mt-3 flex flex-col gap-1.5 px-1 text-[12.5px] leading-snug">
              {caidos.length > 0 && (
                <p className="text-[#8A2A24]">
                  No responde{caidos.length > 1 ? "n" : ""}: {caidos.map((g) => g.cliente.nombre).join(", ")}.{" "}
                  <button
                    type="button"
                    onClick={() => setIntento((n) => n + 1)}
                    className={`font-medium underline underline-offset-2 hover:no-underline rounded-sm ${FOCO}`}
                  >
                    Reintentar
                  </button>
                </p>
              )}
              {vacios.length > 0 && !q && conFilas.length > 0 && (
                <p className="text-[#8A918E]">
                  {estado === "activos" ? "Sin proyectos activos" : "Sin proyectos"}: {vacios.map((g) => g.cliente.nombre).join(", ")}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </MarcoGlobal>
  );
}
