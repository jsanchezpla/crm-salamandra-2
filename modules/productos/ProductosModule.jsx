"use client";

/**
 * ProductosModule — el catálogo de lo que se vende y su valor (03/09/2026).
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────────
 * Rodrigo: «agrupar Inventario, Pedidos y Tienda en un gran módulo llamado
 * Productos, con estadísticas, donde pueda poner los productos que vendo y su
 * valor». Hasta hoy el producto se daba de alta en Inventario y su precio se
 * podía tocar también desde la Tienda: dos sitios para el mismo dato, y ninguno
 * se llamaba «productos».
 *
 * ── LOS DOS NIVELES ────────────────────────────────────────────────────────
 *   básico    → esta lista: alta, edición, precio de venta y de compra, retirada.
 *   avanzado  → el bloque de estadísticas de venta de arriba y los accesos a
 *               Inventario, Pedidos y Tienda (que además cuelgan del menú).
 *
 * Quién tiene cuál lo decide la página en el servidor y llega por props:
 * `avanzado`, `conInventario`, `conPedidos`, `conTienda`. La lista enseña el
 * stock solo con Inventario y el «a la venta» solo con Tienda: sin esos
 * módulos, esas columnas son ruido.
 *
 * Los productos son LOS MISMOS que ven Inventario y Tienda (tabla `products`,
 * endpoint `/api/inventory/products`, gateado por `productos`): esta pantalla
 * no crea una segunda lista, es la dueña de la primera.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const UNIDADES = [
  { v: "ud", l: "unidades" }, { v: "caja", l: "cajas" }, { v: "paquete", l: "paquetes" },
  { v: "kg", l: "kilos" }, { v: "g", l: "gramos" }, { v: "l", l: "litros" }, { v: "ml", l: "mililitros" },
];

const fmtNum = (n) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(Number(n) || 0);
const fmtMoney = (n) =>
  n === null || n === undefined || n === "" ? "—"
    : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n));

/**
 * 'AAAA-MM-DD' EN LOCAL. Con `toISOString()` (UTC) el 1 de julio a las 00:00
 * en España se convierte en «30 de junio»: el periodo empezaba un día antes de
 * lo que decía el botón.
 */
function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const hoyISO = () => fechaISO(new Date());
function primeroDeMes() {
  const h = new Date();
  return fechaISO(new Date(h.getFullYear(), h.getMonth(), 1));
}
function trimestreActual() {
  const h = new Date();
  const t = Math.floor(h.getMonth() / 3);
  return { desde: fechaISO(new Date(h.getFullYear(), t * 3, 1)), hasta: hoyISO() };
}
function anioActual() {
  return { desde: `${new Date().getFullYear()}-01-01`, hasta: hoyISO() };
}
const MES_LABEL = (aaaaMm) => {
  const [a, m] = aaaaMm.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
};
const ORIGEN_LABEL = { manual: "Mostrador", tienda: "Tienda online" };

function nuevoProducto() {
  return { name: "", sku: "", category: "", unit: "ud", purchasePrice: "", salePrice: "", minStock: "", notes: "" };
}

