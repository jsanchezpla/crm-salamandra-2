"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

export default function NotificationBell() {
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

  // z-30 A PROPÓSITO: los widgets flotantes (campana, Salamandrobot) viven
  // POR DEBAJO de cualquier drawer o modal (convención del CRM: backdrop z-40
  // + panel z-50). Si no, taparían botones de las vistas laterales.
  //
  // Y además `crm-flotante`: el z-index solo NO evita el solape (probado hasta
  // z-10). Esa clase la usa globals.css para OCULTAR el botón mientras hay un
  // panel abierto — ver el comentario largo en Salamandrobot.jsx.
  return (
    <div className="crm-flotante fixed z-30 top-[4.1875rem] lg:top-[1.1875rem] right-[5.25rem]">
      {open && <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />}

      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white border border-neutral-200 shadow-md text-neutral-600 hover:text-[var(--color-primary,#1B3A2D)] hover:border-neutral-300 transition-colors"
        aria-label="Notificaciones"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center tabular">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* MÓVIL: el panel se ancla a la PANTALLA, no a la campana. La campana vive
          a 5.25rem del borde derecho (para dejar sitio al Salamandrobot), así que
          un panel de 320px colgado de ella se salía 29px por la izquierda en un
          móvil de 375px. Desde sm: vuelve a colgar de la campana. */}
      {open && (
        <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto top-[4.25rem] sm:top-full sm:mt-2 sm:right-0 sm:w-80 z-10 bg-white rounded-xl shadow-xl border border-neutral-100 overflow-hidden">
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
      )}
    </div>
  );
}
