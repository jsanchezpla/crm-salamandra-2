"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

// Destino tras el login. Solo se acepta una ruta INTERNA ("/algo"): un
// `next` con host propio ("//evil.com" o "https://…") sería un open redirect
// que un atacante podría colar en un enlace de login. OJO: el parser de URLs
// de los navegadores trata "\" como "/" y descarta tabs/CR/LF, así que
// "/\evil.com" o "/%09/evil.com" también resolverían fuera del dominio — se
// rechaza cualquier backslash o carácter de control antes de los demás checks.
function safeNext(raw) {
  if (typeof raw !== "string") return "/";
  // Backslash o caracteres de control (tab, CR, LF...): fuera.
  if (raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get("expired") === "1";
  const next = safeNext(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(
    expired ? "Tu sesión ha expirado. Inicia sesión de nuevo." : ""
  );
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // Demo pública: entra en el tenant "demo" sin credenciales.
  async function handleDemo() {
    setError("");
    setDemoLoading(true);
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "No se pudo abrir la demo");
        setDemoLoading(false); // solo se reactiva el botón si NO navegamos
        return;
      }
      // Deja el botón deshabilitado mientras navega (evita el doble POST) y
      // respeta ?next igual que el login normal.
      window.location.href = next;
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
      setDemoLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Trim del email (autofill móvil suele meter espacios). El password NO
      // se trimea: puede tener espacios intencionales y romper logins legítimos.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || "Error al iniciar sesión");
        return;
      }

      // Vuelve a donde estabas cuando caducó la sesión (o al inicio).
      window.location.href = next;
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-[var(--radius-control)] bg-[#1B3A2D]/[0.06] border border-[#1B3A2D]/[0.14] px-4 py-3 text-[13px] text-[#1B3A2D]">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em]"
        >
          Email o usuario
        </label>
        {/* type="text" a propósito: además de emails, hay cuentas con nombre de
            usuario (p. ej. las terapeutas de Aumenta: "Arantxa_Aumenta"), y
            type="email" haría que el navegador las bloquease por no llevar @.
            Desde el 26/08/2026 los DOS valen para la misma cuenta: el backend
            busca lo tecleado (en minúsculas) en `email` y, si lleva arroba,
            también en `email_contacto`. Ver lib/auth/correoCuenta.js. */}
        <input
          id="email"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-[var(--radius-control)] bg-white border border-[#1B3A2D]/[0.16] px-4 py-3.5 text-[15px] text-[#1B3A2D] placeholder-[#1B3A2D]/30 shadow-[0_1px_2px_rgba(27,58,45,0.05)] focus:outline-none focus:border-[#1B3A2D]/45 transition"
          placeholder="tu@empresa.com o usuario"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em]"
        >
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full rounded-[var(--radius-control)] bg-white border border-[#1B3A2D]/[0.16] pl-4 pr-12 py-3.5 text-[15px] text-[#1B3A2D] placeholder-[#1B3A2D]/30 shadow-[0_1px_2px_rgba(27,58,45,0.05)] focus:outline-none focus:border-[#1B3A2D]/45 transition ${showPassword ? "" : "tracking-widest"}`}
            placeholder={showPassword ? "tu contraseña" : "••••••••"}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-md bg-[#1B3A2D] text-white hover:bg-[#1B3A2D]/90 transition-colors shadow-sm"
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <a className="text-[12px] text-[#1B3A2D]/40 hover:text-[#1B3A2D]/80 transition cursor-pointer">
          ¿Olvidaste tu contraseña?
        </a>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-[var(--radius-control)] bg-[#1B3A2D] text-white px-4 py-4 text-[14px] font-semibold uppercase tracking-[0.16em] hover:bg-[#1B3A2D]/95 focus:outline-none focus:ring-2 focus:ring-[#1B3A2D]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAF8] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-3"
      >
        {loading ? (
          <span className="flex items-center gap-2.5">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Iniciando sesión
          </span>
        ) : (
          <>
            Acceder al panel
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </>
        )}
      </button>

      <div className="flex items-center gap-3 pt-1">
        <div className="flex-1 h-px bg-[#1B3A2D]/[0.12]" />
        <button
          type="button"
          onClick={handleDemo}
          disabled={demoLoading}
          className="text-[10px] text-[#1B3A2D]/60 hover:text-[#1B3A2D] tracking-[0.16em] uppercase font-mono border border-[#1B3A2D]/20 hover:border-[#1B3A2D]/50 rounded-full px-3.5 py-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {demoLoading ? "Entrando…" : "Prueba una demo"}
        </button>
        <div className="flex-1 h-px bg-[#1B3A2D]/[0.12]" />
      </div>

      <p className="text-center text-[12px] text-[#1B3A2D]/35">
        ¿Problemas? <span className="text-[#1B3A2D]/55 font-mono">info@salamandrasolutions.com</span>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-[#FAFAF8]">
      {/* Columna izquierda — marca en verde. La tipografía del nombre es la
          del hero de salamandrasolutions.com (Poppins), con los pesos que
          eligió Rodrigo: «Salamandra» en 600 y «Solutions» en 500 casi pleno. */}
      <div className="hidden md:flex flex-col justify-between px-12 lg:px-16 py-14 bg-[#1B3A2D] relative overflow-hidden">
        {/* Salamandra gigante de marca de agua, sangrando por la esquina */}
        <img
          src="/salamandrobot-blanco.png"
          alt=""
          aria-hidden="true"
          className="absolute w-[640px] max-w-none -right-[140px] -bottom-[170px] opacity-[0.09] -rotate-[8deg] pointer-events-none select-none"
        />

        {/* Logo */}
        <div className="flex items-center gap-3 relative">
          <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center shrink-0 p-[3px]">
            <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
          </div>
          <span className="text-[16px] font-extrabold tracking-[-0.02em] text-white">Salamandra Solutions</span>
        </div>

        {/* Wordmark */}
        <div className="relative fade-up">
          <h1 className="text-[clamp(48px,5.5vw,80px)] leading-[1.05] tracking-[-0.02em] font-semibold text-white">
            Salamandra
            <span className="block font-medium text-white/85">Solutions</span>
          </h1>
          <p className="mt-6 text-[16px] lg:text-[17px] text-white/60 leading-relaxed max-w-md">
            El CRM donde tu centro pasa el día: clientes, citas y facturación,
            cada cosa en su sitio.
          </p>
        </div>

        <p className="text-[11px] text-white/35 font-mono tracking-wider uppercase relative">
          © 2026 · Salamandra Solutions
        </p>
      </div>

      {/* Columna derecha — formulario en claro */}
      <div className="flex items-center justify-center bg-[#FAFAF8] px-6 lg:px-12 py-14">
        <div className="w-full max-w-sm">
          {/* Logo mobile (la columna de marca no se ve en móvil) */}
          <div className="flex items-center gap-3 mb-12 md:hidden">
            <div className="w-8 h-8 rounded-md bg-[#1B3A2D] flex items-center justify-center shrink-0 p-[3px]">
              <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
            </div>
            <span className="text-[16px] font-extrabold tracking-[-0.02em] text-[#1B3A2D]">Salamandra Solutions</span>
          </div>

          {/* Cabecera */}
          <div className="mb-9 fade-up">
            <p className="text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em] mb-4">
              Acceso seguro
            </p>
            <h2 className="font-display-lg text-[44px] text-[#1B3A2D] leading-[1.02] mb-3">
              Iniciar sesión
            </h2>
            <p className="text-[15px] text-[#1B3A2D]/50">Accede a tu panel de control</p>
          </div>

          <Suspense
            fallback={
              <div className="space-y-5">
                <div className="h-14 bg-[#1B3A2D]/[0.06] rounded-[var(--radius-control)] animate-pulse" />
                <div className="h-14 bg-[#1B3A2D]/[0.06] rounded-[var(--radius-control)] animate-pulse" />
                <div className="h-12 bg-[#1B3A2D]/[0.06] rounded-[var(--radius-control)] animate-pulse" />
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
