"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get("expired") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    expired ? "Tu sesión ha expirado. Inicia sesión de nuevo." : ""
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || "Error al iniciar sesión");
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-white/10 border border-white/20 px-4 py-3 text-sm text-white/80">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label
          htmlFor="email"
          className="block text-xs font-semibold text-white/40 uppercase tracking-widest"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-white/[0.07] border border-white/10 px-4 py-3.5 text-base text-white placeholder-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition"
          placeholder="tu@empresa.com"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="block text-xs font-semibold text-white/40 uppercase tracking-widest"
        >
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-white/[0.07] border border-white/10 px-4 py-3.5 text-base text-white placeholder-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition"
          placeholder="••••••••"
        />
      </div>

      <div className="flex justify-end">
        <a className="text-xs text-white/25 hover:text-white/60 transition cursor-pointer">
          ¿Olvidaste tu contraseña?
        </a>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-white text-[#1B3A2D] px-4 py-4 text-base font-bold uppercase tracking-wide hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-[#1B3A2D] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Iniciando sesión…
          </span>
        ) : (
          <>
            Acceder al panel
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </>
        )}
      </button>

      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-white/[0.08]" />
        <span className="text-[11px] text-white/20 tracking-wider">Salamandra CRM v1.0</span>
        <div className="flex-1 h-px bg-white/[0.08]" />
      </div>

      <p className="text-center text-xs text-white/20">
        ¿Problemas? <span className="text-white/35">soporte@salamandrasolutions.com</span>
      </p>
    </form>
  );
}

const FEATURES = [
  {
    icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
    label: "Clientes & Cuentas",
  },
  {
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
    label: "Analítica en tiempo real",
  },
  {
    icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z",
    label: "Facturación Verifactu",
  },
  {
    icon: "M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z",
    label: "Kanban & Proyectos",
  },
  {
    icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    label: "Multi-tenant & 17 módulos",
  },
  {
    icon: "M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244",
    label: "Automatizaciones & API",
  },
];

export default function LoginPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      {/* Columna izquierda — branding */}
      <div
        className="hidden md:flex flex-col justify-between px-14 py-14 bg-[#FAFAF8] relative overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#1B3A2D] flex items-center justify-center shrink-0">
            <span className="text-white font-black text-sm leading-none">S</span>
          </div>
          <span className="text-[#1B3A2D] text-sm font-bold tracking-wide uppercase">
            Salamandra Solutions
          </span>
        </div>

        {/* Headline */}
        <div>
          <div className="inline-flex items-center gap-2 bg-[#1B3A2D]/8 border border-[#1B3A2D]/10 rounded-full px-3 py-1 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-[#1B3A2D]/35" />
            <span className="text-xs font-semibold text-[#1B3A2D]/60 uppercase tracking-widest">
              CRM SaaS — Multi-tenant
            </span>
          </div>

          <h1 className="text-[64px] font-extrabold text-[#1B3A2D] leading-[1.05] mb-5 tracking-tight">
            Tu negocio
            <br />
            <span className="text-[#1B3A2D]/30">bajo control.</span>
          </h1>

          <p className="text-base text-neutral-400 leading-relaxed max-w-sm">
            Gestiona clientes, proyectos, ventas y facturación desde un solo panel. Cada cliente, su
            espacio.
          </p>
        </div>

        {/* Feature grid */}
        <div>
          <div className="grid grid-cols-2 gap-2 mb-8">
            {FEATURES.map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-2.5 bg-white border border-neutral-100 rounded-lg px-3 py-2.5 shadow-sm"
              >
                <svg
                  className="w-4 h-4 text-[#1B3A2D]/50 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                </svg>
                <span className="text-xs font-medium text-neutral-500 leading-tight">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-300">© 2026 Salamandra Solutions</p>
        </div>
      </div>

      {/* Columna derecha — formulario */}
      <div className="flex items-center justify-center bg-[#1B3A2D] px-8 py-14">
        <div className="w-full max-w-sm">
          {/* Logo mobile */}
          <div className="flex items-center gap-2.5 mb-10 md:hidden">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center shrink-0">
              <span className="text-white font-black text-sm leading-none">S</span>
            </div>
            <span className="text-white text-sm font-bold tracking-wide uppercase">
              Salamandra Solutions
            </span>
          </div>

          {/* Cabecera */}
          <div className="mb-8">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">
              Acceso seguro
            </p>
            <h2 className="text-4xl font-extrabold text-white tracking-tight leading-tight mb-2">
              Iniciar sesión
            </h2>
            <p className="text-base text-white/35">Accede a tu panel de control</p>
          </div>

          <Suspense
            fallback={
              <div className="space-y-5">
                <div className="h-14 bg-white/10 rounded-lg animate-pulse" />
                <div className="h-14 bg-white/10 rounded-lg animate-pulse" />
                <div className="h-12 bg-white/10 rounded-lg animate-pulse" />
              </div>
            }
          >
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
