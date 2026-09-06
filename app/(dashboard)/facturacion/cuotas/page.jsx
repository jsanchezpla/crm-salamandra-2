"use client";

/**
 * /facturacion/cuotas — quién paga qué todos los meses, y el botón que genera
 * los cobros del mes (01/09/2026, petición de Aumenta).
 *
 * Tres cosas que antes no se podían hacer:
 *   · dar de alta la MISMA cuota a un grupo de pacientes de una vez;
 *   · darla de baja, modificarla o eliminarla;
 *   · generar los cobros de un mes entero de una pasada, prorrateando el mes
 *     del alta y el de la baja.
 *
 * Los cobros nacen PENDIENTES: generar no es cobrar. Se pasan a cobrado desde
 * Cobros cuando el dinero entra de verdad — Morosidad y el portal miran eso.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { cuotaDeBaja, bajaTrasMeses, mesesDeTramo, mesVigente, hoyVigente, mesLegible } from "../../../../lib/billing/cuotas.js";
import { ivaPorDefecto } from "../../../../lib/billing/ivaPorDefecto.js";
import { cuotaCasaCon, rotuloPacienteDeCuota } from "../../../../lib/billing/cuotaPacientes.js";
import { coincidePorNombre } from "../../../../lib/utils/busqueda.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const METODOS = [
  { value: "transfer", label: "Banco (transferencia)" },
  { value: "direct_debit", label: "Domiciliación" },
  { value: "card", label: "Tarjeta" },
  { value: "cash", label: "Efectivo" },
];
const METODO_CORTO = { transfer: "Banco", direct_debit: "Domiciliación", card: "Tarjeta", cash: "Efectivo" };

/*
 * «Durante N meses y luego de baja» (01/09/2026, Rodrigo). La casilla de fecha
 * de fin ya estaba, pero contar los meses lo hacía el usuario: tres meses desde
 * el 15 de septiembre NO es el 15 de diciembre, es el 30 de noviembre. Estos
 * botones escriben la fecha; la cuenta vive en lib/billing/cuotas.js.
 */
const DURACIONES = [
  { meses: 3, label: "3 meses" },
  { meses: 6, label: "6 meses" },
  { meses: 9, label: "9 meses" },
  { meses: 12, label: "1 año" },
];

// El día y el mes de MADRID, no los de UTC: a las 00:30 del día 1 `toISOString`
// todavía dice el mes pasado, y una cuota nacía con la fecha de ayer.
const hoyIso = () => hoyVigente();
const mesActual = () => mesVigente();

const CUOTA_VACIA = () => ({
  conceptIds: [],
  amount: "",
  method: "transfer",
  dayOfMonth: "",
  startDate: hoyIso(),
  endDate: "",
  notes: "",
});

