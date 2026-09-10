"use client";

/**
 * /facturacion/bonos/tipos/[id] — LA FICHA DE UN GRUPO: quién tiene este bono,
 * cuánto le queda y qué falta por cobrar (10/09/2026, submódulo Bonos).
 *
 * El espejo de la ficha de un tipo de cuota, con dos vistas en vez de tres:
 *
 *   · QUIÉN LO LLEVA — los bonos abiertos, con el contador de cada uno. Es la
 *     pregunta del mostrador: «¿a Hugo le queda alguna?».
 *   · LOS QUE PASARON — agotados y anulados, que es de donde sale la
 *     renovación: la lista de a quién toca ofrecerle el siguiente.
 *
 * La tercera pestaña de las cuotas —el curso mes a mes, de septiembre a junio—
 * no está, y no es un olvido: un bono no tiene meses. Su tiempo se mide en
 * sesiones, y lo que ocupa ese sitio es el contador.
 *
 * «Añadir al grupo» es el alta EN GRUPO de siempre con el tipo ya puesto: es lo
 * que permite dar el bono a los ocho niños de habilidades sociales sin entrar en
 * ocho fichas.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import DrawerBono from "@/components/billing/DrawerBono.jsx";
import { useAccionesDeBono } from "@/components/billing/useAccionesDeBono.js";
import { fmtDate } from "../../../_components/Kpi.jsx";
import { formatMoney } from "@/lib/payments/money.js";
import { bonoCerrado, estadoDelBono, rotuloDelBono } from "@/lib/billing/bonos.js";

/** Euros de un cobro → céntimos de `formatMoney`. La costura de siempre. */
const dineroDelCobro = (euros) => formatMoney(Math.round((Number(euros) || 0) * 100));

