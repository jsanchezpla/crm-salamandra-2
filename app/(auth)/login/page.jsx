"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
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
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-xs font-medium text-neutral-500">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-neutral-50 border border-neutral-200 px-3.5 py-3 text-sm text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-2 focus:ring-[#2EE59D] focus:border-transparent transition"
          placeholder="tu@empresa.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-xs font-medium text-neutral-500">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-neutral-50 border border-neutral-200 px-3.5 py-3 text-sm text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-2 focus:ring-[#2EE59D] focus:border-transparent transition"
          placeholder="••••••••"
        />
      </div>

      <div className="flex justify-end">
        <a className="text-xs text-neutral-400 hover:text-neutral-700 transition cursor-pointer">
          ¿Olvidaste tu contraseña?
        </a>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 text-sm font-bold text-white uppercase tracking-wide hover:bg-[#2EE59D] hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#2EE59D] focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
      >
        {loading ? (
          "Iniciando sesión…"
        ) : (
          <>
            Iniciar sesión
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
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

      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 h-px bg-neutral-100" />
        <span className="text-xs text-neutral-300">Salamandra CRM v1.0</span>
        <div className="flex-1 h-px bg-neutral-100" />
      </div>

      <p className="text-center text-xs text-neutral-300">
        ¿Problemas para acceder?{" "}
        <span className="text-neutral-400">soporte@salamandrasolutions.com</span>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[1.1fr_1fr]">
      {/* Columna izquierda — Branding */}
      <div className="hidden md:flex bg-[#0F0F0F] flex-col justify-between px-14 py-14 relative overflow-hidden">
        {/* Grid de fondo */}
        <div
          className="absolute inset-0 opacity-100"
          style={{
            backgroundImage:
              "linear-gradient(rgba(46,229,157,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(46,229,157,0.03) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Contenido */}
        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 bg-[#2EE59D] rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-neutral-900 font-black text-base leading-none">S</span>
            </div>
            <span className="text-white font-bold text-base tracking-wide">
              Salamandra Solutions
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-8xl font-extrabold text-white leading-tight mb-5">
            Tu negocio,
            <br />
            <span className="text-[#2EE59D]">bajo control.</span>
          </h1>
          <p className="text-base text-neutral-500 leading-relaxed max-w-xs">
            Gestiona clientes, proyectos y ventas desde un solo lugar. CRM diseñado para crecer
            contigo.
          </p>
        </div>

        {/* Features + copyright */}
        <div className="relative z-10 space-y-4">
          {[
            "Multi-tenant — cada cliente, su espacio",
            "17 módulos integrados",
            "Facturación con Verifactu incluida",
          ].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2EE59D] flex-shrink-0" />
              <span className="text-base text-neutral-600">{item}</span>
            </div>
          ))}
          <p className="text-xs text-neutral-800 pt-4">© 2026 Salamandra Solutions</p>
        </div>
      </div>

      {/* Columna derecha — Formulario */}
      <div className="flex items-center justify-center bg-white px-8 py-14">
        <div className="w-full max-w-sm">
          {/* Header mobile — solo visible en móvil */}
          <div className="flex items-center gap-3 mb-8 md:hidden">
            <div className="w-9 h-9 bg-[#0F0F0F] rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-[#2EE59D] font-black text-base leading-none">S</span>
            </div>
            <span className="font-bold text-neutral-900">Salamandra</span>
          </div>

          <p className="text-xs font-bold text-[#2EE59D] uppercase tracking-widest mb-2">
            Acceso seguro
          </p>
          <h2 className="text-2xl font-bold text-neutral-900 mb-1">Bienvenido de nuevo</h2>
          <p className="text-sm text-neutral-400 mb-8">Introduce tus credenciales para continuar</p>

          <Suspense
            fallback={
              <div className="space-y-4">
                <div className="h-10 bg-neutral-100 rounded-lg animate-pulse" />
                <div className="h-10 bg-neutral-100 rounded-lg animate-pulse" />
                <div className="h-10 bg-neutral-100 rounded-lg animate-pulse" />
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
