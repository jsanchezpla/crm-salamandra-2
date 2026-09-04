"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

/**
 * La campana de avisos. Desde el 04/09/2026 YA NO FLOTA: su botón vive en el
 * pie del menú, en la fila de iconos que hay debajo del correo de cada persona
 * (campana · Salamandrobot · ayuda · soporte · configuración · salir).
 *
 * ── POR QUÉ SE MOVIÓ ───────────────────────────────────────────────────────
 * Rodrigo, 04/09/2026: «se ubican a veces delante de botones, así que los
 * ponemos debajo del nombre de usuario junto a los iconitos». Anclada abajo a
 * la derecha caía justo donde los 69 paneles del CRM ponen su Guardar/Crear, y
 * lo único que lo frenaba era esconderla con CSS mientras hubiera un panel
 * abierto. En el pie del menú no puede tapar nada, porque el menú entero queda
 * debajo del backdrop de cualquier panel.
 *
 * ── EL DESPLEGABLE SE VA A <body> ──────────────────────────────────────────
 * El botón se pinta donde lo monte el menú, pero un desplegable de 320 px no
 * cabe en una columna de 220: se manda a `document.body` con un portal y se
 * ancla a la PANTALLA —abajo a la izquierda, al lado del menú en escritorio—.
 * El portal no rompe el SSR porque `open` solo puede ponerse a true desde un
 * clic, que ya es cliente. Las vars de marca llegan igual: `DashboardShell` las
 * escribe en <html> justo para que cascadeen a los portales.
 *
 * Conserva `crm-flotante` —y por eso la regla de `app/globals.css` mira el
 * <body> y ya no `.dashboard-shell`—: con un panel lateral abierto tampoco
 * queremos el desplegable flotando por encima.
 *
 * `alAbrir` cierra el menú móvil: en móvil el botón vive DENTRO del cajón, y
 * su fondo `z-40` es justo lo que la regla de globals.css lee para esconder lo
 * flotante. Sin esto, abrir la campana desde el cajón no enseñaría nada.
 */
export default function NotificationBell({ alAbrir }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/notifications", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setItems(j.data.notifications ?? []);
          setUnread(j.data.unread ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 60000);
    return () => clearInterval(timer.current);
  }, [load]);

  const markRead = async (body) => {
    try {
      const r = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.ok) setUnread(j.data.unread ?? 0);
    } catch {
      /* silencioso */
    }
  };

  const onClickItem = async (n) => {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await markRead({ id: n.id });
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const markAll = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    await markRead({ all: true });
  };

  function alternar() {
    const siguiente = !open;
    setOpen(siguiente);
    if (siguiente) {
      load();
      alAbrir?.();
    }
  }

  return (
    <>
      {/* El botón, con la pinta de sus hermanos del pie del menú. */}
      <button
        onClick={alternar}
        className={`relative p-1 rounded transition-colors cursor-pointer hover:bg-white/[0.06] ${
          open ? "text-white" : "text-white/30 hover:text-white/70"
        }`}
        title="Avisos"
        aria-label="Avisos"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-medium flex items-center justify-center tabular">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* El desplegable, anclado a la pantalla y no al botón: en escritorio
          sale al lado del menú (220 px + 12 de aire) y en móvil ocupa el ancho
          menos los márgenes, que es como ya estaba resuelto cuando flotaba. */}
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
            <div className="crm-flotante fixed z-30 bottom-3 left-3 right-3 sm:right-auto sm:w-80 lg:left-[232px] bg-white rounded-xl shadow-xl border border-neutral-100 overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-neutral-100">
                <span className="eyebrow">Notificaciones</span>
                {unread > 0 && (
                  <button onClick={markAll} className="text-[10px] text-[var(--color-primary,#1B3A2D)] hover:underline">Marcar todas leídas</button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {loading && items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-neutral-400">Cargando…</p>
                ) : items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-neutral-400">Sin notificaciones. 🎉</p>
                ) : (
                  <ul className="divide-y divide-neutral-100">
                    {items.map((n) => (
                      <li key={n.id}>
                        <button onClick={() => onClickItem(n)} className={`w-full text-left px-4 py-3 flex gap-2.5 hover:bg-neutral-50/70 transition-colors ${n.read ? "" : "bg-[var(--color-primary,#1B3A2D)]/[0.03]"}`}>
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${n.read ? "bg-transparent" : "bg-red-500"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-[var(--ink-900)] truncate">{n.title}</div>
                            {n.body && <div className="text-[11px] text-neutral-500 leading-snug mt-0.5 line-clamp-2">{n.body}</div>}
                            <div className="text-[10px] text-neutral-400 mt-0.5">{timeAgo(n.createdAt)}</div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
