"use client";

import { useState } from "react";
import Sidebar from "./Sidebar.jsx";

export default function DashboardShell({ tenant, user, modules, primaryColor, secondaryColor, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      className="flex h-screen bg-gray-50"
      style={{
        "--color-primary": primaryColor,
        "--color-secondary": secondaryColor,
      }}
    >
      <Sidebar
        tenant={tenant}
        user={user}
        modules={modules}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 h-14 bg-white border-b border-gray-100 flex items-center px-4 gap-3 shrink-0 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
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
              {tenant?.settings?.brand?.logoUrl ? (
                <img
                  src={tenant.settings.brand.logoUrl}
                  alt={tenant?.name ?? "Logo"}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-white font-black text-xs leading-none">S</span>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-900 truncate">{tenant?.name ?? "CRM"}</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  );
}
