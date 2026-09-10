"use client";

/**
 * /facturacion/bonos — TODOS los bonos de sesiones, y lo que queda por cobrar
 * de ellos (10/09/2026, petición de Rodrigo: «un submódulo en facturación
 * llamado Bonos que tenga todos los bonos de los pacientes… es lo mismo que
 * Cuotas pero cambiando la idea a Bonos»).
 *
 * ── QUÉ NO SE PODÍA HACER HASTA HOY ────────────────────────────────────────
 * Los bonos existían —232 en Aumenta— pero solo se veían de uno en uno, dentro
 * de la ficha de cada familia. O sea que estas cuatro preguntas no tenían
 * respuesta en ninguna pantalla:
 *   · ¿qué bonos hay vendidos y a quién?
 *   · ¿cuáles están agotados (y hay que ofrecer la renovación)?
 *   · ¿cuánto de eso está sin cobrar?
 *   · ¿cómo le doy el mismo bono a los ocho niños del grupo de habilidades
 *     sociales sin entrar en ocho fichas?
 *
 * ── EN QUÉ SE PARECE A CUOTAS Y EN QUÉ NO ──────────────────────────────────
 * Se parece en la forma de trabajar: alta EN GRUPO, grupos por tipo, el cuadro
 * de cerrados abajo en vez de esconderlos, y que dar un bono NO es cobrarlo —su
 * cobro nace pendiente y se salda en Cobros cuando el dinero entra.
 *
 * No se parece en la unidad de tiempo, y de ahí salen las tres ausencias que se
 * notan al mirarla: no hay día de cobro, no hay «Generar el mes» y no hay
 * vigencia. Un bono se paga UNA vez y se acaba cuando se gastan las sesiones,
 * no cuando llega una fecha. Lo que ocupa el sitio de la vigencia es el
 * contador —«le quedan 3 de 10»—, que sale de las citas y no de un número
 * guardado.
 *
 * Las reglas viven en `lib/billing/bonos.js`, con su prueba: aquí no se decide
 * si un bono está agotado ni cuánto se debe.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import Select from "@/components/ui/Select.jsx";
import DrawerBono from "@/components/billing/DrawerBono.jsx";
import { useAccionesDeBono } from "@/components/billing/useAccionesDeBono.js";
import { fmtDate } from "../_components/Kpi.jsx";
import { formatMoney } from "@/lib/payments/money.js";
import {
  bonoCerrado,
  estadoDelBono,
  rotuloDelBono,
  ordenarBonos,
  totalesDeBonos,
} from "@/lib/billing/bonos.js";
import { coincidePorNombre } from "@/lib/utils/busqueda.js";

const ESTADOS = [
  { value: "", label: "Vivos y cerrados" },
  { value: "vivo", label: "Con sesiones libres" },
  { value: "agotado", label: "Agotados" },
  { value: "anulado", label: "Anulados" },
];

/*
 * LOS DOS MUNDOS DEL DINERO, EN UNA LÍNEA.
 *
 * El bono habla en CÉNTIMOS (`session_packs.amount`, como Stripe) y su cobro en
 * EUROS (`payments.amount`, como el resto de Facturación). `formatMoney` espera
 * céntimos, así que lo que llega de un cobro pasa por aquí. Es la misma costura
 * que documenta `lib/billing/cobroDelBono.js`, y por la que un bono de 150 €
 * llegó a nacer con un pendiente de 15.000 €: mejor una función con nombre que
 * un `* 100` suelto repetido por la pantalla.
 */
const dineroDelCobro = (euros) => formatMoney(Math.round((Number(euros) || 0) * 100));

