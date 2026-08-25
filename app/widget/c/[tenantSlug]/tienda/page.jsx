"use client";

/**
 * La tienda pública. Vive DENTRO del CRM y el cliente la incrusta en la página
 * que quiera de su web con un iframe — el mismo patrón que el widget de citas
 * (`docs/modules/citas-embed.md`), que ya está en producción con la CSP por
 * tenant y el `noindex` del layout.
 *
 * ── POR QUÉ TODO EN UNA PANTALLA ───────────────────────────────────────────
 * Catálogo, ficha y carrito conviven aquí en vez de en tres rutas. Dentro de un
 * iframe, cambiar de ruta hace saltar el scroll de la página que lo aloja. Con
 * un solo componente, elegir talla y añadir al carrito no navega a ninguna
 * parte.
 *
 * ── EL CARRITO NO SE FÍA DE SÍ MISMO ───────────────────────────────────────
 * Se guarda en `localStorage` para sobrevivir a una recarga, pero al pagar solo
 * se mandan IDs y cantidades: el precio lo pone el servidor. Un carrito de hace
 * dos meses no cobra el precio de hace dos meses.
 *
 * Los colores salen de las variables del widget, así que la tienda se ve con la
 * marca del cliente sin que aquí haya un solo color escrito.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

const CLAVE_CARRITO = "crm-tienda-carrito";
const eur = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

const BOTON =
  "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed";
const CAMPO =
  "w-full rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] px-3 py-2 text-sm text-[var(--widget-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]";

export default function TiendaPage() {
  const { tenantSlug } = useParams();

  const [productos, setProductos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [carrito, setCarrito] = useState([]);
  const [verCarrito, setVerCarrito] = useState(false);

  const [comprador, setComprador] = useState({ nombre: "", email: "", telefono: "" });
  const [envio, setEnvio] = useState({ calle: "", cp: "", ciudad: "", provincia: "", pais: "ES", notas: "" });
  const [enviando, setEnviando] = useState(false);
  const [errorPago, setErrorPago] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/public/c/${tenantSlug}/tienda`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.ok) throw new Error(j?.error || "No se ha podido cargar la tienda");
        setProductos(j.data.productos ?? []);
      })
      .catch((e) => vivo && setErrorCarga(e.message));
    return () => {
      vivo = false;
    };
  }, [tenantSlug]);

  useEffect(() => {
    try {
      const guardado = JSON.parse(window.localStorage.getItem(CLAVE_CARRITO) || "[]");
      if (Array.isArray(guardado)) setCarrito(guardado);
    } catch {
      // Un carrito ilegible se descarta: no es motivo para no poder entrar.
    }
  }, []);

  const guardar = useCallback((siguiente) => {
    setCarrito(siguiente);
    try {
      window.localStorage.setItem(CLAVE_CARRITO, JSON.stringify(siguiente));
    } catch {
      /* modo privado: el carrito vive solo en memoria */
    }
  }, []);

  const anadir = (producto, variante) => {
    const clave = `${producto.id}:${variante?.id ?? ""}`;
    const previo = carrito.find((l) => l.clave === clave);
    guardar(
      previo
        ? carrito.map((l) => (l.clave === clave ? { ...l, unidades: Math.min(99, l.unidades + 1) } : l))
        : [
            ...carrito,
            {
              clave,
              productoId: producto.id,
              varianteId: variante?.id ?? null,
              nombre: producto.nombre,
              variante: variante?.nombre ?? null,
              precio: variante ? variante.precio : producto.precio,
              imagen: producto.imagenes?.[0]?.url ?? null,
              unidades: 1,
            },
          ]
    );
    setAbierto(null);
    setVerCarrito(true);
  };

  const cambiarUnidades = (clave, delta) =>
    guardar(
      carrito
        .map((l) => (l.clave === clave ? { ...l, unidades: l.unidades + delta } : l))
        .filter((l) => l.unidades > 0)
    );

  const total = useMemo(() => carrito.reduce((a, l) => a + l.precio * l.unidades, 0), [carrito]);
  const unidades = useMemo(() => carrito.reduce((a, l) => a + l.unidades, 0), [carrito]);

  const pagar = async () => {
    setEnviando(true);
    setErrorPago(null);
    try {
      const res = await fetch(`/api/public/c/${tenantSlug}/tienda/pedido`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Solo QUÉ y CUÁNTOS. El precio lo pone el servidor.
          carrito: carrito.map((l) => ({ productoId: l.productoId, varianteId: l.varianteId, unidades: l.unidades })),
          comprador,
          envio: { ...envio, nombre: comprador.nombre },
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "No se ha podido iniciar el pago");
      // El carrito NO se vacía aquí: si el pago se cancela, la persona vuelve y
      // se lo encuentra como lo dejó. Lo vacía la página de gracias.
      // A Stripe se va con la ventana DE ARRIBA: Checkout se niega a pintarse
      // dentro de un iframe, y esta tienda vive incrustada en WordPress. Si el
      // salto de arriba no se puede (otro origen sin permiso), cae al normal.
      try {
        window.top.location.href = j.data.checkoutUrl;
      } catch {
        window.location.href = j.data.checkoutUrl;
      }
    } catch (e) {
      setErrorPago(e.message);
      setEnviando(false);
    }
  };

  const listo =
    carrito.length > 0 &&
    comprador.email.includes("@") &&
    comprador.nombre.trim() &&
    envio.calle.trim() &&
    envio.cp.trim() &&
    envio.ciudad.trim();

  if (errorCarga) return <Centro>{errorCarga}</Centro>;
  if (productos === null) return <Centro>Cargando…</Centro>;
  if (!productos.length) return <Centro>Todavía no hay nada a la venta.</Centro>;

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--widget-border)] bg-[var(--widget-card)] px-5 py-4 lg:px-10">
        <span className="text-lg tracking-tight text-[var(--widget-text)]">Tienda</span>
        <button
          type="button"
          onClick={() => setVerCarrito((v) => !v)}
          className="rounded-lg border border-[var(--widget-border)] px-3 py-1.5 text-sm text-[var(--widget-text)]"
        >
          Carrito{unidades > 0 && <span className="ml-1 font-semibold">· {unidades}</span>}
        </button>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-6 lg:px-10">
        {verCarrito ? (
          <Carrito
            {...{ carrito, total, comprador, setComprador, envio, setEnvio, cambiarUnidades, enviando, listo }}
            error={errorPago}
            onSeguir={() => setVerCarrito(false)}
            onPagar={pagar}
          />
        ) : abierto ? (
          <Ficha producto={abierto} onVolver={() => setAbierto(null)} onAnadir={anadir} />
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {productos.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setAbierto(p)}
                  className="w-full overflow-hidden rounded-xl border border-[var(--widget-border)] bg-[var(--widget-card)] text-left transition hover:opacity-90"
                >
                  <Foto src={p.imagenes?.[0]?.url} alt={p.imagenes?.[0]?.alt || p.nombre} />
                  <span className="block px-3 pt-3 text-sm font-medium text-[var(--widget-text)]">{p.nombre}</span>
                  <span className="block px-3 pb-3 pt-1 text-sm text-[var(--widget-text-muted)]">
                    {p.precioDesde ? `desde ${eur(p.precioDesde)}` : eur(p.precio)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Ficha({ producto, onVolver, onAnadir }) {
  const [variante, setVariante] = useState(producto.variantes?.[0] ?? null);
  const hayVariantes = (producto.variantes?.length ?? 0) > 0;

  return (
    <div>
      <Volver onClick={onVolver}>Seguir mirando</Volver>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          {(producto.imagenes ?? []).map((im, i) => (
            <Foto key={i} src={im.url} alt={im.alt || producto.nombre} prioritaria={i === 0} />
          ))}
          {!producto.imagenes?.length && <Foto />}
        </div>

        <div>
          <h2 className="text-xl tracking-tight text-[var(--widget-text)]">{producto.nombre}</h2>
          <p className="mt-1 text-lg font-semibold text-[var(--widget-text)]">
            {eur(variante ? variante.precio : producto.precio)}
          </p>
          {producto.descripcion && (
            <p className="mt-3 whitespace-pre-line text-sm text-[var(--widget-text-muted)]">{producto.descripcion}</p>
          )}

          {hayVariantes && (
            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--widget-text-muted)]">
                Elige una opción
              </legend>
              <div className="flex flex-wrap gap-2">
                {producto.variantes.map((v) => {
                  const activa = variante?.id === v.id;
                  return (
                    <label
                      key={v.id}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                        activa
                          ? "border-[var(--brand-primary)] text-[var(--widget-text)]"
                          : "border-[var(--widget-border)] text-[var(--widget-text-muted)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="variante"
                        className="sr-only"
                        checked={activa}
                        onChange={() => setVariante(v)}
                      />
                      {v.nombre}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <button
            type="button"
            onClick={() => onAnadir(producto, variante)}
            className={`${BOTON} mt-6 w-full`}
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            Añadir al carrito
          </button>
        </div>
      </div>
    </div>
  );
}

function Carrito({ carrito, total, comprador, setComprador, envio, setEnvio, cambiarUnidades, onSeguir, onPagar, enviando, error, listo }) {
  if (!carrito.length) {
    return (
      <div>
        <p className="mb-4 text-sm text-[var(--widget-text-muted)]">El carrito está vacío.</p>
        <Volver onClick={onSeguir}>Ver la tienda</Volver>
      </div>
    );
  }

  return (
    <div>
      <Volver onClick={onSeguir}>Seguir comprando</Volver>

      <ul className="mt-4 divide-y divide-[var(--widget-border)] border-y border-[var(--widget-border)]">
        {carrito.map((l) => (
          <li key={l.clave} className="flex items-center gap-3 py-3">
            {l.imagen && <img src={l.imagen} alt="" loading="lazy" className="h-14 w-14 rounded object-cover" />}
            <span className="min-w-0 flex-1 text-sm text-[var(--widget-text)]">
              {l.nombre}
              {l.variante && <span className="text-[var(--widget-text-muted)]"> · {l.variante}</span>}
            </span>
            <span className="flex items-center gap-2">
              <Paso onClick={() => cambiarUnidades(l.clave, -1)} etiqueta="Quitar una">−</Paso>
              <b className="w-6 text-center text-sm tabular-nums text-[var(--widget-text)]">{l.unidades}</b>
              <Paso onClick={() => cambiarUnidades(l.clave, +1)} etiqueta="Añadir una">+</Paso>
            </span>
            <span className="w-20 text-right text-sm tabular-nums text-[var(--widget-text)]">
              {eur(l.precio * l.unidades)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-right text-base text-[var(--widget-text)]">
        Total <b className="ml-2 text-lg">{eur(total)}</b>
      </p>

      <h3 className="mt-8 text-sm font-semibold text-[var(--widget-text)]">Tus datos</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo label="Nombre y apellidos" value={comprador.nombre} onChange={(v) => setComprador((c) => ({ ...c, nombre: v }))} />
        <Campo label="Correo" type="email" value={comprador.email} onChange={(v) => setComprador((c) => ({ ...c, email: v }))} />
        <Campo label="Teléfono" value={comprador.telefono} onChange={(v) => setComprador((c) => ({ ...c, telefono: v }))} />
      </div>

      <h3 className="mt-6 text-sm font-semibold text-[var(--widget-text)]">Dirección de envío</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo ancho label="Calle y número" value={envio.calle} onChange={(v) => setEnvio((e) => ({ ...e, calle: v }))} />
        <Campo label="Código postal" value={envio.cp} onChange={(v) => setEnvio((e) => ({ ...e, cp: v }))} />
        <Campo label="Ciudad" value={envio.ciudad} onChange={(v) => setEnvio((e) => ({ ...e, ciudad: v }))} />
        <Campo label="Provincia" value={envio.provincia} onChange={(v) => setEnvio((e) => ({ ...e, provincia: v }))} />
        <Campo ancho label="Notas para la entrega" value={envio.notas} onChange={(v) => setEnvio((e) => ({ ...e, notas: v }))} />
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onPagar}
        disabled={!listo || enviando}
        className={`${BOTON} mt-6 w-full py-3`}
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {enviando ? "Abriendo el pago…" : `Pagar ${eur(total)}`}
      </button>
      <p className="mt-2 text-center text-xs text-[var(--widget-text-muted)]">
        El pago se hace en Stripe. No guardamos tu tarjeta.
      </p>
    </div>
  );
}

/* ── Piezas sueltas ────────────────────────────────────────────────────── */

function Foto({ src, alt = "", prioritaria = false }) {
  if (!src) {
    return <div className="aspect-square w-full rounded-lg bg-[var(--widget-border)]" aria-hidden="true" />;
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={prioritaria ? "eager" : "lazy"}
      className="aspect-square w-full rounded-lg object-cover"
    />
  );
}

function Campo({ label, value, onChange, type = "text", ancho = false }) {
  return (
    <label className={ancho ? "sm:col-span-2" : undefined}>
      <span className="mb-1 block text-xs font-medium text-[var(--widget-text-muted)]">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={CAMPO} />
    </label>
  );
}

function Paso({ onClick, etiqueta, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      className="h-7 w-7 rounded border border-[var(--widget-border)] text-[var(--widget-text)]"
    >
      {children}
    </button>
  );
}

function Volver({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-[var(--widget-text-muted)] underline">
      ← {children}
    </button>
  );
}

function Centro({ children }) {
  return (
    <p className="flex min-h-screen items-center justify-center px-4 text-sm text-[var(--widget-text-muted)]">
      {children}
    </p>
  );
}
