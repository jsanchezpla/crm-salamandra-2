"use client";

/**
 * /recuperar/[token] — la página del enlace del correo: la contraseña nueva,
 * dos veces, y ya está cambiada.
 *
 * El token no se comprueba al abrir, a propósito: comprobarlo sería gastar una
 * consulta por cada robot que siga el enlace, y la respuesta buena o mala se
 * da igual al enviar. Los requisitos son LOS MISMOS que en Configuración
 * (lib/auth/contrasena.js, que no importa nada y corre en el navegador) y se
 * pintan marcándose mientras se escribe, no cuando ya has fallado.
 */

import { use, useState } from "react";
import Link from "next/link";
import { requisitosDe, cumpleTodo } from "../../../../lib/auth/contrasena.js";

const CAMPO =
  "w-full rounded-[var(--radius-control)] bg-white border border-[#1B3A2D]/[0.16] px-4 py-3.5 text-[15px] text-[#1B3A2D] placeholder-[#1B3A2D]/30 shadow-[0_1px_2px_rgba(27,58,45,0.05)] focus:outline-none focus:border-[#1B3A2D]/45 transition";
const ETIQUETA =
  "block text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em]";

export default function RecuperarTokenPage({ params }) {
  const { token } = use(params);
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);

  const requisitos = requisitosDe(password);
  const casan = password.length > 0 && password === repetida;
  const puedeEnviar = cumpleTodo(password) && casan && !enviando;

  async function cambiar(e) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/recuperar/completar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo cambiar. Vuelve a pedir la recuperación.");
        return;
      }
      setHecho(true);
    } catch {
      setError("No hay conexión. Prueba en un rato.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] px-6 py-14">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 rounded-md bg-[#1B3A2D] flex items-center justify-center shrink-0 p-[3px]">
            <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
          </div>
          <span className="text-[16px] font-extrabold tracking-[-0.02em] text-[#1B3A2D]">Salamandra Solutions</span>
        </div>

        {hecho ? (
          <>
            <h2 className="font-display-lg text-[38px] text-[#1B3A2D] leading-[1.05] mb-4">
              Contraseña cambiada
            </h2>
            <p className="text-[15px] text-[#1B3A2D]/70 leading-relaxed mb-8">
              Ya puedes entrar con la nueva. Las sesiones que hubiera abiertas se
              han cerrado.
            </p>
            <Link
              href="/login"
              className="inline-block rounded-[var(--radius-control)] bg-[#1B3A2D] text-white px-8 py-4 text-[14px] font-semibold uppercase tracking-[0.16em] hover:bg-[#1B3A2D]/95 transition"
            >
              Iniciar sesión
            </Link>
          </>
        ) : (
          <>
            <div className="mb-9">
              <p className="text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em] mb-4">
                Recuperar el acceso
              </p>
              <h2 className="font-display-lg text-[38px] text-[#1B3A2D] leading-[1.05]">
                Elige tu contraseña nueva
              </h2>
            </div>
            <form onSubmit={cambiar} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="password" className={ETIQUETA}>Contraseña nueva</label>
                <input id="password" type={ver ? "text" : "password"} autoComplete="new-password"
                  required value={password} onChange={(e) => setPassword(e.target.value)}
                  className={CAMPO} placeholder={ver ? "tu contraseña nueva" : "••••••••"} />
              </div>
              <div className="space-y-2">
                <label htmlFor="repetida" className={ETIQUETA}>Otra vez, para estar seguros</label>
                <input id="repetida" type={ver ? "text" : "password"} autoComplete="new-password"
                  required value={repetida} onChange={(e) => setRepetida(e.target.value)}
                  className={CAMPO} placeholder={ver ? "la misma" : "••••••••"} />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[#1B3A2D]/50 cursor-pointer select-none">
                <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
                Ver lo que escribo
              </label>

              <ul className="space-y-1">
                {requisitos.map((r) => (
                  <li key={r.texto} className={`text-[13px] flex items-center gap-2 ${r.cumple ? "text-[#1B3A2D]" : "text-[#1B3A2D]/40"}`}>
                    <span>{r.cumple ? "✓" : "·"}</span> {r.texto}
                  </li>
                ))}
                <li className={`text-[13px] flex items-center gap-2 ${casan ? "text-[#1B3A2D]" : "text-[#1B3A2D]/40"}`}>
                  <span>{casan ? "✓" : "·"}</span> Las dos casan
                </li>
              </ul>

              {error && <p className="text-[13px] text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={!puedeEnviar}
                className="w-full rounded-[var(--radius-control)] bg-[#1B3A2D] text-white px-4 py-4 text-[14px] font-semibold uppercase tracking-[0.16em] hover:bg-[#1B3A2D]/95 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {enviando ? "Cambiando…" : "Cambiar la contraseña"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
