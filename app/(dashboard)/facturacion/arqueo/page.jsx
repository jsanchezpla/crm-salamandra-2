"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hoyVigente } from "@/lib/billing/cuotas.js";
import { fondoSugerido } from "@/lib/billing/caja.js";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import MovimientosCaja from "../_components/MovimientosCaja.jsx";
import ResumenCaja from "../_components/ResumenCaja.jsx";
import EfectivoCaja from "../_components/EfectivoCaja.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const fmt = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

const hoy = () => hoyVigente();

/** Los céntimos, una vez: la misma cuenta que hace el servidor al cerrar. */
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** «2026-07-31» → «31/07/2026». La casilla habla de un día concreto. */
const fmtFecha = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
};

export default function ArqueoPage() {
  const [cajas, setCajas] = useState([]);
  const [cajaId, setCajaId] = useState("");
  const [cierres, setCierres] = useState([]);
  // El último cierre de esta caja, para proponer el fondo del siguiente
  // (07/09/2026, AV-0067). Viene del servidor al margen del filtro de fechas.
  const [ultimoCierre, setUltimoCierre] = useState(null);
  const [resumen, setResumen] = useState({ total: 0, conDescuadre: 0, totalDescuadre: 0 });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [soloDescuadres, setSoloDescuadres] = useState(false);
  /*
   * ── EL BUSCADOR (10/09/2026, Rodrigo: «necesito un buscador en la parte de
   * arqueo») ────────────────────────────────────────────────────────────────
   *
   * La tabla pintaba TODOS los cierres de la caja —828 en Aumenta, importados
   * de Organízate, más los de cada día— y para llegar a uno había que bajar
   * con el ratón. Se busca por día, motivo, quién cerró e importe, y además
   * por rango de fechas, que el endpoint ya entendía y la pantalla no ofrecía.
   *
   * Lo resuelve el SERVIDOR (`lib/billing/busquedaArqueo.js`): filtrar en el
   * navegador solo miraría lo ya descargado. Se manda 300 ms después de la
   * última tecla, como en Cobros, para no pedir una consulta por letra.
   */
  const [buscaInput, setBuscaInput] = useState("");
  const [busca, setBusca] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // Tres cosas distintas sobre el mismo cajon: los cierres de siempre, los
  // apuntes de entrada/salida y el resumen por dia (01/09/2026). Pestanas y no
  // tres pantallas: se miran seguidas, cuadrando el dia.
  const [vista, setVista] = useState("cierres");

  const [showCaja, setShowCaja] = useState(false);
  const [nombreCaja, setNombreCaja] = useState("");

  const [showCierre, setShowCierre] = useState(false);
  const [form, setForm] = useState({ closeDate: hoy(), openingAmount: "", countedAmount: "", notes: "" });
  // El desglose que manda el servidor: cobros en efectivo del día, entradas,
  // salidas, el arrastre de los días sin cerrar y el fondo del que se parte.
  const [previo, setPrevio] = useState(null);
  const [cargandoPrevio, setCargandoPrevio] = useState(false);
  // Qué casillas ha tocado la persona: mientras no toque, las escribe el
  // sistema y se rehacen solas al cambiar de día (10/09/2026).
  const tocado = useRef({ fondo: false, contado: false });
  const [cajaVaciaOk, setCajaVaciaOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const cargarCajas = useCallback(async () => {
    try {
      const r = await fetch("/api/arqueo/cajas", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar las cajas");
      const lista = j.data?.cajas ?? [];
      setCajas(lista);
      setCajaId((prev) => prev || lista[0]?.id || "");
    } catch (e) {
      setErrorMsg(e.message);
    }
  }, []);

  const cargarCierres = useCallback(async () => {
    if (!cajaId) {
      setCierres([]);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({ cajaId });
      if (soloDescuadres) qs.set("soloDescuadres", "1");
      if (busca) qs.set("q", busca);
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const r = await fetch(`/api/arqueo/cierres?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los cierres");
      setCierres(j.data?.cierres ?? []);
      setUltimoCierre(j.data?.ultimoCierre ?? null);
      setResumen({
        total: j.data?.total ?? 0,
        conDescuadre: j.data?.conDescuadre ?? 0,
        totalDescuadre: j.data?.totalDescuadre ?? 0,
      });
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [cajaId, soloDescuadres, busca, desde, hasta]);

  useEffect(() => {
    cargarCajas();
  }, [cargarCajas]);
  useEffect(() => {
    cargarCierres();
  }, [cargarCierres]);

  // Lo escrito se manda 300 ms después de la última tecla.
  useEffect(() => {
    const id = setTimeout(() => setBusca(buscaInput.trim()), 300);
    return () => clearTimeout(id);
  }, [buscaInput]);

  async function crearCaja(e) {
    e.preventDefault();
    if (!nombreCaja.trim()) return;
    try {
      const r = await fetch("/api/arqueo/cajas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nombreCaja.trim() }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo crear la caja");
      setNombreCaja("");
      setShowCaja(false);
      await cargarCajas();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  /*
   * El fondo NO se abre vacío: se propone lo que se contó en el cierre
   * anterior, que es con lo que se abre un cajón de verdad (AV-0067 de
   * Aumenta: «no puedo cuadrar saldo porque no sé de qué saldo habéis
   * partido»). Es una propuesta y no un dato: se cambia antes de comprobar, y
   * sin cierre anterior se deja vacía y se dice por qué.
   */
  const fondoDeAyer = fondoSugerido(ultimoCierre);
  /*
   * El que vale para el día que se está cerrando: el servidor busca el último
   * cierre anterior a ESA fecha (cerrando un día atrasado, el fondo bueno no es
   * el del último cierre de todos). Mientras llega su respuesta, el de ayer.
   */
  const fondoDelDia = previo?.fondo ?? fondoDeAyer;

  /*
   * ¿Hay algo puesto? Con un filtro, una tabla vacía no quiere decir «aquí no
   * se cierra la caja» sino «no hay ninguno que case», y son dos frases
   * distintas. También decide si se ofrece quitar los filtros.
   */
  const filtrando = Boolean(busca || desde || hasta || soloDescuadres);

  function abrirCierre() {
    setForm({
      closeDate: hoy(),
      openingAmount: fondoDeAyer ? String(fondoDeAyer.importe) : "",
      countedAmount: "",
      notes: "",
    });
    setPrevio(null);
    tocado.current = { fondo: false, contado: false };
    setCajaVaciaOk(false);
    setFormError(null);
    setShowCierre(true);
  }

  /**
   * ── EL CIERRE LO ESCRIBE EL SISTEMA (10/09/2026, Aumenta) ─────────────────
   *
   * Hasta hoy el desglose se pedía DESPUÉS de teclear lo contado, para que la
   * cifra objetivo no estuviera a la vista mientras se contaba el cajón. La
   * idea era buena y lo que pasaba en recepción era otra cosa: el número se
   * escribía de memoria y el cierre no salía de ningún sitio («Rosa escribe lo
   * que quiere»). Así que ahora la cuenta entera —fondo, cobros en efectivo,
   * entradas, salidas y los días que quedaron sin cerrar— sale sola al abrir,
   * y quien cierra solo corrige si al contar hay otra cosa. Lo que se guarda lo
   * recalcula el servidor, que es quien manda.
   */
  useEffect(() => {
    if (!showCierre || !cajaId || !form.closeDate) return undefined;
    let vivo = true;
    setCargandoPrevio(true);
    (async () => {
      try {
        const r = await fetch("/api/arqueo/cierres", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cashPointId: cajaId, closeDate: form.closeDate }),
        });
        const j = await r.json();
        if (!vivo) return;
        if (!j.ok) throw new Error(j.error || "No se pudo calcular lo que debería haber en el cajón");
        setPrevio(j.data);
        // El fondo bueno es el del ÚLTIMO cierre anterior a ESE día, y lo sabe
        // el servidor: cerrando un martes que se quedó atrás, no vale el del
        // viernes. Si la persona ya lo ha tocado, mandan sus dedos.
        if (!tocado.current.fondo) {
          setForm((f) => ({ ...f, openingAmount: j.data.fondo ? String(j.data.fondo.importe) : "" }));
        }
      } catch (e) {
        if (vivo) setFormError(e.message);
      } finally {
        if (vivo) setCargandoPrevio(false);
      }
    })();
    return () => { vivo = false; };
  }, [showCierre, cajaId, form.closeDate]);

  /*
   * Lo que debería quedar, rehecho al vuelo: el fondo se puede corregir a mano
   * (el sobre que fue al banco, el cambio que se metió) y la cuenta tiene que
   * seguirle sin ir y volver al servidor. Es la misma suma que hace
   * `esperadoAlCerrar` allí, y el POST la recalcula antes de guardar.
   */
  const esperado =
    previo === null
      ? null
      : redondear(
          Number(form.openingAmount || 0) + Number(previo.arrastre?.importe || 0) + Number(previo.netoDelDia || 0)
        );

  // Y el cierre se abre con esa cifra escrita: es el encargo del centro.
  useEffect(() => {
    if (esperado === null || tocado.current.contado) return;
    setForm((f) => (f.countedAmount === String(esperado) ? f : { ...f, countedAmount: String(esperado) }));
  }, [esperado]);

  async function guardar(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const r = await fetch("/api/arqueo/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, cashPointId: cajaId, cajaVaciaConfirmada: cajaVaciaOk }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cerrar la caja");
      setShowCierre(false);
      // A la lista de cierres: se acaba de crear una fila y hay que verla (y
      // las otras pestañas se quedarían con los números de antes de cerrar).
      setVista("cierres");
      await cargarCierres();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const contado = form.countedAmount === "" ? null : Number(form.countedAmount);
  const dif = esperado !== null && contado !== null ? redondear(contado - esperado) : null;
  /*
   * «La caja nunca queda a cero porque hay que mantener efectivo para hacer el
   * cambio a los pacientes» (Aumenta, 10/09/2026). Un cero casi siempre es un
   * cierre sin contar, y encima se arrastra al fondo del día siguiente.
   */
  const dejaLaCajaVacia = contado === 0;

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800 flex items-center gap-2">
            Arqueo de caja
            <HelpTooltip title="Arqueo de caja" placement="bottom">
              Cuentas el dinero que hay en el cajón y el CRM lo compara con lo que debería haber
              según los cobros en efectivo del día.
              {" "}
              <strong className="text-white">Un cierre es la FOTO de ese día</strong>: la
              diferencia se guarda tal cual y no se recalcula después, aunque luego corrijas un
              cobro. Por eso un descuadre viejo sigue ahí — es lo que pasó, no lo que debería
              haber pasado.
            </HelpTooltip>
          </h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Cuenta el dinero del cajón y compáralo con lo que debería haber. La diferencia queda registrada.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCaja(true)}
            className="text-[12.5px] px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
          >
            Nueva caja
          </button>
          <button
            onClick={abrirCierre}
            disabled={!cajaId}
            className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition disabled:opacity-40"
          >
            Cerrar caja
          </button>
        </div>
      </div>

      {cajas.length === 0 && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Todavía no hay ninguna caja. Crea una (por ejemplo «Recepción») para poder hacer arqueos.
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>
      )}

      {cajas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {cajas.length > 1 && (
            <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} className={`${inputCls} max-w-xs`}>
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-0.5">
            {[
              ["cierres", "Cierres"],
              ["movimientos", "Entradas y salidas"],
              ["resumen", "Resumen por día"],
              // Lo que QUEDA en el cajón, arrastrando el saldo (09/09/2026).
              ["efectivo", "Efectivo en caja"],
            ].map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setVista(k)}
                className={`text-[12.5px] px-3 py-1 rounded-md transition ${
                  vista === k ? "bg-[var(--color-primary,#1B3A2D)] text-white font-medium" : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── BUSCAR UN CIERRE (10/09/2026, Rodrigo) ─────────────────────────
          El buscador y el rango de fechas van juntos porque contestan a lo
          mismo: llegar a un día concreto. Escribir «31/07» basta; las dos
          casillas de fecha son para mirar un tramo entero. */}
      {cajas.length > 0 && vista === "cierres" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={buscaInput}
            onChange={(e) => setBuscaInput(e.target.value)}
            placeholder="Buscar por día, motivo, quién cerró o importe…"
            className="rounded-lg px-3 py-1.5 text-[12.5px] text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-80 placeholder-neutral-300"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} py-1.5`} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} py-1.5`} />
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
            <input type="checkbox" checked={soloDescuadres} onChange={(e) => setSoloDescuadres(e.target.checked)} />
            Solo los días que no cuadraron
          </label>
          {filtrando && (
            <button
              onClick={() => { setBuscaInput(""); setBusca(""); setDesde(""); setHasta(""); setSoloDescuadres(false); }}
              className="text-[12px] px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 transition"
            >
              Quitar filtros
            </button>
          )}
        </div>
      )}

      {vista === "movimientos" && <MovimientosCaja cajaId={cajaId} cajas={cajas} />}
      {vista === "resumen" && <ResumenCaja cajaId={cajaId} />}
      {vista === "efectivo" && <EfectivoCaja cajaId={cajaId} onApuntar={() => setVista("movimientos")} />}

      {vista === "cierres" && cierres.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Cierres</div>
            <div className="text-lg font-semibold text-neutral-800">{resumen.total}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Días con descuadre</div>
            <div className="text-lg font-semibold text-neutral-800">{resumen.conDescuadre}</div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">Descuadre acumulado</div>
            <div className={`text-lg font-semibold ${resumen.totalDescuadre < 0 ? "text-red-600" : resumen.totalDescuadre > 0 ? "text-amber-600" : "text-neutral-800"}`}>
              {fmt(resumen.totalDescuadre)}
            </div>
          </div>
        </div>
      )}

      {vista === "cierres" && (
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Fecha</th>
                <th className="text-right font-medium px-3 py-2">Fondo inicial</th>
                <th className="text-right font-medium px-3 py-2">Esperado</th>
                <th className="text-right font-medium px-3 py-2">Contado</th>
                <th className="text-right font-medium px-3 py-2">Descuadre</th>
                <th className="text-left font-medium px-3 py-2">Cerró</th>
                <th className="text-left font-medium px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>
              )}
              {!loading && cierres.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                    {busca || desde || hasta
                      ? "Ningún cierre casa con lo que buscas. Prueba con el día («31/07»), el motivo o el importe."
                      : soloDescuadres
                        ? "Ningún cierre con descuadre. Buena señal."
                        : "Todavía no se ha cerrado ninguna caja."}
                  </td>
                </tr>
              )}
              {!loading &&
                cierres.map((c) => {
                  const d = Number(c.difference || 0);
                  return (
                    <tr key={c.id} className="border-t border-neutral-100">
                      <td className="px-3 py-2">{c.closeDate}</td>
                      <td className="px-3 py-2 text-right text-neutral-500">{fmt(c.openingAmount)}</td>
                      <td className="px-3 py-2 text-right text-neutral-500">{fmt(c.expectedAmount)}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.countedAmount)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${d < 0 ? "text-red-600" : d > 0 ? "text-amber-600" : "text-neutral-400"}`}>
                        {d === 0 ? "cuadra" : fmt(d)}
                      </td>
                      <td className="px-3 py-2 text-neutral-500">{c.closedBy?.displayName || "—"}</td>
                      <td className="px-3 py-2 text-neutral-500">{c.notes || "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {showCaja && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowCaja(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-sm bg-white z-50 shadow-xl overflow-y-auto">
            <form onSubmit={crearCaja} className="p-5 space-y-4">
              <h2 className="text-base font-semibold text-neutral-800">Nueva caja</h2>
              <p className="text-[12px] text-neutral-500">
                Un punto donde se cobra en efectivo: recepción, mostrador… Cada caja se cuadra por separado.
              </p>
              <input value={nombreCaja} onChange={(e) => setNombreCaja(e.target.value)} placeholder="Recepción" className={inputCls} autoFocus />
              <button type="submit" className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition">
                Crear caja
              </button>
            </form>
          </div>
        </>
      )}

      {showCierre && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowCierre(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto">
            <form onSubmit={guardar} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-800">Cerrar caja</h2>
                <button type="button" onClick={() => setShowCierre(false)} className="text-neutral-400 hover:text-neutral-700">Cerrar</button>
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>
              )}

              <label className="block">
                <span className="text-[12px] text-neutral-500">Día que se cierra</span>
                <input
                  type="date"
                  value={form.closeDate}
                  onChange={(e) => {
                    // Otro día es otro fondo y otro conteo: los dos los vuelve
                    // a escribir el sistema.
                    tocado.current = { fondo: false, contado: false };
                    setForm({ ...form, closeDate: e.target.value });
                  }}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Fondo inicial (lo que había al abrir)</span>
                {/* Obligatorio: en blanco no es un cero, y desde que el fondo se
                    arrastra de un día a otro, dejarlo vacío cantaba un descuadre
                    falso por ese importe (07/09/2026). */}
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.openingAmount}
                  onChange={(e) => { tocado.current.fondo = true; setForm({ ...form, openingAmount: e.target.value }); }}
                  className={inputCls}
                  placeholder="0,00"
                />
                {/* De dónde sale el número: sin esto la casilla vuelve a ser un
                    hueco que nadie sabe rellenar, que es el aviso AV-0067. */}
                {fondoDelDia ? (
                  <span className="mt-1 block text-[11.5px] text-neutral-400">
                    Es lo que se contó al cerrar el {fmtFecha(fondoDelDia.fecha)}. Cámbialo si el dinero fue al banco o si has metido cambio.
                  </span>
                ) : (
                  <span className="mt-1 block text-[11.5px] text-neutral-400">
                    Es el primer cierre de esta caja: escribe el dinero que hay ahora en el cajón y a partir de aquí se arrastra solo.
                  </span>
                )}
              </label>

              {/* ── LA CUENTA, ENTERA Y ESCRITA POR EL SISTEMA (10/09/2026) ──
                  Sale sola al abrir: el fondo, lo cobrado en efectivo y las
                  entradas y salidas apuntadas. Antes había que pedirla con un
                  botón después de teclear el conteo, y el conteo se escribía de
                  memoria. */}
              {previo === null ? (
                <p className="text-[12px] text-neutral-400 text-center py-2">
                  {cargandoPrevio ? "Calculando lo que debería haber en el cajón…" : "—"}
                </p>
              ) : (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 space-y-1 text-[12.5px]">
                  <div className="flex justify-between text-neutral-600">
                    <span>Fondo del que se parte</span>
                    <span>{fmt(form.openingAmount || 0)}</span>
                  </div>
                  {/* Los días que nadie cerró siguen moviendo el cajón: sin
                      esta línea, su efectivo desaparecía del esperado. */}
                  {previo.arrastre && previo.arrastre.importe !== 0 && (
                    <div className="flex justify-between text-neutral-600">
                      <span>
                        Días sin cerrar desde el {fmtFecha(previo.arrastre.desde)}
                        {previo.arrastre.dias > 1 ? ` (${previo.arrastre.dias} días)` : ""}
                      </span>
                      <span>{previo.arrastre.importe > 0 ? "+" : ""}{fmt(previo.arrastre.importe)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-neutral-600">
                    <span>Cobros en efectivo del día ({previo.numCobros})</span>
                    <span>{fmt(previo.efectivoDelDia)}</span>
                  </div>
                  {previo.devueltoDelDia > 0 && (
                    <div className="flex justify-between text-neutral-600">
                      <span>Devuelto en efectivo ({previo.numDevoluciones})</span>
                      <span className="text-rose-600">− {fmt(previo.devueltoDelDia)}</span>
                    </div>
                  )}
                  {/* Las entradas y salidas apuntadas ese día también mueven el
                      cajón (01/09/2026): sin enseñarlas, el esperado sale de
                      una cuenta que la persona no puede seguir. */}
                  {previo.entradas > 0 && (
                    <div className="flex justify-between text-neutral-600">
                      <span>Entradas de caja apuntadas</span>
                      <span>+ {fmt(previo.entradas)}</span>
                    </div>
                  )}
                  {previo.salidas > 0 && (
                    <div className="flex justify-between text-neutral-600">
                      <span>Salidas de caja apuntadas</span>
                      <span className="text-rose-600">− {fmt(previo.salidas)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-neutral-800 pt-1 border-t border-neutral-200">
                    <span>Debería quedar en el cajón</span>
                    <span>{fmt(esperado)}</span>
                  </div>
                  {previo.numMovimientos === 0 && (
                    <p className="text-[11.5px] text-neutral-400 pt-0.5">
                      Sin entradas ni salidas apuntadas hoy. Lo que salga del cajón para otra cosa se apunta en «Entradas y salidas».
                    </p>
                  )}
                </div>
              )}

              <label className="block">
                <span className="text-[12px] text-neutral-500">Dinero contado en el cajón *</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.countedAmount}
                  onChange={(e) => { tocado.current.contado = true; setForm({ ...form, countedAmount: e.target.value }); }}
                  className={inputCls}
                  placeholder="0,00"
                />
                <span className="mt-1 block text-[11.5px] text-neutral-400">
                  Lo escribe el sistema con los cobros en efectivo y las entradas y salidas del día. Cámbialo solo si al contar el cajón hay otra cosa.
                </span>
              </label>

              {dif !== null && (
                <div
                  className={`flex justify-between rounded-lg border px-3 py-2 text-[12.5px] font-medium ${
                    dif === 0
                      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                      : dif < 0
                        ? "border-red-100 bg-red-50 text-red-700"
                        : "border-amber-100 bg-amber-50 text-amber-700"
                  }`}
                >
                  <span>{dif === 0 ? "Cuadra con la cuenta del sistema" : dif < 0 ? "Faltan" : "Sobran"}</span>
                  <span>{dif === 0 ? "✓" : fmt(Math.abs(dif))}</span>
                </div>
              )}

              {/* Un cajón a cero se pregunta: casi siempre es un cierre sin
                  contar, y el cero se arrastra al fondo de mañana. */}
              {dejaLaCajaVacia && (
                <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  <p>
                    El cajón se queda a 0 €. En un centro se deja siempre algo de efectivo para dar cambio, y
                    este número es el fondo con el que abrirás mañana.
                  </p>
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={cajaVaciaOk} onChange={(e) => setCajaVaciaOk(e.target.checked)} />
                    Sí, hoy el cajón se queda vacío
                  </label>
                </div>
              )}

              <label className="block">
                <span className="text-[12px] text-neutral-500">
                  Motivo {dif !== null && dif !== 0 ? "*" : "(opcional)"}
                </span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className={inputCls}
                  placeholder={dif !== null && dif !== 0 ? "Un «faltan 20 €» sin explicación no vale de nada dentro de seis meses" : ""}
                />
              </label>

              <button
                type="submit"
                disabled={saving || previo === null || (dejaLaCajaVacia && !cajaVaciaOk)}
                className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-40"
              >
                {saving ? "Guardando…" : "Cerrar el día"}
              </button>
              {previo === null && (
                <p className="text-[11.5px] text-neutral-400 text-center">Un momento: el sistema está haciendo la cuenta del día.</p>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  );
}