export default function CuotasPage() {
  const [cuotas, setCuotas] = useState([]);
  const [conceptos, setConceptos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const [filtroMetodo, setFiltroMetodo] = useState("");
  // Filtrar por LA CUOTA, no solo por quién la paga (01/09/2026, Rodrigo:
  // «necesito poder filtrar por las mismas cuotas»): elegir una enseña sus
  // miembros, y el alta desde ahí nace con esa cuota puesta.
  const [filtroConcepto, setFiltroConcepto] = useState("");
  /*
   * «Solo las que no dicen de qué hijo son» (04/09/2026, Rodrigo: «hay que
   * revisar a todos los pacientes para que cada paciente tenga la cuota que le
   * toca y no se pague por su hermano»). Son 35 en Aumenta, y hasta hoy no
   * había forma de encontrarlas entre 278: se buscaban a ojo. Con el filtro,
   * repasarlas es una tarde.
   */
  const [soloSinPaciente, setSoloSinPaciente] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaBajas, setBuscaBajas] = useState("");

  const [showAlta, setShowAlta] = useState(false);
  const [editando, setEditando] = useState(null); // cuota que se edita
  const [showGenerar, setShowGenerar] = useState(false);

  // Preguntar dentro del CRM y no con el diálogo del navegador (12/08/2026,
  // Rodrigo): Chrome deja silenciar los `confirm`, y silenciado devuelve
  // `false` siempre — el botón deja de funcionar sin decir nada.
  const { confirmar, dialogo } = useDialogo();

  /*
   * CUÁNTAS CUOTAS SIGUEN SIN SU COBRO DE ESTE MES (04/09/2026, Rodrigo: «en
   * ningún momento pasa a salirme en los cobros»).
   *
   * No era un fallo: generar es un botón, no un automatismo, y el mes se genera
   * una vez —el 01/09 salieron los 274 cobros de Aumenta—. A quien da de alta
   * una cuota el día 4 no le sale nada en Cobros hasta que alguien vuelva a
   * darle a «Generar el mes» (relanzarlo no duplica: las ya generadas salen en
   * «repetidas»). Lo que faltaba era DECIRLO, y decirlo con el número delante.
   *
   * Sale de la MISMA vista previa que abre el drawer, así que el número de aquí
   * y la lista de ahí no pueden discrepar. Lo llama `cargar`, para no pedirlo
   * dos veces por cada visita.
   */
  const [sinGenerar, setSinGenerar] = useState(null);
  const contarSinGenerar = useCallback(() => {
    fetch(`/api/billing/cuotas/generar?mes=${mesActual()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSinGenerar(j.ok ? (j.data?.aGenerar?.length ?? 0) : null))
      .catch(() => setSinGenerar(null));
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      // Siempre TODAS: las de baja no se esconden tras un interruptor, viven
      // en su propio cuadro abajo, con buscador y reintegro (01/09/2026).
      qs.set("todas", "1");
      if (filtroMetodo) qs.set("metodo", filtroMetodo);
      const r = await fetch(`/api/billing/cuotas?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar las cuotas");
      setCuotas(j.data?.cuotas ?? []);
      contarSinGenerar();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [filtroMetodo, contarSinGenerar]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    fetch("/api/billing/conceptos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setConceptos(j.data?.conceptos ?? []))
      .catch(() => {});
  }, []);

  // El IVA con el que nace una cuota nueva del catálogo: el del emisor (0 si
  // está exento), la misma regla que en facturas y presupuestos.
  const [ivaSugerido, setIvaSugerido] = useState(21);
  useEffect(() => {
    fetch("/api/billing/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setIvaSugerido(ivaPorDefecto(j.data)))
      .catch(() => {});
  }, []);

  const porId = useMemo(() => new Map(conceptos.map((c) => [String(c.id), c])), [conceptos]);

  // Una cuota recién creada en el catálogo entra en la lista sin recargar.
  const conceptoCreado = useCallback((c) => setConceptos((cs) => [...cs, c]), []);

  // El importe que se cobrará: el pactado, o la suma de sus conceptos.
  const importeDe = useCallback(
    (c) => {
      if (c.amount !== null && c.amount !== undefined && c.amount !== "") return Number(c.amount);
      return (Array.isArray(c.conceptIds) ? c.conceptIds : []).reduce(
        (s, id) => s + Number(porId.get(String(id))?.unitPrice || 0), 0
      );
    },
    [porId]
  );

  const conEsaCuota = useCallback(
    (c) => !filtroConcepto || (Array.isArray(c.conceptIds) && c.conceptIds.map(String).includes(filtroConcepto)),
    [filtroConcepto]
  );

  // Dos cuadros: las vivas arriba y las BAJAS abajo (de baja = apagada o con
  // la fecha de fin ya pasada — los «de enero a marzo» caducan solos y caen
  // aquí sin salir del grupo, listos para reintegrarse).
  const hoy = hoyIso();
  /*
   * Buscar por FAMILIA o por PACIENTE (01/09/2026, Rodrigo). Quién cubre cada
   * cuota lo decide `lib/billing/cuotaPacientes.js`: la que no tiene paciente
   * asignado —259 de las 274 de Aumenta— cubre a los pacientes de su familia,
   * así que escribir el nombre del niño la encuentra igual.
   */
  const visibles = useMemo(
    () =>
      cuotas.filter(
        (c) =>
          !cuotaDeBaja(c, hoy) &&
          conEsaCuota(c) &&
          cuotaCasaCon(c, busca) &&
          (!soloSinPaciente || !c.patientId)
      ),
    [cuotas, busca, conEsaCuota, hoy, soloSinPaciente]
  );

  const bajas = useMemo(
    () => cuotas.filter((c) => cuotaDeBaja(c, hoy) && conEsaCuota(c) && cuotaCasaCon(c, buscaBajas)),
    [cuotas, buscaBajas, conEsaCuota, hoy]
  );

  // Cuántos miembros VIVOS tiene cada cuota, para el desplegable del filtro.
  const miembrosPorConcepto = useMemo(() => {
    const m = new Map();
    for (const c of cuotas) {
      if (cuotaDeBaja(c, hoy)) continue;
      for (const id of Array.isArray(c.conceptIds) ? c.conceptIds : []) {
        m.set(String(id), (m.get(String(id)) ?? 0) + 1);
      }
    }
    return m;
  }, [cuotas, hoy]);

  const totalMes = visibles.filter((c) => c.active).reduce((s, c) => s + importeDe(c), 0);

  async function darDeBaja(cuota) {
    const fecha = window.prompt(
      `Fecha de baja de la cuota de ${cuota.client?.name ?? "esta familia"}.\n\nEl mes de la baja se cobra prorrateado hasta ese día.`,
      hoyIso()
    );
    if (!fecha) return;
    await guardarParcial(cuota.id, { endDate: fecha, active: false }, "Cuota dada de baja");
  }

  async function reactivar(cuota) {
    await guardarParcial(cuota.id, { active: true, endDate: null }, "Cuota reactivada");
  }

  async function guardarParcial(id, cuerpo, mensaje) {
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/cuotas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setOkMsg(mensaje);
      await cargar();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  /**
   * Eliminar una cuota. Con cobros generados detrás el servidor YA NO se niega:
   * devuelve 409 con el desglose y aquí se pregunta con esos números delante
   * (01/09/2026, Rodrigo: «que me pida confirmación en lugar de no dejarme»).
   *
   * Dos preguntas y no una: la primera es la de siempre —eliminar es para el
   * alta equivocada— y la segunda solo sale si de verdad hay cobros, diciendo
   * cuántos y cuántos siguen pendientes. Desde el 05/09/2026 los PENDIENTES sin
   * factura se van con la cuota (los crea ella sola, ver AV-0048); el dinero
   * cobrado y lo ya facturado no se borra de paso.
   */
  async function borrar(cuota) {
    const quien = cuota.client?.fiscalName || cuota.client?.name || "esta familia";
    const seguro = await confirmar({
      titulo: "Eliminar la cuota",
      texto: `Se elimina la cuota de ${quien} y dejará de generar cobros. Si lo que quieres es que deje de cobrarse a partir de una fecha, usa «Dar de baja»: así se conserva por qué se cobró lo que se cobró.`,
      confirmar: "Eliminar",
      cancelar: "Volver",
      tono: "peligro",
    });
    if (!seguro) return;

    const respuesta = await pedirBorrado(cuota, false);
    if (respuesta?.code !== "TIENE_COBROS") return;

    const { cobros, pendientes, cobrados } = respuesta;
    const detalle = [
      pendientes ? `${pendientes} pendiente${pendientes === 1 ? "" : "s"} de cobro` : null,
      cobrados ? `${cobrados} ya cobrado${cobrados === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" y ");
    const insiste = await confirmar({
      titulo: "Esta cuota ya ha generado cobros",
      texto: `Hay ${cobros} cobro${cobros === 1 ? "" : "s"} que nació de esta cuota (${detalle}). Al eliminarla se borran los que siguen PENDIENTES y no están en ninguna factura; el dinero ya cobrado y lo ya facturado se queda, sin la cuota que lo explica.`,
      confirmar: "Eliminar de todas formas",
      cancelar: "Volver",
      tono: "peligro",
    });
    if (!insiste) return;
    await pedirBorrado(cuota, true);
  }

  /** El DELETE. Devuelve el 409 con su código cuando el servidor pregunta. */
  async function pedirBorrado(cuota, confirmado) {
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/billing/cuotas/${cuota.id}${confirmado ? "?confirmar=1" : ""}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!j.ok) {
        if (j.code === "TIENE_COBROS") return j;
        throw new Error(j.error || "No se pudo eliminar");
      }
      setOkMsg(
        j.data?.cobros
          ? `Cuota eliminada. Sus ${j.data.cobros} cobros siguen en Cobros.`
          : "Cuota eliminada"
      );
      await cargar();
      return null;
    } catch (e) {
      setErrorMsg(e.message);
      return null;
    }
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Operativa · Cuotas</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Cuotas mensuales
            <HelpTooltip title="Cuotas mensuales" placement="bottom">
              Lo que paga cada familia TODOS los meses. Al dar de alta o modificar una cuota, su
              cobro del mes en curso{" "}
              <strong className="text-white">aparece y se pone al día solo</strong> en Cobros. El botón{" "}
              <strong className="text-white">Generar el mes</strong> sigue estando para el lote entero y
              para los meses que no son este, prorrateando el mes del alta y el de la baja.
              {" "}
              Los cobros nacen <strong className="text-white">pendientes</strong>: generar no es
              cobrar. Se pasan a cobrado en Cobros cuando el dinero entra.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {visibles.length} {visibles.length === 1 ? "cuota" : "cuotas"}
            {totalMes > 0 && <> · <span className="tabular">{fmtMoney(totalMes)}</span> al mes</>}
            {sinGenerar > 0 && (
              <>
                {" · "}
                <span className="text-amber-700">
                  {sinGenerar} sin su cobro de {mesLegible(mesActual())}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          {/* Con cuotas sin cobro de este mes el botón deja de ser gris: es la
              única forma de que una cuota nueva llegue a Cobros. */}
          <button
            onClick={() => setShowGenerar(true)}
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition ${
              sinGenerar > 0
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Generar el mes
            {sinGenerar > 0 && <span className="ml-1.5 tabular">· {sinGenerar}</span>}
          </button>
          {/*
            UN SOLO BOTÓN, Y ABRE EL ALTA COMPLETA (01/09/2026, Rodrigo).

            Había dos: este daba de alta a QUIÉN paga, y otro con borde
            discontinuo entre los filtros abría lo mismo pero con el formulario
            de la cuota del catálogo ya desplegado. Dos botones que llevan al
            mismo sitio y se llaman casi igual —«+ Nueva cuota» y «+ Crear cuota
            nueva»— no son dos opciones: son una pregunta que hay que
            resolver antes de pulsar.

            Ahora entra siempre con el catálogo desplegado (`abrirCatalogo`),
            que es el camino largo: quien solo venía a asignar una cuota que ya
            existe la elige del desplegable de arriba y no baja hasta ahí.

            Por eso el alta ya no lleva interruptor: era el estado que
            distinguía a los dos botones y con uno solo no distinguía nada.
          */}
          <button
            onClick={() => setShowAlta(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >+ Nueva cuota</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por paciente o por familia..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <Select
          value={filtroConcepto}
          onChange={setFiltroConcepto}
          options={[
            { value: "", label: "Todas las cuotas" },
            ...conceptos.map((c) => ({
              value: String(c.id),
              label: `${c.name}${miembrosPorConcepto.get(String(c.id)) ? ` (${miembrosPorConcepto.get(String(c.id))})` : ""}`,
            })),
          ]}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 w-full sm:w-72"
        />
        <Select
          value={filtroMetodo}
          onChange={setFiltroMetodo}
          options={[{ value: "", label: "Todos los métodos" }, ...METODOS]}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200"
        />
        {/* Las que hay que repasar: a nombre de la familia y sin decir de qué
            hijo son. Mientras estén así, al cobrar a un hermano sale la cuota
            entera de la casa (04/09/2026). */}
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={soloSinPaciente}
            onChange={(e) => setSoloSinPaciente(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
          />
          Sin paciente asignado
          {soloSinPaciente && <span className="text-neutral-400">({visibles.length})</span>}
        </label>
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                {/* El paciente DELANTE de la familia (03/09/2026, Aumenta: «en
                    todo lo relativo a facturación que aparezca siempre primero
                    el paciente»): es a quien conoce el centro. */}
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Familia</th>
                <th className="px-4 py-3 font-medium">Concepto</th>
                <th className="px-4 py-3 font-medium text-right">Al mes</th>
                <th className="px-4 py-3 font-medium">Cómo</th>
                <th className="px-4 py-3 font-medium">Día</th>
                <th className="px-4 py-3 font-medium">Vigencia</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && cuotas.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && visibles.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">
                  Todavía no hay cuotas. Da de alta la primera y podrás generar el mes entero de una vez.
                </td></tr>
              )}
              {visibles.map((c) => {
                const nombres = (Array.isArray(c.conceptIds) ? c.conceptIds : [])
                  .map((id) => porId.get(String(id))?.name)
                  .filter(Boolean);
                return (
                  <tr key={c.id} className={`border-b border-neutral-50 ${c.active ? "" : "bg-neutral-50/60 text-neutral-400"}`}>
                    <td className="px-4 py-3 text-neutral-800">
                      {rotuloPacienteDeCuota(c)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      <Link href={`/clientes/${c.clientId}`} className="hover:underline">
                        {c.client?.fiscalName || c.client?.name || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {nombres.length ? nombres.join(" + ") : <span className="italic text-neutral-300">sin conceptos</span>}
                      {c.amount !== null && c.amount !== undefined && c.amount !== "" && nombres.length > 0 && (
                        <span className="ml-1 text-[10px] text-amber-600" title="Tiene un importe pactado: manda sobre el precio de los conceptos">· pactado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular text-neutral-900">{fmtMoney(importeDe(c))}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{METODO_CORTO[c.method] ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">{c.dayOfMonth ? `día ${c.dayOfMonth}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      desde {fmtDate(c.startDate)}
                      {c.endDate && <span className="text-rose-500"> · baja {fmtDate(c.endDate)}</span>}
                      {/* Cuántos meses son, para no contarlos con los dedos. */}
                      {mesesDeTramo(c.startDate, c.endDate) && (
                        <span className="text-neutral-400"> · {mesesDeTramo(c.startDate, c.endDate)} {mesesDeTramo(c.startDate, c.endDate) === 1 ? "mes" : "meses"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditando(c)} className="text-[11px] text-neutral-500 hover:text-neutral-900 mr-2">Editar</button>
                      {c.active ? (
                        <button onClick={() => darDeBaja(c)} className="text-[11px] text-amber-600 hover:text-amber-800 mr-2">Dar de baja</button>
                      ) : (
                        <button onClick={() => reactivar(c)} className="text-[11px] text-emerald-600 hover:text-emerald-800 mr-2">Reactivar</button>
                      )}
                      <button onClick={() => borrar(c)} className="text-[11px] text-rose-500 hover:text-rose-700">Borrar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── BAJAS (01/09/2026, Rodrigo) ─────────────────────────────────────
          Quien termina sus meses o se da de baja NO sale del grupo: cae aquí,
          con su buscador, y un clic lo reintegra. */}
      <div className="mt-6 bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100 bg-neutral-50/50">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Bajas{bajas.length > 0 ? ` · ${bajas.length}` : ""}
          </h2>
          <input
            value={buscaBajas}
            onChange={(e) => setBuscaBajas(e.target.value)}
            placeholder="Buscar una baja para reintegrarla..."
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
          />
        </div>
        {bajas.length === 0 ? (
          <p className="px-4 py-6 text-xs text-neutral-400">
            {buscaBajas.trim() ? "Ninguna baja casa con esa búsqueda." : "Nadie de baja. Cuando una cuota termine sus meses o se dé de baja, aparecerá aquí."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <tbody>
                {bajas.map((c) => {
                  const nombres = (Array.isArray(c.conceptIds) ? c.conceptIds : [])
                    .map((id) => porId.get(String(id))?.name)
                    .filter(Boolean);
                  return (
                    <tr key={c.id} className="border-b border-neutral-50 text-neutral-400">
                      <td className="px-4 py-2.5 text-neutral-600">
                        <Link href={`/clientes/${c.clientId}`} className="hover:underline">
                          {c.client?.fiscalName || c.client?.name || "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {rotuloPacienteDeCuota(c)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {nombres.length ? nombres.join(" + ") : <span className="italic text-neutral-300">sin conceptos</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        desde {fmtDate(c.startDate)}
                        {c.endDate && <span className="text-rose-400"> · baja {fmtDate(c.endDate)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => reactivar(c)} className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 mr-2">Reintegrar</button>
                        <button onClick={() => borrar(c)} className="text-[11px] text-rose-400 hover:text-rose-600">Borrar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAlta && (
        <DrawerCuota
          conceptos={conceptos}
          ivaSugerido={ivaSugerido}
          onConceptoCreado={conceptoCreado}
          abrirCatalogo
          inicial={filtroConcepto ? { conceptIds: [filtroConcepto] } : null}
          onClose={() => setShowAlta(false)}
          onDone={(msg) => { setShowAlta(false); setOkMsg(msg); cargar(); }}
        />
      )}

      {editando && (
        <DrawerCuota
          conceptos={conceptos}
          ivaSugerido={ivaSugerido}
          onConceptoCreado={conceptoCreado}
          cuota={editando}
          onClose={() => setEditando(null)}
          onDone={(msg) => { setEditando(null); setOkMsg(msg); cargar(); }}
        />
      )}

      {showGenerar && (
        <DrawerGenerar onClose={() => setShowGenerar(false)} onDone={() => cargar()} />
      )}

      {dialogo}
    </div>
  );
}

/* ── Qué contar del cobro después de guardar (05/09/2026, AV-0048 y AV-0046) ─
 *
 * Desde hoy guardar una cuota deja al día su cobro del mes en curso, así que el
 * aviso deja de ser «ahora dale a Generar el mes» y pasa a decir qué ha pasado.
 * Los dos casos que hay que decir sí o sí son los que NO terminan en un cobro:
 * el que no se puede tocar porque ya está cobrado o facturado, y el que no vale
 * nada porque sus conceptos ya no están en el catálogo — ese era el agujero
 * silencioso.
 */
function colaDelCobro(cobro) {
  if (!cobro) return "";
  const mes = mesLegible(mesActual());
  if (cobro.estado === "creado") return ` · su cobro de ${mes} ya está en Cobros`;
  if (cobro.estado === "actualizado") return ` · su cobro de ${mes} se ha puesto al día`;
  if (cobro.estado === "intocable") return ` · OJO: el cobro de ${mes} no se ha tocado (${cobro.motivo})`;
  if (cobro.estado === "sin-importe") return ` · OJO: no sale cobro de ${mes} (${cobro.motivo})`;
  if (cobro.estado === "retirado") return ` · su cobro de ${mes} se ha retirado de Cobros (${cobro.motivo})`;
  return "";
}

function colaDelLote(cobros) {
  if (!cobros) return "";
  const mes = mesLegible(mesActual());
  const partes = [];
  if (cobros.creados) partes.push(`${cobros.creados} ${cobros.creados === 1 ? "cobro" : "cobros"} de ${mes} en Cobros`);
  if (cobros.actualizados) partes.push(`${cobros.actualizados} al día`);
  if (cobros.sinImporte) partes.push(`${cobros.sinImporte} sin importe (revisa sus conceptos)`);
  if (cobros.intocables) partes.push(`${cobros.intocables} ya cobrados o facturados, sin tocar`);
  if (cobros.retirados) partes.push(`${cobros.retirados} ${cobros.retirados === 1 ? "cobro retirado" : "cobros retirados"} (ya no tocan este mes)`);
  return partes.length ? ` · ${partes.join(" · ")}` : "";
}

/* ── Alta (individual o EN GRUPO) y edición ────────────────────────────────
 * El mismo drawer para las dos cosas: en el alta se eligen destinatarios (uno
 * o cuarenta) y en la edición el destinatario ya está fijado. Lo que se teclea
 * —conceptos, importe, método, día, fechas— es idéntico, y separarlo en dos
 * formularios era garantizar que dentro de un mes divergieran.
 */
function DrawerCuota({ conceptos, cuota = null, inicial = null, ivaSugerido = 21, onConceptoCreado, abrirCatalogo = false, onClose, onDone }) {
  const editando = !!cuota;
  // El formulario de «una cuota nueva del catálogo», dentro del propio alta.
  const [creandoCuotaCatalogo, setCreandoCuotaCatalogo] = useState(abrirCatalogo);
  const [form, setForm] = useState(() =>
    cuota
      ? {
          conceptIds: Array.isArray(cuota.conceptIds) ? cuota.conceptIds.map(String) : [],
          amount: cuota.amount ?? "",
          method: cuota.method ?? "transfer",
          dayOfMonth: cuota.dayOfMonth ?? "",
          startDate: String(cuota.startDate ?? "").slice(0, 10),
          endDate: cuota.endDate ? String(cuota.endDate).slice(0, 10) : "",
          notes: cuota.notes ?? "",
        }
      // Desde el filtro de una cuota, el alta nace con ESA cuota puesta:
      // «añadir un paciente al grupo» es abrir y elegirlo.
      : { ...CUOTA_VACIA(), ...(inicial ?? {}) }
  );
  const [destinatarios, setDestinatarios] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  // El buscador del catálogo de cuotas (04/09/2026): 46 conceptos no caben en
  // un cajón de 176 px.
  const [buscaCatalogo, setBuscaCatalogo] = useState("");

  const porId = useMemo(() => new Map(conceptos.map((c) => [String(c.id), c])), [conceptos]);
  const sumaConceptos = form.conceptIds.reduce((s, id) => s + Number(porId.get(String(id))?.unitPrice || 0), 0);
  const importeFinal = form.amount === "" ? sumaConceptos : Number(form.amount || 0);

  // Lo que se ve en la lista del catálogo: lo que casa con la búsqueda MÁS lo
  // ya marcado, que no se puede esconder (ver el comentario del buscador).
  const conceptosVisibles = useMemo(
    () => conceptos.filter((c) => form.conceptIds.includes(String(c.id)) || coincidePorNombre(buscaCatalogo, [c.name])),
    [conceptos, buscaCatalogo, form.conceptIds]
  );

  function alternarConcepto(id) {
    setForm((f) => ({
      ...f,
      conceptIds: f.conceptIds.includes(id) ? f.conceptIds.filter((x) => x !== id) : [...f.conceptIds, id],
    }));
  }

  async function guardar() {
    setError(null);
    if (!editando && destinatarios.length === 0) {
      setError("Elige al menos un paciente o una familia");
      return;
    }
    setGuardando(true);
    try {
      const cuerpo = {
        conceptIds: form.conceptIds,
        amount: form.amount === "" ? null : Number(form.amount),
        method: form.method || null,
        dayOfMonth: form.dayOfMonth === "" ? null : Number(form.dayOfMonth),
        startDate: form.startDate,
        endDate: form.endDate || null,
        notes: form.notes || null,
      };
      const r = editando
        ? await fetch(`/api/billing/cuotas/${cuota.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
          })
        : await fetch("/api/billing/cuotas", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...cuerpo, destinatarios: destinatarios.map((d) => ({ clientId: d.clientId, patientId: d.patientId })) }),
          });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");

      if (editando) { onDone(`Cuota actualizada${colaDelCobro(j.data?.cobro)}`); return; }
      // En grupo puede haber saltadas (ya tenían cuota): se enseñan antes de
      // cerrar, que si no nadie se entera de que faltan.
      if (j.data?.omitidas?.length) setResultado(j.data);
      // Y se dice qué ha pasado con el cobro: desde el 05/09/2026 (AV-0048) la
      // cuota nueva llega SOLA a Cobros, así que lo que hay que contar ya no es
      // lo que falta por hacer, sino lo que se ha hecho.
      else onDone(`${j.data.creadas} ${j.data.creadas === 1 ? "cuota creada" : "cuotas creadas"}${colaDelLote(j.data?.cobros)}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[620px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">{editando ? "Editar" : "Alta"}</div>
            <h2 className="font-display text-xl text-neutral-900 mt-1">
              {editando ? "Modificar la cuota" : "Nueva cuota mensual"}
            </h2>
            {!editando && (
              <p className="text-[11px] text-neutral-400 mt-1">
                Se puede dar de alta la misma cuota a varios pacientes de una vez.
              </p>
            )}
          </div>
          <button onClick={() => !guardando && onClose()} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {resultado ? (
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-neutral-800">
              <span className="font-semibold text-emerald-700">{resultado.creadas} creadas</span>
              {" · "}
              <span className="font-semibold text-amber-700">{resultado.omitidas.length} sin crear</span>
            </p>
            <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden">
              {resultado.omitidas.map((o, i) => (
                <li key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-800">{o.nombre ?? o.clientId}</span>
                  <span className="text-amber-700">{o.motivo}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button onClick={() => onDone(`${resultado.creadas} cuotas creadas`)}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
                style={{ background: "var(--color-primary, #1B3A2D)" }}>Cerrar</button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</div>}

            {editando ? (
              <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm">
                <div className="text-neutral-800">{cuota.client?.fiscalName || cuota.client?.name}</div>
                {cuota.patient && (
                  <div className="text-xs text-neutral-500">{cuota.patient.firstName} {cuota.patient.lastName}</div>
                )}
              </div>
            ) : (
              <SelectorDestinatarios valores={destinatarios} onChange={setDestinatarios} />
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cuotas del catálogo</label>
                {!creandoCuotaCatalogo && (
                  <button type="button" onClick={() => setCreandoCuotaCatalogo(true)}
                    className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900">+ Crear una nueva</button>
                )}
              </div>

              {/* La cuota nueva se crea AQUÍ y queda marcada (01/09/2026). */}
              {creandoCuotaCatalogo && (
                <AltaCuotaCatalogo
                  ivaSugerido={ivaSugerido}
                  onCancelar={() => setCreandoCuotaCatalogo(false)}
                  onCreada={(c) => {
                    onConceptoCreado?.(c);
                    setForm((fo) => ({ ...fo, conceptIds: [...fo.conceptIds, String(c.id)] }));
                    setCreandoCuotaCatalogo(false);
                  }}
                />
              )}

              {/*
                ── BUSCADOR DE CUOTAS MENSUALES (04/09/2026, Rodrigo) ─────────
                El catálogo de Aumenta tiene 46 conceptos y esta lista es un
                cajón de 176 px: elegir una cuota era rodar la rueda del ratón
                hasta encontrarla. Filtra por nombre sin importar tildes
                (`coincidePorNombre`, la misma regla que el resto de buscadores
                del CRM), y las YA MARCADAS no se esconden nunca — si no, al
                escribir desaparecerían de la vista las que se acaban de elegir
                y no habría forma de quitarlas.

                Solo sale a partir de 8: en un centro con cuatro cuotas, un
                buscador es una caja vacía que estorba.
              */}
              {conceptos.length >= 8 && (
                <input
                  value={buscaCatalogo}
                  onChange={(e) => setBuscaCatalogo(e.target.value)}
                  placeholder="Buscar una cuota del catálogo…"
                  className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
                />
              )}
              {conceptos.length === 0 ? (
                <p className="text-xs text-neutral-400 mt-1">
                  No hay ninguna cuota en el catálogo todavía. Crea la primera con{" "}
                  <b>+ Crear una nueva</b> — es el mismo catálogo de{" "}
                  <Link href="/facturacion/configuracion" className="underline">Configuración → Conceptos y cuotas</Link>,
                  y por eso una subida de precio se aplica sola a todas las familias.
                </p>
              ) : (
                <div className="mt-1 max-h-44 overflow-y-auto border border-neutral-100 rounded-xl divide-y divide-neutral-50">
                  {conceptosVisibles.length === 0 && (
                    <p className="px-3 py-4 text-center text-[11px] text-neutral-400">
                      Ninguna cuota del catálogo se llama así.
                    </p>
                  )}
                  {conceptosVisibles.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-neutral-50">
                      <input type="checkbox" checked={form.conceptIds.includes(String(c.id))}
                        onChange={() => alternarConcepto(String(c.id))}
                        className="accent-[var(--color-primary,#1B3A2D)]" />
                      <span className="min-w-0 flex-1 truncate text-neutral-800">{c.name}</span>
                      <span className="tabular text-neutral-500">{fmtMoney(c.unitPrice)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Importe al mes</label>
                <input type="number" step="0.01" value={form.amount} placeholder={sumaConceptos ? String(sumaConceptos) : "0,00"}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputCls} />
                <p className="text-[10px] text-neutral-400">
                  {form.amount === ""
                    ? "Vacío = lo que digan sus conceptos (una subida de precio se aplica sola)."
                    : "Precio pactado: manda sobre el de los conceptos."}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cómo se cobra</label>
                <Select value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v }))}
                  options={METODOS} className={inputCls} />
                <p className="text-[10px] text-neutral-400">Es lo que permite generar «solo las de banco».</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Día de cobro</label>
                <input type="number" min="1" max="31" value={form.dayOfMonth} placeholder="1"
                  onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))} className={inputCls} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Desde *</label>
                <input type="date" value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={inputCls} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Baja</label>
                <input type="date" value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className={inputCls} />
              </div>
            </div>
            {/* «Durante N meses»: escribe la fecha de baja para no contarla a
                mano (01/09/2026, Rodrigo). Volver a pulsar el mismo la quita. */}
            <div className="-mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mr-1">Durante</span>
              {DURACIONES.map((d) => {
                const fecha = bajaTrasMeses(form.startDate, d.meses);
                const puesta = !!fecha && form.endDate === fecha;
                return (
                  <button key={d.meses} type="button" disabled={!fecha}
                    onClick={() => setForm((fo) => ({ ...fo, endDate: puesta ? "" : fecha }))}
                    title={fecha ? `Baja el ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}` : "Pon antes la fecha de alta"}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border transition disabled:opacity-40 ${puesta ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400"}`}
                    style={puesta ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
                    {d.label}
                  </button>
                );
              })}
              {form.endDate && (
                <button type="button" onClick={() => setForm((fo) => ({ ...fo, endDate: "" }))}
                  className="px-2 py-1 text-[11px] text-neutral-400 hover:text-rose-600">quitar fin</button>
              )}
            </div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              {form.endDate
                ? `Se cobran ${mesesDeTramo(form.startDate, form.endDate) ?? "?"} ${mesesDeTramo(form.startDate, form.endDate) === 1 ? "mes" : "meses"} y al terminar pasa sola al cuadro de bajas, sin salir del grupo: un clic la reintegra.`
                : "Sin fecha de baja se cobra todos los meses hasta que se dé de baja a mano."}
              {" "}El mes del alta y el de la baja se cobran prorrateados por días, y la cuenta queda
              escrita en el cobro.
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Notas</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-neutral-100">
              <p className="text-xs text-neutral-500">
                {editando ? "Se cobrará " : `${destinatarios.length} ${destinatarios.length === 1 ? "destinatario" : "destinatarios"} · `}
                <b className="tabular text-neutral-900">{fmtMoney(importeFinal)}</b>
                {!editando && destinatarios.length > 1 && <> · <span className="tabular">{fmtMoney(importeFinal * destinatarios.length)}</span> al mes en total</>}
              </p>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                <button type="button" onClick={guardar} disabled={guardando || !form.startDate}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>
                  {guardando ? "Guardando..." : editando ? "Guardar" : "Dar de alta"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

/* ── Los destinatarios del alta en grupo ───────────────────────────────────
 * Se buscan PACIENTES (que es como los conoce el centro) y de cada uno se
 * arrastra su familia pagadora, que es quien acaba pagando. Sin módulo
 * asistencial no hay pacientes: se cae al selector de fichas de siempre.
 */
function SelectorDestinatarios({ valores, onChange }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [hayPacientes, setHayPacientes] = useState(true);
  const [buscando, setBuscando] = useState(false);

  // El vaciado va DENTRO del temporizador, no en el cuerpo del efecto: un
  // setState sincrono ahi encadena renders (y lo canta el lint).
  useEffect(() => {
    const t = texto.trim();
    const id = setTimeout(() => {
      if (t.length < 2) { setResultados([]); return; }
      setBuscando(true);
      fetch(`/api/pacientes?q=${encodeURIComponent(t)}&limit=10`, { cache: "no-store" })
        .then(async (r) => {
          // Sin modulo asistencial la puerta responde 403: se cae al selector
          // de fichas en vez de dejar el buscador mudo.
          if (r.status === 403) { setHayPacientes(false); return { data: {} }; }
          return r.json();
        })
        .then((j) => setResultados(j?.data?.patients ?? []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(id);
  }, [texto]);

  function añadir(p) {
    if (!p.clientId) return; // sin familia pagadora no se puede cobrar
    if (valores.some((v) => v.patientId === p.id)) return;
    onChange([...valores, {
      patientId: p.id,
      clientId: p.clientId,
      etiqueta: `${p.firstName} ${p.lastName}`,
      familia: p.client?.name ?? "",
    }]);
    setTexto("");
    setResultados([]);
  }

  function añadirFamilia(clientId, ficha) {
    if (!clientId || valores.some((v) => v.clientId === clientId && !v.patientId)) return;
    onChange([...valores, { patientId: null, clientId, etiqueta: ficha?.name ?? "Familia", familia: ficha?.name ?? "" }]);
  }

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
        A quién se le pone esta cuota *
      </label>

      {hayPacientes ? (
        <div className="relative">
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar paciente por nombre…" className={inputCls} />
          {texto.trim().length >= 2 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {buscando && <div className="px-3 py-2 text-xs text-neutral-400">Buscando…</div>}
              {!buscando && resultados.length === 0 && <div className="px-3 py-2 text-xs text-neutral-400">Sin resultados</div>}
              {resultados.map((p) => (
                <button key={p.id} type="button" onClick={() => añadir(p)}
                  disabled={!p.clientId}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-neutral-800">{p.firstName} {p.lastName}</span>
                  <span className="text-neutral-400"> · {p.client?.name ?? "sin familia pagadora"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <SelectorCliente value="" onChange={añadirFamilia} fuente="billing" className={inputCls}
          placeholder="Buscar familia…" />
      )}

      {valores.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {valores.map((v, i) => (
            <li key={`${v.clientId}-${v.patientId ?? "x"}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-neutral-100 text-[11px] text-neutral-700">
              {v.etiqueta}
              <button type="button" onClick={() => onChange(valores.filter((_, j) => j !== i))}
                className="text-neutral-400 hover:text-rose-600">×</button>
            </li>
          ))}
        </ul>
      )}
      {valores.length > 1 && (
        <p className="text-[10px] text-neutral-400">
          Se creará una cuota por cada uno. Quien ya tenga una cuota activa se salta y te lo digo.
        </p>
      )}
    </div>
  );
}

/* ── Generar los cobros del mes ────────────────────────────────────────────── */
function DrawerGenerar({ onClose, onDone }) {
  const [mes, setMes] = useState(mesActual());
  const [metodos, setMetodos] = useState([]);
  const [preview, setPreview] = useState(null);
  const [excluidas, setExcluidas] = useState(() => new Set());
  const [cargando, setCargando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    setCargando(true);
    setError(null);
    setExcluidas(new Set());
    const qs = new URLSearchParams({ mes });
    metodos.forEach((m) => qs.append("metodo", m));
    fetch(`/api/billing/cuotas/generar?${qs}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.error || "Error");
        setPreview(j.data);
      })
      .catch((e) => { setPreview(null); setError(e.message); })
      .finally(() => setCargando(false));
  }, [mes, metodos]);

  const elegidas = useMemo(
    () => (preview?.aGenerar ?? []).filter((f) => !excluidas.has(f.cuotaId)),
    [preview, excluidas]
  );
  const importe = elegidas.reduce((s, f) => s + Number(f.importe || 0), 0);

  function alternarMetodo(m) {
    setMetodos((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function generar() {
    setGenerando(true);
    setError(null);
    try {
      const r = await fetch("/api/billing/cuotas/generar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, metodos, excluir: [...excluidas] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error");
      setResultado(j.data);
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !generando && onClose()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[600px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Cuotas</div>
            <h2 className="font-display text-xl text-neutral-900 mt-1">Generar el mes</h2>
            <p className="text-[11px] text-neutral-400 mt-1">
              Un cobro por cuota vigente, PENDIENTE de cobrar. Relanzarlo no duplica.
            </p>
          </div>
          <button onClick={() => !generando && onClose()} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {resultado ? (
          <div className="px-6 py-5 space-y-4">
            <div className="text-sm text-neutral-800">
              <span className="font-semibold text-emerald-700">
                {resultado.creados} {resultado.creados === 1 ? "cobro creado" : "cobros creados"}
              </span>
              {resultado.saltados > 0 && <> · <span className="text-amber-700">{resultado.saltados} saltados</span></>}
              <span className="text-neutral-400"> · <span className="tabular">{fmtMoney(resultado.importe)}</span></span>
            </div>
            <p className="text-xs text-neutral-500">
              Están en <Link href="/facturacion/cobros" className="underline font-semibold">Cobros</Link> como{" "}
              <b>pendientes</b>. Según entre el dinero, se pasan a cobrados; solo entonces cuentan
              para Morosidad y para «Facturar el mes».
            </p>
            <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
              {resultado.resultados.map((r) => (
                <li key={`${r.cuotaId}-${r.resultado}`} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-800">
                    {r.nombre}{r.paciente && <span className="text-neutral-400"> · {r.paciente}</span>}
                  </span>
                  {r.resultado === "creado"
                    ? <span className="text-emerald-700">creado</span>
                    : <span className="text-amber-700">{r.motivo}</span>}
                  <span className="font-semibold tabular text-neutral-900">{fmtMoney(r.importe)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
                style={{ background: "var(--color-primary, #1B3A2D)" }}>Cerrar</button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Mes</label>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={inputCls} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Qué generar</label>
              <div className="flex flex-wrap gap-2">
                {METODOS.map((m) => (
                  <button key={m.value} type="button" onClick={() => alternarMetodo(m.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${metodos.includes(m.value) ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
                    style={metodos.includes(m.value) ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-neutral-400">Sin elegir ninguno, entran todas.</p>
            </div>

            {cargando && <div className="text-xs text-neutral-400 py-6 text-center">Mirando qué cuotas tocan…</div>}
            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</div>}

            {!cargando && preview && (
              <>
                <p className="text-xs text-neutral-500">
                  {preview.aGenerar.length === 0
                    ? "No hay cuotas pendientes de generar en ese mes."
                    : <>
                        <b>{preview.totales.cuotas}</b> {preview.totales.cuotas === 1 ? "cuota" : "cuotas"},{" "}
                        <b className="tabular">{fmtMoney(preview.totales.importe)}</b>
                        {preview.totales.prorrateadas > 0 && <> · {preview.totales.prorrateadas} prorrateadas</>}
                      </>}
                </p>

                {preview.repetidas.length > 0 && (
                  <div className="bg-neutral-50 border border-neutral-100 rounded-xl px-4 py-3 text-[11px] text-neutral-500">
                    {preview.repetidas.length} {preview.repetidas.length === 1 ? "cuota ya tenía" : "cuotas ya tenían"} su cobro de este mes: no se vuelven a generar.
                  </div>
                )}

                {preview.sinImporte.length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1.5">
                      {preview.sinImporte.length} sin importe: no se pueden generar
                    </p>
                    <ul className="space-y-1 max-h-28 overflow-y-auto">
                      {preview.sinImporte.map((f) => (
                        <li key={f.cuotaId} className="text-[11px] text-amber-800 truncate">{f.nombre} — {f.motivo}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.totales.sinMetodo > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 text-[11px] text-amber-800">
                    {preview.totales.sinMetodo} sin método de cobro: se registrarán como{" "}
                    <b>{METODO_CORTO[preview.metodoPorDefecto]}</b>.
                  </div>
                )}

                {preview.aGenerar.length > 0 && (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-neutral-500">
                      <span>{elegidas.length} de {preview.aGenerar.length} marcadas</span>
                      <span className="flex gap-2">
                        <button type="button" onClick={() => setExcluidas(new Set())} className="underline hover:text-neutral-800">Marcar todas</button>
                        <button type="button" onClick={() => setExcluidas(new Set(preview.aGenerar.map((f) => f.cuotaId)))} className="underline hover:text-neutral-800">Desmarcar todas</button>
                      </span>
                    </div>
                    <ul className="divide-y divide-neutral-50 border border-neutral-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto ink-scroll">
                      {preview.aGenerar.map((f) => (
                        <li key={f.cuotaId} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                          <input type="checkbox" checked={!excluidas.has(f.cuotaId)}
                            onChange={() => setExcluidas((prev) => {
                              const n = new Set(prev);
                              if (n.has(f.cuotaId)) n.delete(f.cuotaId); else n.add(f.cuotaId);
                              return n;
                            })}
                            className="accent-[var(--color-primary,#1B3A2D)]" />
                          <span className="min-w-0 flex-1 truncate text-neutral-800">
                            {f.nombre}
                            {f.paciente && <span className="text-neutral-400"> · {f.paciente}</span>}
                            {f.rotulo && <span className="text-amber-600"> · {f.rotulo}</span>}
                          </span>
                          <span className="text-neutral-400">{METODO_CORTO[f.method] ?? "—"}</span>
                          <span className="font-semibold tabular text-neutral-900">{fmtMoney(f.importe)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-neutral-100">
                  <p className="text-[10px] text-neutral-400 min-w-0">
                    Los cobros nacen pendientes: generar no es cobrar.
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={onClose}
                      className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                    <button type="button" onClick={generar} disabled={generando || elegidas.length === 0}
                      className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                      style={{ background: "var(--color-primary, #1B3A2D)" }}>
                      {generando ? "Generando..." : `Generar ${elegidas.length} · ${fmtMoney(importe)}`}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </aside>
    </>
  );
}


/* ── Una cuota NUEVA del catálogo, sin salir de aquí ────────────────────────
 * 01/09/2026, Rodrigo: «crear nueva cuota no crea realmente una nueva cuota,
 * porque no hay una opción de añadir cuota en la lista de cuotas». Y era
 * verdad: «+ Nueva cuota» da de alta a QUIÉN paga, pero la cuota en sí —lo que
 * el centro llama la cuota: «Logopedia 60x2 · 190 €»— solo se creaba en
 * Configuración, y desde aquí lo único que había era un enlace de texto.
 *
 * Es el MISMO catálogo y la misma puerta (POST /api/billing/conceptos), no una
 * copia: lo que se cree aquí sale en Configuración, en las facturas y en los
 * talleres, y subirle el precio allí se aplica solo a todas las familias que
 * la tengan sin importe pactado. Aquí se piden los tres datos que hacen falta
 * para cobrarla; el texto de factura, la categoría y el resto se afinan allí.
 */
function AltaCuotaCatalogo({ ivaSugerido = 21, onCreada, onCancelar }) {
  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [vatRate, setVatRate] = useState(String(ivaSugerido));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function crear() {
    if (guardando) return;
    if (!name.trim()) { setError("Ponle nombre a la cuota"); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/billing/conceptos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          unitPrice: Number(unitPrice || 0),
          vatRate: Number(vatRate || 0),
          // Nace desde la pantalla de cuotas mensuales: eso es lo que es.
          periodicity: "mensual",
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo crear la cuota");
      onCreada(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 px-3 py-3 space-y-2">
      <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest">Cuota nueva del catálogo</p>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && crear()}
          placeholder="Nombre — p. ej. Logopedia 60 min x2"
          className={`${inputCls} sm:flex-1`}
        />
        <input
          type="number" step="0.01" value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && crear()}
          placeholder="€ al mes"
          className={`${inputCls} sm:w-28`}
        />
        <input
          type="number" step="0.01" min="0" max="100" value={vatRate}
          onChange={(e) => setVatRate(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && crear()}
          placeholder="IVA %"
          title="IVA en %"
          className={`${inputCls} sm:w-20`}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-neutral-400">
          Se guarda en el catálogo del centro y queda marcada aquí abajo.
        </p>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={onCancelar}
            className="px-3 py-1.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
          <button type="button" onClick={crear} disabled={guardando || !name.trim()}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide text-white disabled:opacity-50"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            {guardando ? "Creando..." : "Crear cuota"}
          </button>
        </div>
      </div>
    </div>
  );
}