export default function FichaDeTipoDeBonoPage() {
  const { id } = useParams();
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [noExiste, setNoExiste] = useState(false);
  const [showAlta, setShowAlta] = useState(false);
  const [editando, setEditando] = useState(null);

  const cargarRef = useRef(null);
  const recargar = useCallback(() => cargarRef.current?.(), []);
  const { anular, reactivar, renovar, errorMsg, okMsg, setErrorMsg, setOkMsg, dialogo } =
    useAccionesDeBono({ recargar });

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/bonos/tipos/${id}`, { cache: "no-store" });
      if (r.status === 404) { setNoExiste(true); return; }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el grupo");
      setDatos(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [id, setErrorMsg]);

  useEffect(() => { cargarRef.current = cargar; }, [cargar]);
  useEffect(() => { cargar(); }, [cargar]);

  if (noExiste) {
    return (
      <div className="p-4 lg:p-8">
        <p className="text-sm text-neutral-500">
          Ese tipo de bono ya no está en el catálogo.{" "}
          <Link href="/facturacion/bonos/tipos" className="underline">Volver a los tipos de bono</Link>.
        </p>
      </div>
    );
  }

  const tipo = datos?.tipo ?? null;
  const bonos = datos?.bonos ?? [];
  const abiertos = bonos.filter((b) => !bonoCerrado(b));
  const cerrados = bonos.filter((b) => bonoCerrado(b));
  const totales = datos?.totales ?? null;
  const gente = datos?.gente ?? null;

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Operativa · Bonos</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            {tipo?.name ?? (cargando ? "Cargando..." : "Grupo")}
            <HelpTooltip title="El grupo de un bono" placement="bottom">
              Todo el que tiene este bono, abierto o gastado. El contador de cada uno sale de{" "}
              <strong className="text-white">sus citas</strong>, no de un número guardado: por eso una
              cita cancelada a tiempo no le gasta la sesión. Cuando alguien lo agote,{" "}
              <strong className="text-white">«Volver a darlo»</strong> le abre otro sin tocar las
              sesiones que ya se dieron.
            </HelpTooltip>
          </h1>
          {tipo && (
            <p className="text-xs text-neutral-400 mt-1">
              {tipo.sesionesDelTipo} {tipo.sesionesDelTipo === 1 ? "sesión" : "sesiones"}
              {tipo.precio ? <> · <span className="tabular">{formatMoney(tipo.precio)}</span></> : null}
              {tipo.duracion ? <> · {tipo.duracion} min</> : null}
              {!tipo.esPack && <> · <span className="text-amber-700">configurado como cita suelta</span></>}
              {tipo.oculto && <> · oculto en la agenda</>}
              {!tipo.activo && <> · apagado</>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion/bonos/tipos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Tipos de bono
          </Link>
          <button
            onClick={() => setShowAlta(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >+ Añadir al grupo</button>
        </div>
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}

      {totales && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Dato titulo="Bonos abiertos" valor={String(abiertos.length)} pie={cerrados.length ? `${cerrados.length} cerrados` : null} />
          <Dato
            titulo="Quién lo lleva"
            valor={String((gente?.pacientes ?? 0) + (gente?.sinPaciente ?? 0))}
            pie={gente?.sinPaciente ? `${gente.sinPaciente} a nombre de la familia` : "pacientes"}
          />
          <Dato titulo="Sesiones por dar" valor={String(totales.sesionesLibres)} pie="de los bonos abiertos" />
          <Dato
            titulo="Sin cobrar"
            valor={formatMoney(totales.pendiente)}
            pie={totales.vendido ? `de ${formatMoney(totales.vendido)} vendidos` : null}
            alerta={totales.pendiente > 0}
          />
        </div>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/50">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Quién lo lleva{abiertos.length ? ` · ${abiertos.length}` : ""}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Familia</th>
                <th className="px-4 py-3 font-medium">Sesiones</th>
                <th className="px-4 py-3 font-medium text-right">Importe</th>
                <th className="px-4 py-3 font-medium">Cobro</th>
                <th className="px-4 py-3 font-medium">Dado el</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando && !datos && (
                <tr><td colSpan={7} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!cargando && abiertos.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-xs text-neutral-400">
                  Nadie tiene este bono abierto. Con «Añadir al grupo» se lo puedes dar a varios de una vez.
                </td></tr>
              )}
              {abiertos.map((b) => (
                <tr key={b.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                  <td className="px-4 py-3 text-neutral-800">
                    {b.paciente || <span className="italic text-neutral-400">de la familia</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600">
                    {b.clientId ? (
                      <Link href={`/clientes/${b.clientId}`} className="hover:underline">{b.familia || "—"}</Link>
                    ) : (b.familia || "—")}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600 tabular">{rotuloDelBono(b)}</td>
                  <td className="px-4 py-3 text-xs text-right tabular text-neutral-700">
                    {b.amount ? formatMoney(b.amount) : <span className="text-neutral-300">sin importe</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {!b.cobro ? (
                      <span className="text-neutral-300">sin cobro</span>
                    ) : Number(b.cobro.pendiente) > 0 ? (
                      <span className="text-amber-700">pendiente · <span className="tabular">{dineroDelCobro(b.cobro.pendiente)}</span></span>
                    ) : b.cobro.estado === "devuelto" ? (
                      <span className="text-rose-500">devuelto</span>
                    ) : (
                      <span className="text-emerald-600">cobrado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">{fmtDate(b.compradoEl)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditando(b)} className="text-[11px] text-neutral-500 hover:text-neutral-900 mr-2">Editar</button>
                    <button onClick={() => renovar(b)} className="text-[11px] text-emerald-600 hover:text-emerald-800 mr-2">Renovar</button>
                    <button onClick={() => anular(b)} className="text-[11px] text-rose-500 hover:text-rose-700">Anular</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/50">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Los que pasaron por aquí{cerrados.length ? ` · ${cerrados.length}` : ""}
          </h2>
        </div>
        {cerrados.length === 0 ? (
          <p className="px-4 py-6 text-xs text-neutral-400">
            Ninguno agotado ni anulado todavía.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <tbody>
                {cerrados.map((b) => (
                  <tr key={b.id} className="border-b border-neutral-50 text-neutral-400">
                    <td className="px-4 py-2.5 text-neutral-600">{b.paciente || <span className="italic text-neutral-300">de la familia</span>}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {b.clientId ? (
                        <Link href={`/clientes/${b.clientId}`} className="hover:underline">{b.familia || "—"}</Link>
                      ) : (b.familia || "—")}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{rotuloDelBono(b)}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular">{b.amount ? formatMoney(b.amount) : "—"}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDate(b.compradoEl)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => renovar(b)} className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 mr-2">Volver a darlo</button>
                      {estadoDelBono(b) === "anulado" && (
                        <button onClick={() => reactivar(b)} className="text-[11px] text-neutral-500 hover:text-neutral-800">Reactivar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAlta && tipo && (
        <DrawerBono
          tipoFijo={{ id: tipo.id, name: tipo.name, sesionesDelTipo: tipo.sesionesDelTipo, precio: tipo.precio }}
          onClose={() => setShowAlta(false)}
          onDone={(msg) => { setShowAlta(false); setOkMsg(msg); cargar(); }}
        />
      )}

      {editando && (
        <DrawerBono
          bono={editando}
          tipoNombre={tipo?.name ?? editando.nombre}
          onClose={() => setEditando(null)}
          onDone={(msg) => { setEditando(null); setOkMsg(msg); cargar(); }}
        />
      )}

      {dialogo}
    </div>
  );
}

/** Un número con su rótulo. Cuatro en fila, como el resto de Facturación. */
function Dato({ titulo, valor, pie = null, alerta = false }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">{titulo}</div>
      <div className={`font-display text-xl mt-1 tabular ${alerta ? "text-amber-700" : "text-[var(--ink-900)]"}`}>{valor}</div>
      {pie && <div className="text-[11px] text-neutral-400 mt-0.5">{pie}</div>}
    </div>
  );
}
