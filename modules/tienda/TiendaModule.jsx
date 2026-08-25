"use client";

/**
 * TiendaModule — el escaparate, desde dentro del CRM.
 *
 * ── POR QUÉ ES UNA PANTALLA APARTE DE INVENTARIO ───────────────────────────
 * Porque son dos preguntas distintas y se hacen en momentos distintos.
 * Inventario responde «¿cuánto queda?»; la Tienda, «¿qué se ve y a qué
 * precio?». Meter fotos, descripción y tallas en la tabla del almacén —que ya
 * tiene diez columnas— la haría ilegible para quien solo entra a contar cajas.
 *
 * Los productos son LOS MISMOS: esta pantalla no crea nada nuevo, escribe sobre
 * `products`. Lo que hace es enseñar solo lo que decide si algo está a la
 * venta, y dejarlo publicar de un clic.
 */

import { useCallback, useEffect, useState } from "react";

const eur = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

export default function TiendaModule() {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch("/api/inventory/products?verInactivos=1", { cache: "no-store" });
      const j = await r.json();
      setProductos(j?.data?.products ?? []);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const publicar = async (p, publicado) => {
    setAviso(null);
    // La ruta de producto expone PUT (y es parcial: solo toca lo que mandas).
    const r = await fetch(`/api/inventory/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicado }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      // El servidor no deja publicar sin precio. Se enseña su motivo tal cual:
      // es más útil que un «error al guardar».
      setAviso({ tipo: "error", texto: j?.error || "No se ha podido guardar" });
      return;
    }
    await cargar();
  };

  const publicados = productos.filter((p) => p.publicado).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="eyebrow mb-1.5">Venta · Tienda</div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Tienda{" "}
          <span className="font-normal text-gray-400">
            — {publicados} de {productos.length} {productos.length === 1 ? "producto" : "productos"} a la venta
          </span>
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Lo que aquí esté publicado se ve en tu tienda. Los productos y su stock son los de
          Inventario: esto solo decide qué sale al escaparate y con qué foto.
        </p>
      </header>

      {aviso && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {aviso.texto}
        </p>
      )}

      {cargando && <p className="text-sm text-gray-400">Cargando…</p>}

      {!cargando && !productos.length && (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Todavía no hay productos. Créalos en <a className="underline" href="/inventario">Inventario</a> y
          vuelve aquí para ponerlos a la venta.
        </p>
      )}

      {!cargando && productos.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Precio</th>
                <th className="px-4 py-3 hidden sm:table-cell">Stock</th>
                <th className="px-4 py-3">A la venta</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {productos.map((p, i) => (
                <tr key={p.id} className={i % 2 ? "bg-gray-50/50" : undefined}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.images?.[0]?.url ? (
                        <img src={p.images[0].url} alt="" className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <span className="h-10 w-10 rounded bg-gray-100" aria-hidden="true" />
                      )}
                      <span>
                        <span className="block font-medium text-gray-900">{p.name}</span>
                        {p.sku && <span className="block text-xs text-gray-400">{p.sku}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">
                    {p.salePrice ? eur(p.salePrice) : <span className="text-amber-700">sin precio</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell tabular-nums text-gray-600">
                    {p.stock} {p.unit}
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!p.publicado}
                        onChange={(e) => publicar(p, e.target.checked)}
                      />
                      <span className={p.publicado ? "text-emerald-700" : "text-gray-400"}>
                        {p.publicado ? "Sí" : "No"}
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditando(p)}
                      className="text-xs underline text-gray-500 hover:text-gray-800"
                    >
                      Ficha y tallas
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <Editor
          producto={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => {
            setEditando(null);
            await cargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * La ficha de escaparate de un producto: descripción, fotos, IVA y variantes.
 *
 * Las variantes se guardan de golpe con un PUT y no una a una: quien abre esto
 * añade la XL, corrige el precio de la XXL y quita la XS en el mismo gesto.
 */
function Editor({ producto, onCerrar, onGuardado }) {
  const [ficha, setFicha] = useState({
    description: producto.description ?? "",
    slug: producto.slug ?? "",
    taxRate: producto.taxRate ?? "",
    salePrice: producto.salePrice ?? "",
    images: (producto.images ?? []).map((i) => i.url).join("\n"),
  });
  const [variantes, setVariantes] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/inventory/products/${producto.id}/variantes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setVariantes((j?.data?.variantes ?? []).filter((v) => v.active)))
      .catch(() => setVariantes([]));
  }, [producto.id]);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const rp = await fetch(`/api/inventory/products/${producto.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: ficha.description,
          slug: ficha.slug,
          taxRate: ficha.taxRate,
          salePrice: ficha.salePrice,
          // Una URL por línea: es la forma más rápida de pegar cuatro fotos
          // que ya están subidas, sin montar un gestor de ficheros.
          images: ficha.images.split("\n").map((u) => u.trim()).filter(Boolean),
        }),
      });
      const jp = await rp.json().catch(() => null);
      if (!rp.ok) throw new Error(jp?.error || "No se ha podido guardar la ficha");

      const rv = await fetch(`/api/inventory/products/${producto.id}/variantes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantes }),
      });
      const jv = await rv.json().catch(() => null);
      if (!rv.ok) throw new Error(jv?.error || "No se han podido guardar las tallas");

      await onGuardado();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const campo = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{producto.name}</h2>
          <button type="button" onClick={onCerrar} className="text-sm text-gray-400 hover:text-gray-700">
            Cerrar
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">Descripción</span>
            <textarea
              rows={4}
              className={campo}
              value={ficha.description}
              onChange={(e) => setFicha((f) => ({ ...f, description: e.target.value }))}
              placeholder="Lo que se lee en la ficha de la tienda."
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">Precio de venta (€)</span>
            <input
              className={campo}
              value={ficha.salePrice}
              onChange={(e) => setFicha((f) => ({ ...f, salePrice: e.target.value }))}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">IVA (%)</span>
            <input
              className={campo}
              value={ficha.taxRate}
              onChange={(e) => setFicha((f) => ({ ...f, taxRate: e.target.value }))}
              placeholder="21"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Fotos — una URL por línea, la primera es la de portada
            </span>
            <textarea
              rows={3}
              className={campo}
              value={ficha.images}
              onChange={(e) => setFicha((f) => ({ ...f, images: e.target.value }))}
              placeholder="https://tudominio.com/fotos/camiseta.jpg"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Dirección en la tienda (se rellena sola con el nombre si la dejas vacía)
            </span>
            <input
              className={campo}
              value={ficha.slug}
              onChange={(e) => setFicha((f) => ({ ...f, slug: e.target.value }))}
            />
          </label>
        </div>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Tallas u opciones</h3>
            <button
              type="button"
              onClick={() => setVariantes((v) => [...v, { name: "", sku: "", salePrice: "" }])}
              className="text-xs underline text-gray-500 hover:text-gray-800"
            >
              + Añadir
            </button>
          </div>
          <p className="mb-3 text-xs text-gray-400">
            Déjalo vacío si el producto no tiene opciones. El precio en blanco hereda el de arriba.
          </p>

          {variantes.map((v, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-2">
              <input
                className={campo}
                placeholder="Talla M · 500 litros · Azul"
                value={v.name ?? ""}
                onChange={(e) => setVariantes((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className={campo}
                placeholder="Referencia"
                value={v.sku ?? ""}
                onChange={(e) => setVariantes((xs) => xs.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))}
              />
              <input
                className={campo}
                placeholder="Precio"
                value={v.salePrice ?? ""}
                onChange={(e) => setVariantes((xs) => xs.map((x, j) => (j === i ? { ...x, salePrice: e.target.value } : x)))}
              />
              <button
                type="button"
                onClick={() => setVariantes((xs) => xs.filter((_, j) => j !== i))}
                className="px-2 text-xs text-gray-400 hover:text-red-600"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="px-4 py-2 text-sm text-gray-500">
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
