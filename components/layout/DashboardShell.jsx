"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar.jsx";
import Salamandrobot from "../assistant/Salamandrobot.jsx";
import NotificationBell from "./NotificationBell.jsx";
import DemoTabs from "./DemoTabs.jsx";
import AvisoCorreoCuenta from "./AvisoCorreoCuenta.jsx";

export default function DashboardShell({
  tenant,
  user,
  modules,
  demosDisponibles,
  primaryColor,
  secondaryColor,
  accentColor,
  inkColor,
  cardColor,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Aplica las vars de marca a <html> para que cascadeen a TODO,
  // incluyendo elementos renderizados en portales fuera de este árbol.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-primary", primaryColor);
    root.style.setProperty("--color-secondary", secondaryColor);
    root.style.setProperty("--color-accent", accentColor);
    if (inkColor) {
      root.style.setProperty("--color-ink", inkColor);
      // El sistema de tinta cálida se basa en ink-900 (texto principal).
      // Si el tenant pasa inkColor, lo redirigimos ahí para que afecte
      // a todos los `text-[var(--ink-900)]` repartidos por el dashboard.
      root.style.setProperty("--ink-900", inkColor);
    } else {
      root.style.removeProperty("--color-ink");
      root.style.removeProperty("--ink-900");
    }
    if (cardColor) root.style.setProperty("--color-card", cardColor);
    else root.style.removeProperty("--color-card");
    return () => {
      root.style.removeProperty("--color-primary");
      root.style.removeProperty("--color-secondary");
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-ink");
      root.style.removeProperty("--ink-900");
      root.style.removeProperty("--color-card");
    };
  }, [primaryColor, secondaryColor, accentColor, inkColor, cardColor]);

  const shellStyle = {
    "--color-primary": primaryColor,
    "--color-secondary": secondaryColor,
    "--color-accent": accentColor,
    "--color-black": "#000000",
    "--color-white": "#ffffff",
    backgroundColor: accentColor,
  };
  if (inkColor) {
    shellStyle["--color-ink"] = inkColor;
    shellStyle["--ink-900"] = inkColor;
    shellStyle.color = inkColor;
  }
  if (cardColor) {
    shellStyle["--color-card"] = cardColor;
  }

  return (
    <div className="dashboard-shell flex h-screen" style={shellStyle}>
      <NotificationBell />
      <Sidebar
        tenant={tenant}
        user={user}
        modules={modules}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Las demos por oficio. Fuera de una demo no pinta nada. Va ARRIBA del
            todo —encima incluso de la barra móvil— porque es lo que cambia de
            CRM entero: si estuviera dentro de <main> se iría con el scroll. */}
        <DemoTabs slug={tenant?.slug} disponibles={demosDisponibles} />

        {/* Mobile top bar */}
        <header
          className="lg:hidden sticky top-0 z-30 h-14 flex items-center px-4 gap-3 shrink-0 backdrop-blur-md"
          style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 88%, transparent)`, borderBottom: "1px solid var(--ink-200)" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--ink-500)] hover:bg-[var(--ink-100)] transition-colors"
            aria-label="Abrir menú"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              {/*
                Este hueco es CUADRADO (24×24), así que manda el isotipo si el
                cliente lo tiene: es literalmente para lo que existe un isotipo
                (28/08/2026). El logo completo suele ser apaisado —el de Aumenta
                mide 3,5:1— y metido aquí queda como una tira ilegible. Si solo
                hay logo, se usa el logo, que es lo que pasaba hasta hoy.
              */}
              {tenant?.settings?.brand?.isotipoUrl || tenant?.settings?.brand?.logoUrl ? (
                <img
                  src={tenant.settings.brand.isotipoUrl || tenant.settings.brand.logoUrl}
                  alt={tenant?.name ?? "Logo"}
                  className="w-full h-full object-contain"
                />
              ) : (
                <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain p-[3px]" />
              )}
            </div>
            <span className="font-display text-[15px] text-[var(--ink-900)] truncate tracking-tight">{tenant?.name ?? "CRM"}</span>
          </div>
        </header>

        {/* Encima del contenido y dentro de la columna, no flotando: es un aviso
            para la persona, no una notificación. Ver el componente. */}
        <AvisoCorreoCuenta />
        <main className="flex-1 overflow-auto min-w-0 fade-in">{children}</main>
      </div>

      <Salamandrobot />
    </div>
  );
}