export default function BonosPage() {
  const [bonos, setBonos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [cargando, setCargando] = useState(false);
  // Sin tipos de cita no hay bonos que dar (un bono es el derecho a N sesiones
  // de una terapia): la pantalla lo dice en vez de quedarse en blanco.
  const [sinTipos, setSinTipos] = useState(false);

  const [busca, setBusca] = useState("");
  const [buscaCerrados, setBuscaCerrados] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  // El filtro que usa quien lleva el dinero: los bonos dados que nadie ha
  // pagado todavía. Es la lista con la que se llama por teléfono.
  const [soloPendientes, setSoloPendientes] = useState(false);

  const [showAlta, setShowAlta] = useState(false);
  const [editando, setEditando] = useState(null);

  /*
   * Anular, reactivar y renovar viven en un hook compartido con la ficha de un
   * grupo (`useAccionesDeBono`): las tres tienen texto que explica qué le pasa
   * a las sesiones ya dadas y a su cobro, y dos copias avisarían distinto del
   * mismo botón. El hook lleva también los dos mensajes de la pantalla.
   *
   * La recarga va por REF porque `cargar` se declara debajo y usa los avisos
   * del propio hook: la ref rompe el círculo sin partir el mensaje en dos
   * banderas (una del hook y otra de la carga).
   */
  const cargarRef = useRef(null);
  const recargar = useCallback(() => cargarRef.current?.(), []);
  const { anular, reactivar, renovar, errorMsg, okMsg, setErrorMsg, setOkMsg, dialogo } =
    useAccionesDeBono({ recargar });

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      /*
       * Los tipos salen por la puerta de FACTURACIÓN (`?todos=1`) y no por la
       * de Citas: quien lleva Facturación puede no tener acceso al módulo de
       * Citas, y `/api/citas/event-types` le responde 403 — el desplegable se
       * quedaría vacío sin decir por qué.
       */
      const [rb, rt] = await Promise.all([
        fetch("/api/billing/bonos", { cache: "no-store" }),
        fetch("/api/billing/bonos/tipos?todos=1", { cache: "no-store" }),
      ]);
      const jb = await rb.json();
      if (!jb.ok) throw new Error(jb.error || "No se pudieron cargar los bonos");
      setBonos(jb.data?.bonos ?? []);
      const jt = rt.ok ? await rt.json() : null;
      const lista = jt?.data?.tipos ?? [];
      setTipos(lista);
      setSinTipos(lista.length === 0);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [setErrorMsg]);

  useEffect(() => { cargarRef.current = cargar; }, [cargar]);
  useEffect(() => { cargar(); }, [cargar]);

  const tiposPorId = useMemo(() => new Map(tipos.map((t) => [String(t.id), t])), [tipos]);

  // Cuántos bonos vivos lleva cada tipo: es lo que hace útil el desplegable de
  // arriba, igual que en Cuotas («Logopedia 10 (8)»).
  const vivosPorTipo = useMemo(() => {
    const m = new Map();
    for (const b of bonos) {
      if (bonoCerrado(b)) continue;
      const k = String(b.eventTypeId);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [bonos]);

  const casa = useCallback(
    (b, texto) => coincidePorNombre(texto, [b.paciente, b.familia, b.nombre, b.correo, b.notes]),
    []
  );

  const filtrados = useMemo(() => {
    return bonos.filter((b) => {
      if (filtroTipo && String(b.eventTypeId) !== filtroTipo) return false;
      if (filtroEstado && estadoDelBono(b) !== filtroEstado) return false;
      if (soloPendientes && !(Number(b.cobro?.pendiente) > 0)) return false;
      return true;
    });
  }, [bonos, filtroTipo, filtroEstado, soloPendientes]);

  const visibles = useMemo(
    () => ordenarBonos(filtrados.filter((b) => !bonoCerrado(b) && casa(b, busca))),
    [filtrados, busca, casa]
  );
  const cerrados = useMemo(
    () => ordenarBonos(filtrados.filter((b) => bonoCerrado(b) && casa(b, buscaCerrados))),
    [filtrados, buscaCerrados, casa]
  );

  const totales = useMemo(() => totalesDeBonos(visibles), [visibles]);

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Operativa · Bonos</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Bonos de sesiones
            <HelpTooltip title="Bonos de sesiones" placement="bottom">
              Lo que se paga <strong className="text-white">una vez</strong> y da derecho a un número
              de sesiones, en vez de repetirse mes a mes como una cuota. Al darlo, su cobro aparece{" "}
              <strong className="text-white">pendiente</strong> en Cobros: dar un bono no es cobrarlo.
              Las sesiones se descuentan solas con las citas, y cuando se agota basta{" "}
              <strong className="text-white">volver a cogerlo</strong> — eso crea un bono nuevo, sin
              tocar las sesiones que ya se dieron.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {visibles.length} {visibles.length === 1 ? "bono con sesiones libres" : "bonos con sesiones libres"}
            {totales.sesionesLibres > 0 && <> · <span className="tabular">{totales.sesionesLibres}</span> {totales.sesionesLibres === 1 ? "sesión" : "sesiones"} por dar</>}
            {totales.pendiente > 0 && (
              <> · <span className="text-amber-700 tabular">{formatMoney(totales.pendiente)}</span> sin cobrar</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          {/* La misma lista, mirada por TIPO de bono: quién lleva cada uno,
              cuánto queda por dar y cuánto por cobrar. */}
          <Link
            href="/facturacion/bonos/tipos"
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition"
          >Tipos de bono</Link>
          <button
            onClick={() => setShowAlta(true)}
            disabled={sinTipos}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >+ Nuevo bono</button>
        </div>
      </div>

      {sinTipos && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
          Este centro no tiene el módulo de Citas activo. Un bono es el derecho a N sesiones de un tipo
          de cita, así que sin agenda no hay bonos que dar: los que ya estén dados se siguen viendo aquí.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por paciente, familia o bono..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <Select
          value={filtroTipo}
          onChange={setFiltroTipo}
          options={[
            { value: "", label: "Todos los bonos" },
            ...tipos
              .filter((t) => (Number(t.sesionesDelTipo) || 1) > 1 || vivosPorTipo.has(String(t.id)))
              .map((t) => ({
                value: String(t.id),
                label: `${t.name}${vivosPorTipo.get(String(t.id)) ? ` (${vivosPorTipo.get(String(t.id))})` : ""}`,
              })),
          ]}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 w-full sm:w-72"
        />
        <Select
          value={filtroEstado}
          onChange={setFiltroEstado}
          options={ESTADOS}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200"
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => setSoloPendientes(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
          />
          Sin cobrar
        </label>
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                {/* El paciente DELANTE de la familia (03/09/2026, Aumenta: «en
                    todo lo relativo a facturación que aparezca siempre primero
                    el paciente»). */}
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Familia</th>
                <th className="px-4 py-3 font-medium">Bono</th>
                <th className="px-4 py-3 font-medium">Sesiones</th>
                <th className="px-4 py-3 font-medium text-right">Importe</th>
                <th className="px-4 py-3 font-medium">Cobro</th>
                <th className="px-4 py-3 font-medium">Dado el</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando && bonos.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!cargando && visibles.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">
                  {bonos.length
                    ? "Ningún bono con sesiones libres casa con esos filtros."
                    : "Todavía no hay bonos. Da el primero y su cobro aparecerá pendiente en Cobros."}
                </td></tr>
              )}
              {visibles.map((b) => (
                <FilaBono
                  key={b.id}
                  bono={b}
                  onEditar={() => setEditando(b)}
                  onAnular={() => anular(b)}
                  onRenovar={() => renovar(b)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CERRADOS: agotados y anulados ───────────────────────────────────
          El espejo del cuadro de bajas de Cuotas, y aquí es todavía más útil:
          es la lista de a quién toca ofrecerle la renovación. No se esconden. */}
      <div className="mt-6 bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100 bg-neutral-50/50">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Agotados y anulados{cerrados.length > 0 ? ` · ${cerrados.length}` : ""}
          </h2>
          <input
            value={buscaCerrados}
            onChange={(e) => setBuscaCerrados(e.target.value)}
            placeholder="Buscar uno para volver a darlo..."
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
          />
        </div>
        {cerrados.length === 0 ? (
          <p className="px-4 py-6 text-xs text-neutral-400">
            {buscaCerrados.trim()
              ? "Ninguno casa con esa búsqueda."
              : "Ninguno cerrado. Cuando un bono gaste todas sus sesiones o se anule, aparecerá aquí para poder volver a darlo."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <tbody>
                {cerrados.map((b) => (
                  <tr key={b.id} className="border-b border-neutral-50 text-neutral-400">
                    <td className="px-4 py-2.5 text-neutral-600">{b.paciente || <span className="italic text-neutral-300">de la familia</span>}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {b.clientId ? (
                        <Link href={`/clientes/${b.clientId}`} className="hover:underline">{b.familia || "—"}</Link>
                      ) : (b.familia || "—")}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{b.nombre}</td>
                    <td className="px-4 py-2.5 text-xs">{rotuloDelBono(b)}</td>
                    <td className="px-4 py-2.5 text-xs text-right tabular">{b.amount ? formatMoney(b.amount) : "—"}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDate(b.compradoEl)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => renovar(b)} className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 mr-2">Volver a darlo</button>
                      {estadoDelBono(b) === "anulado" ? (
                        <button onClick={() => reactivar(b)} className="text-[11px] text-neutral-500 hover:text-neutral-800">Reactivar</button>
                      ) : (
                        <button onClick={() => setEditando(b)} className="text-[11px] text-neutral-500 hover:text-neutral-800">Editar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAlta && (
        <DrawerBono
          tipos={tipos}
          inicial={filtroTipo ? { eventTypeId: filtroTipo } : null}
          onClose={() => setShowAlta(false)}
          onDone={(msg) => { setShowAlta(false); setOkMsg(msg); cargar(); }}
        />
      )}

      {editando && (
        <DrawerBono
          tipos={tipos}
          bono={editando}
          tipoNombre={tiposPorId.get(String(editando.eventTypeId))?.name ?? editando.nombre}
          onClose={() => setEditando(null)}
          onDone={(msg) => { setEditando(null); setOkMsg(msg); cargar(); }}
        />
      )}

      {dialogo}
    </div>
  );
}

/* ── Una fila ──────────────────────────────────────────────────────────────── */
function FilaBono({ bono: b, onEditar, onAnular, onRenovar }) {
  const pendiente = Number(b.cobro?.pendiente) || 0;
  const cobrado = Number(b.cobro?.cobrado) || 0;
  return (
    <tr className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
      <td className="px-4 py-3 text-neutral-800">
        {b.paciente || <span className="italic text-neutral-400">de la familia</span>}
      </td>
      <td className="px-4 py-3 text-xs text-neutral-600">
        {b.clientId ? (
          <Link href={`/clientes/${b.clientId}`} className="hover:underline">{b.familia || "—"}</Link>
        ) : (b.familia || "—")}
      </td>
      <td className="px-4 py-3 text-xs text-neutral-600">
        {b.nombre}
        {b.tipoOculto && <span className="text-neutral-400"> · oculto</span>}
      </td>
      <td className="px-4 py-3 text-xs text-neutral-600">
        <span className="tabular">{rotuloDelBono(b)}</span>
        {b.previas > 0 && (
          <span className="block text-[11px] text-neutral-400">{b.previas} venían gastadas de antes</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-right tabular text-neutral-700">
        {b.amount ? formatMoney(b.amount) : <span className="text-neutral-300">sin importe</span>}
      </td>
      <td className="px-4 py-3 text-xs">
        {!b.cobro ? (
          <span className="text-neutral-300">sin cobro</span>
        ) : pendiente > 0 && cobrado > 0 ? (
          <span className="text-amber-700">a medias · <span className="tabular">{dineroDelCobro(pendiente)}</span> sin cobrar</span>
        ) : pendiente > 0 ? (
          <span className="text-amber-700">pendiente · <span className="tabular">{dineroDelCobro(pendiente)}</span></span>
        ) : b.cobro.estado === "devuelto" ? (
          <span className="text-rose-500">devuelto</span>
        ) : (
          <span className="text-emerald-600">cobrado</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">{fmtDate(b.compradoEl)}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <button onClick={onEditar} className="text-[11px] text-neutral-500 hover:text-neutral-900 mr-2">Editar</button>
        <button onClick={onRenovar} className="text-[11px] text-emerald-600 hover:text-emerald-800 mr-2">Renovar</button>
        <button onClick={onAnular} className="text-[11px] text-rose-500 hover:text-rose-700">Anular</button>
      </td>
    </tr>
  );
}