function Kpi({ label, value, sub }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="text-2xl font-display mt-0.5 tabular text-[var(--ink-900)]">{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Barras horizontales sin librería: son pocas filas, no hace falta un motor. */
function Barras({ datos, etiqueta, valor, formatea = fmtMoney }) {
  const max = Math.max(1, ...datos.map((d) => Number(valor(d)) || 0));
  return (
    <div className="space-y-1.5">
      {datos.map((d, i) => {
        const v = Number(valor(d)) || 0;
        return (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <div className="w-28 shrink-0 truncate text-neutral-600" title={etiqueta(d)}>{etiqueta(d)}</div>
            <div className="flex-1 h-4 rounded bg-neutral-100 overflow-hidden">
              <div className="h-full rounded bg-[var(--color-primary,#1B3A2D)]/70" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="w-20 shrink-0 text-right tabular-nums text-neutral-700">{formatea(v)}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * «Lo más vendido»: las barras de siempre, y debajo de cada producto con
 * tallas u opciones, un desplegable con lo vendido de cada una (03/09/2026).
 * Para reponer hace falta saber qué talla se vende, no solo qué camiseta. El
 * producto sin variantes sale como una barra a secas.
 */
function RankingVentas({ filas }) {
  const [abiertos, setAbiertos] = useState(() => new Set());
  const alternar = (clave) =>
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(clave)) n.delete(clave); else n.add(clave);
      return n;
    });
  const max = Math.max(1, ...filas.map((d) => Number(d.importe) || 0));
  const margenCls = (m) => (m === null || m === undefined ? "text-neutral-300" : Number(m) < 0 ? "text-red-600" : "text-neutral-500");

  return (
    <div className="space-y-1.5">
      {filas.map((d, i) => {
        const clave = d.productId || `nombre:${d.nombre}`;
        const v = Number(d.importe) || 0;
        const conVariantes = Array.isArray(d.variantes) && d.variantes.length > 0;
        const abierto = abiertos.has(clave);
        return (
          <div key={i}>
            <div className="flex items-center gap-2 text-[12px]">
              <div className="w-28 shrink-0 min-w-0">
                <div className="truncate text-neutral-600" title={d.nombre}>{d.nombre}</div>
                {conVariantes && (
                  <button
                    type="button"
                    onClick={() => alternar(clave)}
                    className="text-[10.5px] text-[var(--color-primary,#1B3A2D)] hover:underline"
                    aria-expanded={abierto}
                  >
                    {abierto ? "▾" : "▸"} {d.variantes.length} talla{d.variantes.length === 1 ? "" : "s"} u opci{d.variantes.length === 1 ? "ón" : "ones"}
                  </button>
                )}
              </div>
              <div className="flex-1 h-4 rounded bg-neutral-100 overflow-hidden">
                <div className="h-full rounded bg-[var(--color-primary,#1B3A2D)]/70" style={{ width: `${(v / max) * 100}%` }} />
              </div>
              <div className="w-20 shrink-0 text-right tabular-nums text-neutral-700">{fmtMoney(v)}</div>
              <div className={`w-20 shrink-0 text-right tabular-nums ${margenCls(d.margen)}`}>
                {d.margen === null || d.margen === undefined ? "—" : fmtMoney(d.margen)}
              </div>
            </div>
            {conVariantes && abierto && (
              <ul className="ml-3 mt-1 mb-2 border-l border-neutral-200 pl-3 space-y-0.5">
                {d.variantes.map((va, j) => (
                  <li key={j} className="flex items-center gap-2 text-[11.5px] text-neutral-500">
                    <span className="flex-1 min-w-0 truncate" title={va.nombre}>{va.nombre}</span>
                    <span className="w-24 shrink-0 text-right tabular-nums">{fmtNum(va.unidades)} ud</span>
                    <span className="w-20 shrink-0 text-right tabular-nums">{fmtMoney(va.importe)}</span>
                    <span className="w-20 shrink-0" />
                  </li>
                ))}
                {d.unidades > d.variantes.reduce((s, va) => s + (Number(va.unidades) || 0), 0) && (
                  <li className="text-[10.5px] text-neutral-400">
                    y {fmtNum(d.unidades - d.variantes.reduce((s, va) => s + (Number(va.unidades) || 0), 0))} ud vendidas sin talla ni opción
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * El bloque de ventas del avanzado. Se pinta encima de la lista y no en otra
 * pantalla: la pregunta «¿qué se vende?» y la pregunta «¿a cuánto lo tengo?»
 * se hacen mirando la misma lista.
 */
/**
 * SERVICIOS — lo que vende un centro que vende sesiones (04/09/2026, Aumenta
 * por Rodrigo: «ahí saldrán todas las citas y las cuotas asignadas a cada cita
 * para medir de forma tanto terapéutica como económica a qué están apuntados
 * los pacientes y qué deben pagar»).
 *
 * Una fila por cuota del catálogo, y en la misma fila las dos medidas: qué
 * tipos de cita la cubren y cuántos pacientes están apuntados (lo terapéutico),
 * cuántas citas la llevan este mes y cuánto suma al mes (lo económico).
 *
 * Debajo, lo que falta por conectar: los tipos de cita sin cuota. Esa lista es
 * la mitad del encargo — mientras tenga filas, hay citas que nacen sin decir de
 * qué se cobran.
 */
function Servicios() {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/productos/servicios", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j.ok) throw new Error(j.error || "No se han podido cargar los servicios");
        setDatos(j.data);
      })
      .catch((e) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  if (cargando) return <div className="text-[12.5px] text-neutral-400">Cargando servicios…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>;
  if (!datos?.disponible) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-white px-4 py-8 text-center text-[12.5px] text-neutral-500">
        Los servicios salen del catálogo de cuotas de Facturación. Este centro no lo tiene.
      </div>
    );
  }

  const { servicios = [], sinCuota = [], totales } = datos;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Servicios con gente" value={`${totales.conCuotaViva}/${totales.servicios}`} sub="cuotas del catálogo en uso" />
        <Kpi label="Pacientes apuntados" value={totales.pacientes} sub="con cuota viva" />
        <Kpi label="Al mes" value={fmtMoney(totales.alMes)} sub="a tarifa del catálogo" />
        <Kpi label="Citas este mes" value={totales.citas} sub="con su cuota puesta" />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Servicio</th>
                <th className="text-left font-medium px-4 py-2.5">Tipos de cita que lo cubren</th>
                <th className="text-right font-medium px-4 py-2.5">Pacientes</th>
                <th className="text-right font-medium px-4 py-2.5">Citas del mes</th>
                <th className="text-right font-medium px-4 py-2.5">Al mes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {servicios.map((s) => (
                <tr key={s.id} className={s.cuotas === 0 ? "text-neutral-400" : ""}>
                  <td className="px-4 py-2.5">
                    <div className="text-neutral-800">{s.nombre}</div>
                    <div className="text-[11px] text-neutral-400">{fmtMoney(s.precio)} al mes</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.tipos.length ? (
                      <span className="text-neutral-600">{s.tipos.map((t) => t.nombre).join(", ")}</span>
                    ) : (
                      <span className="text-amber-700">Sin tipo de cita</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {s.pacientes}
                    {s.sinPaciente > 0 && (
                      <span className="text-[11px] text-amber-700" title="Cuotas a nombre de la familia, sin decir de qué hijo son">
                        {" "}+{s.sinPaciente} sin hijo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.citas || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-800">{s.alMes ? fmtMoney(s.alMes) : "—"}</td>
                </tr>
              ))}
              {servicios.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">Sin cuotas en el catálogo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-neutral-400">
        «Al mes» es lo que dice la tarifa: las cuotas vivas de cada servicio por su precio. Una
        familia con precio pactado paga lo suyo, y eso se ve en su cuota.
      </p>

      {sinCuota.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-[12.5px] font-medium text-amber-900">
            {sinCuota.length} tipo{sinCuota.length === 1 ? "" : "s"} de cita sin cuota puesta
          </div>
          <p className="text-[11.5px] text-amber-800 mt-0.5">
            Las citas de estos tipos nacen sin decir de qué se cobran. Se les pone su cuota en{" "}
            <Link href="/citas/tipos" className="underline">Citas → Tipos</Link>.
          </p>
          <div className="text-[11.5px] text-amber-900/80 mt-1.5">
            {sinCuota.slice(0, 12).map((t) => t.nombre).join(" · ")}
            {sinCuota.length > 12 && ` … y ${sinCuota.length - 12} más`}
          </div>
        </div>
      )}
    </div>
  );
}

function Estadisticas({ conPedidos }) {
  const [rango, setRango] = useState({ desde: primeroDeMes(), hasta: hoyISO() });
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fetch(`/api/productos/estadisticas?desde=${rango.desde}&hasta=${rango.hasta}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j.ok) throw new Error(j.error || "No se han podido calcular las ventas");
        setDatos(j.data);
      })
      .catch((e) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [rango]);

  const preset = (d) => setRango(d);
  const es = (d) => rango.desde === d.desde && rango.hasta === d.hasta;
  const presets = [
    { l: "Este mes", d: { desde: primeroDeMes(), hasta: hoyISO() } },
    { l: "Trimestre", d: trimestreActual() },
    { l: "Este año", d: anioActual() },
  ];
  const btn = (activo) =>
    `text-[12px] px-2.5 py-1 rounded-lg border transition ${activo ? "bg-neutral-800 text-white border-neutral-800" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"}`;

  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-neutral-800">
            Ventas
            <HelpTooltip title="Qué se cuenta" placement="top" className="ml-1.5">
              Pedidos confirmados, en preparación, enviados o completados, por la fecha en que
              se hicieron. Los borradores no cuentan: un carrito de la tienda es un borrador
              hasta que se paga. Los cancelados se enseñan aparte.
            </HelpTooltip>
          </h2>
          <p className="text-[11.5px] text-neutral-500">
            {datos?.periodo ? `Del ${datos.periodo.desde} al ${datos.periodo.hasta}` : "Periodo"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((p) => (
            <button key={p.l} onClick={() => preset(p.d)} className={btn(es(p.d))}>{p.l}</button>
          ))}
          <input type="date" value={rango.desde} max={rango.hasta} onChange={(e) => setRango({ ...rango, desde: e.target.value })} className={`${inputCls} !w-auto !py-1 !text-[12px]`} />
          <span className="text-neutral-400 text-[12px]">→</span>
          <input type="date" value={rango.hasta} min={rango.desde} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} className={`${inputCls} !w-auto !py-1 !text-[12px]`} />
          {/* Llevárselo (03/09/2026): el Excel para hacer cuentas, el PDF para
              la reunión. Son enlaces al endpoint, como en Clínica: el navegador
              descarga y el mismo periodo viaja en la URL. Solo cuando hay
              cifras que llevarse. */}
          {datos?.disponible && (
            <>
              <a
                href={`/api/productos/estadisticas/export?formato=xlsx&desde=${rango.desde}&hasta=${rango.hasta}`}
                className={`${btn(false)} inline-flex items-center gap-1`}
                title="Descargar el periodo en Excel"
              >
                ⬇ Excel
              </a>
              <a
                href={`/api/productos/estadisticas/export?formato=pdf&desde=${rango.desde}&hasta=${rango.hasta}`}
                className={`${btn(false)} inline-flex items-center gap-1`}
                title="Descargar el periodo en PDF"
              >
                ⬇ PDF
              </a>
            </>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>}
      {cargando && !datos && <p className="text-[12.5px] text-neutral-400">Calculando…</p>}

      {datos && !datos.disponible && (
        <p className="text-[12.5px] text-neutral-500">
          Las ventas salen de los pedidos, y este cliente todavía no tiene el módulo Pedidos montado.
          {!conPedidos && " Cuando se active, las cifras aparecen aquí solas."}
        </p>
      )}

      {datos?.disponible && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Vendido" value={fmtMoney(datos.totales.importe)} sub={`${datos.totales.pedidos} pedido${datos.totales.pedidos === 1 ? "" : "s"}`} />
            <Kpi label="Unidades" value={fmtNum(datos.totales.unidades)} sub="sumando todas las líneas" />
            <Kpi label="Ticket medio" value={fmtMoney(datos.totales.ticketMedio)} sub="por pedido" />
            {/* Lo vendido menos lo que costó (03/09/2026). El porcentaje va sobre
                lo que TIENE coste; lo que no lo tiene se dice al lado, no se
                cuenta como cero. */}
            <Kpi
              label="Margen"
              value={datos.margen?.pct === null || datos.margen?.pct === undefined ? "—" : fmtMoney(datos.margen.importe)}
              sub={
                datos.totales.pedidos === 0
                  ? "sin ventas en el periodo"
                  : datos.margen?.pct === null || datos.margen?.pct === undefined
                    ? "sin precio de compra en las fichas"
                    : `${fmtNum(datos.margen.pct)} % sobre ${fmtMoney(datos.margen.sobreImporte)}${datos.margen.sinCoste ? ` · ${datos.margen.sinCoste} sin coste` : ""}`
              }
            />
            <Kpi
              label="Sin vender"
              value={datos.sinVentas}
              sub={`de ${datos.productosActivos} producto${datos.productosActivos === 1 ? "" : "s"} activo${datos.productosActivos === 1 ? "" : "s"}${datos.totales.cancelados ? ` · ${datos.totales.cancelados} cancelado${datos.totales.cancelados === 1 ? "" : "s"}` : ""}`}
            />
          </div>

          {datos.totales.pedidos === 0 ? (
            <p className="text-[12.5px] text-neutral-400">Ningún pedido en este periodo.</p>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-white border border-neutral-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400">Lo más vendido</div>
                  <div className="text-[10px] text-neutral-400 flex items-center">
                    <span className="w-20 text-right">vendido</span>
                    <span className="w-20 text-right">
                      margen
                      <HelpTooltip title="Cómo se calcula el margen" placement="top" className="ml-1">
                        Lo cobrado por cada línea menos su coste por unidad multiplicado por las unidades.
                        El coste es {datos.margen?.fuente === "entradas" ? "el medio de las entradas de Inventario (o el precio de compra de la ficha si el producto no tiene entradas)" : "el precio de compra de la ficha de cada producto"}.
                        Un producto sin precio de compra sale con «—»: no se sabe, que no es lo mismo que cero.
                        El precio de compra nunca sale hacia la tienda.
                      </HelpTooltip>
                    </span>
                  </div>
                </div>
                <RankingVentas filas={datos.porProducto.slice(0, 8)} />
                {datos.porProducto.length > 8 && (
                  <p className="text-[11px] text-neutral-400 mt-2">y {datos.porProducto.length - 8} más</p>
                )}
              </div>
              <div className="space-y-4">
                <div className="bg-white border border-neutral-100 rounded-xl p-3">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Por mes</div>
                  <Barras datos={datos.porMes} etiqueta={(d) => MES_LABEL(d.mes)} valor={(d) => d.importe} />
                </div>
                {datos.porOrigen.length > 1 && (
                  <div className="bg-white border border-neutral-100 rounded-xl p-3">
                    <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Por dónde entra</div>
                    <Barras datos={datos.porOrigen} etiqueta={(d) => ORIGEN_LABEL[d.origen] ?? d.origen} valor={(d) => d.importe} />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function ProductosModule({
  avanzado = false,
  conInventario = false,
  conPedidos = false,
  conTienda = false,
  /*
   * ¿Este centro vende SESIONES además de artículos? (04/09/2026, Aumenta por
   * Rodrigo: «eso hay que dejarlo reflejado en la pestaña de producto»). Con
   * Citas y Facturación, el catálogo de lo que se vende tiene dos mitades: los
   * artículos de siempre y los servicios —cada cuota con quién está apuntado y
   * cuánto suma—. Sin esos módulos la pestaña no existe y la pantalla es la de
   * antes.
   */
  conServicios = false,
}) {
  const [vista, setVista] = useState("articulos");
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [buscar, setBuscar] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [verRetirados, setVerRetirados] = useState(false);

  const [panel, setPanel] = useState(false);
  const [form, setForm] = useState(nuevoProducto);
  const [editandoId, setEditandoId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setBusqueda(buscar.trim()), 300);
    return () => clearTimeout(id);
  }, [buscar]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      if (busqueda) qs.set("search", busqueda);
      if (categoria) qs.set("category", categoria);
      if (verRetirados) qs.set("verInactivos", "1");
      const r = await fetch(`/api/inventory/products?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el catálogo");
      setProductos(j.data?.products ?? []);
      setCategorias(j.data?.categorias ?? []);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [busqueda, categoria, verRetirados]);

  useEffect(() => { cargar(); }, [cargar]);

  function abrirProducto(p = null) {
    setEditandoId(p?.id ?? null);
    setForm(p ? {
      name: p.name ?? "", sku: p.sku ?? "", category: p.category ?? "", unit: p.unit ?? "ud",
      purchasePrice: p.purchasePrice ?? "", salePrice: p.salePrice ?? "",
      minStock: p.minStock ?? "", notes: p.notes ?? "",
    } : nuevoProducto());
    setFormError(null);
    setPanel(true);
  }

  async function enviar(url, body, metodo = "POST") {
    setGuardando(true);
    setFormError(null);
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setPanel(false);
      await cargar();
      return true;
    } catch (e) {
      setFormError(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function retirar(p) {
    // El servidor decide: con movimientos de almacén se marca retirado (el
    // histórico apunta aquí); sin ellos se borra de verdad.
    const ok = window.confirm(`¿Retirar «${p.name}» del catálogo?`);
    if (!ok) return;
    setErrorMsg(null);
    const r = await fetch(`/api/inventory/products/${p.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErrorMsg(j?.error || "No se ha podido retirar"); return; }
    await cargar();
  }

  async function reactivar(p) {
    setErrorMsg(null);
    const r = await fetch(`/api/inventory/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErrorMsg(j?.error || "No se ha podido reactivar"); return; }
    await cargar();
  }

  const sinPrecio = useMemo(
    () => productos.filter((p) => p.active && (p.salePrice === null || p.salePrice === undefined || Number(p.salePrice) <= 0)).length,
    [productos]
  );
  // Lo que valdría vender lo que hay, al precio de la ficha. Solo con
  // Inventario: sin stock no hay nada que valorar.
  const valorVenta = useMemo(
    () => productos.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.salePrice) || 0), 0),
    [productos]
  );

  const accesos = [
    conInventario && { href: "/inventario", label: "Inventario", desc: "Entradas, ajustes y stock" },
    conPedidos && { href: "/pedidos", label: "Pedidos", desc: "Lo que han pedido los clientes" },
    conTienda && { href: "/tienda", label: "Tienda", desc: "Qué se publica y con qué foto" },
  ].filter(Boolean);

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800">Productos</h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Lo que vendes y a cuánto. Aquí se da de alta cada producto y se le pone su valor
            {conTienda ? "; la Tienda decide qué se publica, pero el precio es este." : "."}
          </p>
        </div>
        <button
          onClick={() => abrirProducto()}
          className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition"
        >
          Nuevo producto
        </button>
      </div>

      {conServicios && (
        <div className="flex gap-1 border-b border-neutral-200">
          {[["articulos", "Artículos"], ["servicios", "Servicios"]].map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setVista(k)}
              className={`text-[12.5px] font-medium px-4 py-2 border-b-2 -mb-px transition-colors ${
                vista === k
                  ? "border-[var(--color-primary,#1B3A2D)] text-neutral-800"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {vista === "servicios" && conServicios && <Servicios />}

      {(vista === "articulos" || !conServicios) && (
        <>
      {avanzado && <Estadisticas conPedidos={conPedidos} />}

      {accesos.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-3">
          {accesos.map((a) => (
            <Link key={a.href} href={a.href} className="rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-400 transition">
              <div className="text-[13px] font-medium text-neutral-800">{a.label} →</div>
              <div className="text-[11.5px] text-neutral-500">{a.desc}</div>
            </Link>
          ))}
        </div>
      )}

      {sinPrecio > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <strong>{sinPrecio}</strong> producto{sinPrecio === 1 ? "" : "s"} sin precio de venta.
          {conTienda && " Sin precio no se puede publicar en la tienda."}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre o referencia…" className={`${inputCls} max-w-xs`} />
        {categorias.length > 0 && (
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={`${inputCls} max-w-[200px]`}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
          <input type="checkbox" checked={verRetirados} onChange={(e) => setVerRetirados(e.target.checked)} />
          Ver retirados
        </label>
        {productos.length > 0 && (
          <span className="ml-auto text-[12.5px] text-neutral-500">
            {productos.length} producto{productos.length === 1 ? "" : "s"}
            {conInventario && (
              <>
                {" "}· en stock, {fmtMoney(valorVenta)} a precio de venta
                <HelpTooltip title="A precio de venta" placement="top" className="ml-1.5">
                  Lo que valdría vender todo lo que hay ahora en el almacén al precio de cada
                  ficha. Lo que no tenga precio suma cero, y cuenta solo los productos que estás
                  viendo: cambia con la búsqueda y con los filtros.
                </HelpTooltip>
              </>
            )}
          </span>
        )}
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Producto</th>
                <th className="text-left font-medium px-3 py-2">Categoría</th>
                <th className="text-left font-medium px-3 py-2">Se cuenta en</th>
                <th className="text-right font-medium px-3 py-2">Compra</th>
                <th className="text-right font-medium px-3 py-2">Venta</th>
                {conInventario && <th className="text-right font-medium px-3 py-2">Stock</th>}
                {conTienda && <th className="text-left font-medium px-3 py-2">A la venta</th>}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={8} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && productos.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-neutral-400">
                  {busqueda || categoria ? "Ningún producto coincide con el filtro." : "Todavía no hay productos. Da de alta el primero con «Nuevo producto»."}
                </td></tr>
              )}
              {!cargando && productos.map((p) => (
                <tr key={p.id} className={`border-t border-neutral-100 ${p.active ? "" : "bg-neutral-50/60 text-neutral-400"}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => abrirProducto(p)} className="font-medium text-neutral-800 hover:underline text-left">
                      {p.name}
                    </button>
                    {p.sku && <span className="ml-2 text-[11px] text-neutral-400">{p.sku}</span>}
                    {!p.active && <span className="ml-2 text-[11px] text-neutral-400">(retirado)</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{p.category || "—"}</td>
                  <td className="px-3 py-2 text-neutral-500">{UNIDADES.find((u) => u.v === p.unit)?.l ?? p.unit}</td>
                  <td className="px-3 py-2 text-right text-neutral-500">{fmtMoney(p.purchasePrice)}</td>
                  <td className={`px-3 py-2 text-right ${p.salePrice ? "text-neutral-800 font-medium" : "text-amber-700"}`}>
                    {p.salePrice ? fmtMoney(p.salePrice) : "sin precio"}
                  </td>
                  {conInventario && (
                    <td className={`px-3 py-2 text-right ${p.bajoMinimo ? "text-amber-700 font-medium" : ""}`}>
                      {fmtNum(p.stock)} <span className="text-neutral-400 text-[11px]">{p.unit}</span>
                    </td>
                  )}
                  {conTienda && (
                    <td className="px-3 py-2">
                      <span className={p.publicado ? "text-emerald-700" : "text-neutral-400"}>{p.publicado ? "Sí" : "No"}</span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => abrirProducto(p)} className="text-neutral-500 hover:text-neutral-800 px-2">Editar</button>
                    {p.active
                      ? <button onClick={() => retirar(p)} className="text-neutral-400 hover:text-red-700 px-2">Retirar</button>
                      : <button onClick={() => reactivar(p)} className="text-neutral-400 hover:text-neutral-800 px-2">Reactivar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

        </>
      )}

      {/* ── Panel de alta / edición ───────────────────────────────────────── */}
      {panel && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setPanel(false)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-800">{editandoId ? "Editar producto" : "Nuevo producto"}</h2>
              <button onClick={() => setPanel(false)} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
            </div>

            {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>}

            <label className="block"><span className="text-[12px] text-neutral-500">Nombre *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-[12px] text-neutral-500">Referencia</span>
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="text-[12px] text-neutral-500">Categoría</span>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} placeholder="Camisetas, libros, material…" /></label>
            </div>
            <label className="block">
              <span className="text-[12px] text-neutral-500">¿En qué se cuenta? *</span>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls}>
                {UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
              </select>
              <span className="block text-[11px] text-neutral-400 mt-1">
                Camisetas y libros van en unidades; el aceite, en litros.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-[12px] text-neutral-500">Precio de venta (€)</span>
                <input type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} className={inputCls} />
                <span className="block text-[11px] text-neutral-400 mt-1">El valor del producto: a lo que se vende.</span></label>
              <label className="block"><span className="text-[12px] text-neutral-500">Precio de compra (€)</span>
                <input type="number" step="0.01" min="0" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className={inputCls} />
                <span className="block text-[11px] text-neutral-400 mt-1">Lo que te cuesta. Opcional.</span></label>
            </div>
            {conInventario && (
              <label className="block"><span className="text-[12px] text-neutral-500">Avisar en Inventario por debajo de</span>
                <input type="number" step="0.001" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} className={inputCls} placeholder="Sin aviso" /></label>
            )}
            <label className="block"><span className="text-[12px] text-neutral-500">Notas internas</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></label>
            <button
              onClick={() => enviar(editandoId ? `/api/inventory/products/${editandoId}` : "/api/inventory/products", form, editandoId ? "PUT" : "POST")}
              disabled={guardando}
              className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
            >{guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear producto"}</button>
          </div>
        </>
      )}
    </div>
  );
}
