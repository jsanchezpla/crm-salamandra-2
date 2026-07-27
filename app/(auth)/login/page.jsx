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
        <div className="rounded-[var(--radius-control)] bg-white/[0.06] border border-white/[0.12] px-4 py-3 text-[13px] text-white/85">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-[10px] font-semibold text-white/45 uppercase tracking-[0.16em]"
        >
          Email o usuario
        </label>
        {/* type="text" a propósito: además de emails, hay cuentas con nombre de
            usuario (p. ej. las terapeutas de Aumenta: "Arantxa_Aumenta"), y
            type="email" haría que el navegador las bloquease por no llevar @.
            El backend busca el valor tal cual (en minúsculas) en master.users. */}
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
          className="w-full rounded-[var(--radius-control)] bg-white/[0.05] border border-white/[0.12] px-4 py-3.5 text-[15px] text-white placeholder-white/25 focus:outline-none focus:border-white/40 focus:bg-white/[0.08] transition font-mono"
          placeholder="tu@empresa.com o usuario"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-[10px] font-semibold text-white/45 uppercase tracking-[0.16em]"
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
            className={`w-full rounded-[var(--radius-control)] bg-white/[0.05] border border-white/[0.12] pl-4 pr-12 py-3.5 text-[15px] text-white placeholder-white/25 focus:outline-none focus:border-white/40 focus:bg-white/[0.08] transition font-mono ${showPassword ? "" : "tracking-widest"}`}
            placeholder={showPassword ? "tu contraseña" : "••••••••"}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-md bg-white text-[#1B3A2D] hover:bg-white/90 transition-colors shadow-sm"
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
        <a className="text-[12px] text-white/30 hover:text-white/70 transition cursor-pointer">
          ¿Olvidaste tu contraseña?
        </a>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-[var(--radius-control)] bg-white text-[#1B3A2D] px-4 py-4 text-[14px] font-semibold uppercase tracking-[0.16em] hover:bg-white/95 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#1B3A2D] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-3"
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
        <div className="flex-1 h-px bg-white/[0.10]" />
        <button
          type="button"
          onClick={handleDemo}
          disabled={demoLoading}
          className="text-[10px] text-white/55 hover:text-white tracking-[0.16em] uppercase font-mono border border-white/15 hover:border-white/45 rounded-full px-3.5 py-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {demoLoading ? "Entrando…" : "Prueba una demo"}
        </button>
        <div className="flex-1 h-px bg-white/[0.10]" />
      </div>

      <p className="text-center text-[12px] text-white/25">
        ¿Problemas? <span className="text-white/45 font-mono">info@salamandrasolutions.com</span>
      </p>
    </form>
  );
}

const FEATURES = [
  { label: "Clientes & cuentas" },
  { label: "Leads & comercial" },
  { label: "Inventario" },
  { label: "Facturación Verifactu" },
  { label: "Formación" },
  { label: "Multi-tenant SaaS" },
];

export default function LoginPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-[#FAFAF8]">
      {/* Columna izquierda — branding */}
      <div
        className="hidden md:flex flex-col justify-between px-12 lg:px-16 py-14 bg-[#FAFAF8] relative overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 100%, rgba(27,58,45,0.05), transparent 50%), linear-gradient(rgba(27,58,45,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(27,58,45,0.04) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 36px 36px, 36px 36px",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 fade-up">
          <div className="w-8 h-8 rounded-md bg-[#1B3A2D] flex items-center justify-center shrink-0 p-[3px]">
            <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
          </div>
          <span className="font-display text-[17px] tracking-tight text-[#1B3A2D]">Salamandra Solutions</span>
        </div>

        {/* Headline */}
        <div>
          <div
            className="inline-flex items-center gap-2 bg-[#1B3A2D]/[0.06] border border-[#1B3A2D]/[0.10] rounded-full px-3 py-1 mb-7 fade-up"
            style={{ animationDelay: "100ms" }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[#1B3A2D]/45" />
            <span className="text-[10px] font-semibold text-[#1B3A2D]/65 uppercase tracking-[0.16em]">
              CRM SaaS · Multi-tenant
            </span>
          </div>

          <h1
            className="font-display-lg text-[clamp(48px,6.2vw,76px)] leading-[0.98] text-[#1B3A2D] mb-7 fade-up"
            style={{ animationDelay: "180ms" }}
          >
            Tu negocio
            <br />
            <span className="font-display-italic text-[#1B3A2D]/35">bajo control.</span>
          </h1>

          <p
            className="text-[16px] text-[#1B3A2D]/50 leading-relaxed max-w-md fade-up"
            style={{ animationDelay: "260ms" }}
          >
            Gestiona clientes, proyectos, ventas y facturación desde un solo panel.
            Cada cliente, su espacio. Cada decisión, sus datos.
          </p>
        </div>

        {/* Feature list — periódico */}
        <div className="fade-up" style={{ animationDelay: "340ms" }}>
          <div className="text-[10px] font-semibold text-[#1B3A2D]/45 uppercase tracking-[0.16em] mb-4">
            Todo en uno
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 mb-10 max-w-md">
            {FEATURES.map((f, i) => (
              <div key={f.label} className="flex items-baseline gap-3 border-b border-[#1B3A2D]/10 py-2">
                <span className="font-mono text-[10px] text-[#1B3A2D]/40 tabular">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13px] text-[#1B3A2D]/85">{f.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#1B3A2D]/30 font-mono tracking-wider uppercase">
            © 2026 · Salamandra Solutions
          </p>
        </div>
      </div>

      {/* Columna derecha — formulario */}
      <div className="flex items-center justify-center bg-[#1B3A2D] px-6 lg:px-12 py-14 relative overflow-hidden">
        {/* Decoración de fondo */}
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 80% 20%, rgba(255,255,255,0.06), transparent 50%)",
          }}
        />

        <div className="w-full max-w-sm relative">
          {/* Logo mobile */}
          <div className="flex items-center gap-3 mb-12 md:hidden">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center shrink-0 p-[3px]">
              <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
            </div>
            <span className="font-display text-[16px] tracking-tight text-white">Salamandra Solutions</span>
          </div>

          {/* Cabecera */}
          <div className="mb-9 fade-up">
            <p className="text-[10px] font-semibold text-white/45 uppercase tracking-[0.16em] mb-4">
              Acceso seguro
            </p>
            <h2 className="font-display-lg text-[44px] text-white leading-[1.02] mb-3">
              Iniciar <span className="font-display-italic text-white/55">sesión</span>
            </h2>
            <p className="text-[15px] text-white/45">Accede a tu panel de control</p>
          </div>

          <Suspense
            fallback={
              <div className="space-y-5">
                <div className="h-14 bg-white/[0.06] rounded-[var(--radius-control)] animate-pulse" />
                <div className="h-14 bg-white/[0.06] rounded-[var(--radius-control)] animate-pulse" />
                <div className="h-12 bg-white/[0.06] rounded-[var(--radius-control)] animate-pulse" />
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
