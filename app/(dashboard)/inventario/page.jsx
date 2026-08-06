"use client";

/**
 * Inventario — rehecho entero el 02/08/2026.
 *
 * El módulo viejo estaba pensado para comprar materia prima y fabricar otra cosa
 * (productos entrantes, salientes y recetas), que no es lo que hace nadie. Este
 * sirve igual a un centro clínico y a una librería: cosas que llegan, están en
 * stock y salen.
 *
 * **La unidad va SIEMPRE pegada a la cifra.** Era el fallo de fondo del anterior:
 * un «400» a secas no dice si son unidades o kilos.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Cifra + unidad, siempre juntas. Ver cabecera. */
function Cantidad({ valor, unidad, className = "" }) {
  return (
    <span className={className}>
      {fmtNum(valor)} <span className="text-neutral-400 text-[11px]">{unidad}</span>
    </span>
  );
}

function nuevoProducto() {
  return { name: "", sku: "", category: "", unit: "ud", purchasePrice: "", salePrice: "", minStock: "", notes: "" };
}
function nuevaEntrada() {
  return { productId: "", supplierId: "", entryDate: new Date().toISOString().slice(0, 10),
    quantity: "", unitCost: "", lot: "", expiryDate: "", notes: "" };
}

export default function InventarioPage() {
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [conAviso, setConAviso] = useState(0);
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [buscar, setBuscar] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soloAviso, setSoloAviso] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const [panel, setPanel] = useState(null); // 'producto' | 'entrada' | 'ajuste'
  const [form, setForm] = useState(nuevoProducto);
  const [entrada, setEntrada] = useState(nuevaEntrada);
  const [ajuste, setAjuste] = useState({ productId: "", quantity: "", reason: "" });
  const [editandoId, setEditandoId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState(null);

  const [detalle, setDetalle] = useState(null); // producto abierto
  const [movimientos, setMovimientos] = useState([]);

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
      if (soloAviso) qs.set("bajoMinimo", "1");
      if (verInactivos) qs.set("verInactivos", "1");
      const r = await fetch(`/api/inventory/products?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el inventario");
      setProductos(j.data?.products ?? []);
      setCategorias(j.data?.categorias ?? []);
      setConAviso(j.data?.conAviso ?? 0);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [busqueda, categoria, soloAviso, verInactivos]);

  useEffect(() => { cargar(); }, [cargar]);

  // Proveedores para el desplegable del alta de entrada. Si el tenant no tiene
  // facturación el endpoint responde 403 y la lista se queda vacía: la entrada
  // se puede registrar igual, sin proveedor.
  useEffect(() => {
    fetch("/api/proveedores", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setProveedores(j.data?.suppliers ?? []); })
      .catch(() => {});
  }, []);

  const unidadDe = useCallback(
    (id) => productos.find((p) => p.id === id)?.unit ?? "ud",
    [productos]
  );

  const abrirDetalle = useCallback(async (p) => {
    setDetalle(p);
    setMovimientos([]);
    try {
      const r = await fetch(`/api/inventory/stock-movements?productId=${p.id}&limit=100`, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setMovimientos(j.data?.movements ?? []);
    } catch { /* la ficha se abre igual, sin histórico */ }
  }, []);

  function abrirProducto(p = null) {
    setEditandoId(p?.id ?? null);
    setForm(p ? {
      name: p.name ?? "", sku: p.sku ?? "", category: p.category ?? "", unit: p.unit ?? "ud",
      purchasePrice: p.purchasePrice ?? "", salePrice: p.salePrice ?? "",
      minStock: p.minStock ?? "", notes: p.notes ?? "",
    } : nuevoProducto());
    setFormError(null);
    setPanel("producto");
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
      setPanel(null);
      await cargar();
      if (detalle) {
        const res = await fetch("/api/inventory/products?verInactivos=1", { cache: "no-store" });
        const js = await res.json();
        const fresco = js?.data?.products?.find((x) => x.id === detalle.id);
        if (fresco) abrirDetalle(fresco);
      }
      return true;
    } catch (e) {
      setFormError(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  }

  const totalValorado = useMemo(
    () => productos.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.purchasePrice) || 0), 0),
    [productos]
  );

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800">Inventario</h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Lo que hay en el almacén. El stock se calcula sumando entradas, salidas y ajustes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEntrada(nuevaEntrada()); setFormError(null); setPanel("entrada"); }}
            className="text-[12.5px] px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
          >
            Registrar entrada
          </button>
          <button
            onClick={() => abrirProducto()}
            className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition"
          >
            Nuevo producto
          </button>
        </div>
      </div>

      {conAviso > 0 && !soloAviso && (
        <button
          onClick={() => setSoloAviso(true)}
          className="w-full text-left rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 hover:bg-amber-100 transition"
        >
          <strong>{conAviso}</strong> producto{conAviso === 1 ? "" : "s"} por debajo del mínimo. Ver cuáles →
        </button>
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
          <input type="checkbox" checked={soloAviso} onChange={(e) => setSoloAviso(e.target.checked)} />
          Solo bajo mínimo
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Ver retirados
        </label>
        {productos.length > 0 && (
          <span className="ml-auto text-[12.5px] text-neutral-500">
            {productos.length} producto{productos.length === 1 ? "" : "s"} · valorado en {fmtMoney(totalValorado)}
            <HelpTooltip title="Valorado en" placement="top" className="ml-1.5">
              Lo que costaría reponer lo que hay ahora, al precio de compra de cada ficha: ni lo
              que pagaste en cada entrega, ni lo que vale vendido.{" "}
              <strong className="text-white">
                Lo que no tenga precio de compra puesto suma cero
              </strong>
              , así que la cifra se queda corta sin avisar. Y cuenta solo los productos que estás
              viendo: cambia con la búsqueda y con los filtros.
            </HelpTooltip>
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
                <th className="text-right font-medium px-3 py-2">Stock</th>
                <th className="text-right font-medium px-3 py-2">Mínimo</th>
                <th className="text-right font-medium px-3 py-2">Compra</th>
                <th className="text-right font-medium px-3 py-2">Venta</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && productos.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                  {busqueda || categoria || soloAviso ? "Ningún producto coincide con el filtro." : "Todavía no hay productos en el almacén."}
                </td></tr>
              )}
              {!cargando && productos.map((p) => (
                <tr key={p.id} className={`border-t border-neutral-100 ${p.active ? "" : "bg-neutral-50/60 text-neutral-400"}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => abrirDetalle(p)} className="font-medium text-neutral-800 hover:underline text-left">
                      {p.name}
                    </button>
                    {p.sku && <span className="ml-2 text-[11px] text-neutral-400">{p.sku}</span>}
                    {!p.active && <span className="ml-2 text-[11px] text-neutral-400">(retirado)</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{p.category || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Cantidad valor={p.stock} unidad={p.unit} className={p.bajoMinimo ? "text-amber-700 font-medium" : ""} />
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-400">
                    {p.minStock === null || p.minStock === undefined ? "—" : <Cantidad valor={p.minStock} unidad={p.unit} />}
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-500">{fmtMoney(p.purchasePrice)}</td>
                  <td className="px-3 py-2 text-right text-neutral-500">{fmtMoney(p.salePrice)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => { setAjuste({ productId: p.id, quantity: "", reason: "" }); setFormError(null); setPanel("ajuste"); }}
                      className="text-neutral-400 hover:text-neutral-800 px-2">Ajustar</button>
                    <button onClick={() => abrirProducto(p)} className="text-neutral-500 hover:text-neutral-800 px-2">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Ficha con el histórico de movimientos ─────────────────────────── */}
      {detalle && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetalle(null)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-lg bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-neutral-800">{detalle.name}</h2>
                <p className="text-[12px] text-neutral-500 mt-0.5">
                  Stock actual: <Cantidad valor={detalle.stock} unidad={detalle.unit} />
                </p>
              </div>
              <button onClick={() => setDetalle(null)} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
            </div>

            <div className="rounded-lg border border-neutral-200 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="text-left font-medium px-2 py-1.5">Fecha</th>
                    <th className="text-left font-medium px-2 py-1.5">Motivo</th>
                    <th className="text-right font-medium px-2 py-1.5">Cantidad</th>
                    <th className="text-left font-medium px-2 py-1.5">Quién</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-5 text-center text-neutral-400">Sin movimientos todavía.</td></tr>
                  )}
                  {movimientos.map((m) => (
                    <tr key={m.id} className="border-t border-neutral-100">
                      <td className="px-2 py-1.5 text-neutral-500">{new Date(m.movedAt).toLocaleDateString("es-ES")}</td>
                      <td className="px-2 py-1.5">{m.reason || m.type}</td>
                      <td className={`px-2 py-1.5 text-right font-medium ${Number(m.quantity) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {Number(m.quantity) > 0 ? "+" : ""}<Cantidad valor={m.quantity} unidad={detalle.unit} />
                      </td>
                      <td className="px-2 py-1.5 text-neutral-500">{m.teamMember?.name || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Paneles de alta ───────────────────────────────────────────────── */}
      {panel && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setPanel(null)} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-800">
                {panel === "producto" ? (editandoId ? "Editar producto" : "Nuevo producto")
                  : panel === "entrada" ? "Registrar entrada" : "Ajustar stock"}
              </h2>
              <button onClick={() => setPanel(null)} className="text-neutral-400 hover:text-neutral-700 text-[12.5px]">Cerrar</button>
            </div>

            {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>}

            {panel === "producto" && (
              <>
                <label className="block"><span className="text-[12px] text-neutral-500">Nombre *</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[12px] text-neutral-500">Referencia</span>
                    <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={inputCls} /></label>
                  <label className="block"><span className="text-[12px] text-neutral-500">Categoría</span>
                    <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} placeholder="Material fungible…" /></label>
                </div>
                <label className="block">
                  <span className="text-[12px] text-neutral-500">¿En qué se cuenta? *</span>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputCls}>
                    {UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
                  </select>
                  <span className="block text-[11px] text-neutral-400 mt-1">
                    Folios y guantes van en unidades; el gel, en litros.
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[12px] text-neutral-500">Precio de compra</span>
                    <input type="number" step="0.01" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className={inputCls} /></label>
                  <label className="block"><span className="text-[12px] text-neutral-500">Precio de venta</span>
                    <input type="number" step="0.01" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} className={inputCls} /></label>
                </div>
                <label className="block"><span className="text-[12px] text-neutral-500">Avisar por debajo de</span>
                  <input type="number" step="0.001" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} className={inputCls} placeholder="Sin aviso" /></label>
                <label className="block"><span className="text-[12px] text-neutral-500">Notas</span>
                  <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></label>
                <button
                  onClick={() => enviar(editandoId ? `/api/inventory/products/${editandoId}` : "/api/inventory/products", form, editandoId ? "PUT" : "POST")}
                  disabled={guardando}
                  className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
                >{guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear producto"}</button>
              </>
            )}

            {panel === "entrada" && (
              <>
                <label className="block"><span className="text-[12px] text-neutral-500">Producto *</span>
                  <select value={entrada.productId} onChange={(e) => setEntrada({ ...entrada, productId: e.target.value })} className={inputCls}>
                    <option value="">— Elegir —</option>
                    {productos.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></label>
                <label className="block">
                  <span className="text-[12px] text-neutral-500">Proveedor</span>
                  <select value={entrada.supplierId} onChange={(e) => setEntrada({ ...entrada, supplierId: e.target.value })} className={inputCls}>
                    <option value="">— Sin proveedor —</option>
                    {proveedores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {proveedores.length === 0 && (
                    <span className="block text-[11px] text-neutral-400 mt-1">
                      No hay proveedores dados de alta. Se crean en Facturación → Proveedores.
                    </span>
                  )}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[12px] text-neutral-500">Fecha *</span>
                    <input type="date" value={entrada.entryDate} onChange={(e) => setEntrada({ ...entrada, entryDate: e.target.value })} className={inputCls} /></label>
                  <label className="block">
                    <span className="text-[12px] text-neutral-500">
                      Cantidad * {entrada.productId && <span className="text-neutral-400">({unidadDe(entrada.productId)})</span>}
                    </span>
                    <input type="number" step="0.001" value={entrada.quantity} onChange={(e) => setEntrada({ ...entrada, quantity: e.target.value })} className={inputCls} /></label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[12px] text-neutral-500">Coste por unidad</span>
                    <input type="number" step="0.01" value={entrada.unitCost} onChange={(e) => setEntrada({ ...entrada, unitCost: e.target.value })} className={inputCls} /></label>
                  <label className="block"><span className="text-[12px] text-neutral-500">Lote</span>
                    <input value={entrada.lot} onChange={(e) => setEntrada({ ...entrada, lot: e.target.value })} className={inputCls} /></label>
                </div>
                <label className="block"><span className="text-[12px] text-neutral-500">Caducidad</span>
                  <input type="date" value={entrada.expiryDate} onChange={(e) => setEntrada({ ...entrada, expiryDate: e.target.value })} className={inputCls} /></label>
                <button onClick={() => enviar("/api/inventory/entries", entrada)} disabled={guardando}
                  className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
                >{guardando ? "Guardando…" : "Registrar entrada"}</button>
              </>
            )}

            {panel === "ajuste" && (
              <>
                <p className="text-[12.5px] text-neutral-500">
                  Para corregir el stock cuando la realidad no coincide: una rotura, algo caducado o
                  un recuento. Positivo suma, negativo resta.
                </p>
                <label className="block">
                  <span className="text-[12px] text-neutral-500">
                    Cantidad * <span className="text-neutral-400">({unidadDe(ajuste.productId)})</span>
                  </span>
                  <input type="number" step="0.001" value={ajuste.quantity} onChange={(e) => setAjuste({ ...ajuste, quantity: e.target.value })} className={inputCls} placeholder="-2" autoFocus /></label>
                <label className="block"><span className="text-[12px] text-neutral-500">Motivo *</span>
                  <input value={ajuste.reason} onChange={(e) => setAjuste({ ...ajuste, reason: e.target.value })} className={inputCls} placeholder="Se rompieron dos cajas" />
                  <span className="block text-[11px] text-neutral-400 mt-1">
                    Obligatorio: dentro de seis meses, un «faltan 2» sin explicación no vale de nada.
                  </span></label>
                <button onClick={() => enviar("/api/inventory/stock-movements", ajuste)} disabled={guardando}
                  className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
                >{guardando ? "Guardando…" : "Guardar ajuste"}</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
