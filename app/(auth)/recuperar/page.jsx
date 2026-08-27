"use client";

/**
 * /recuperar — «¿Olvidaste tu contraseña?», la pantalla.
 *
 * El esquema es de Rodrigo (27/08/2026) y empieza por el USUARIO, no por el
 * correo: con el usuario el servidor sabe si quien pide es un admin (correo
 * con enlace a su dirección de contacto) o alguien del equipo (campana a su
 * admin, que se la restablece desde Equipo). Y si tampoco recuerda el
 * usuario, un formulario mínimo abre una incidencia con Salamandra.
 *
 * La pantalla NO sabe si el usuario existía: para un usuario inventado el
 * servidor contesta lo mismo que para un empleado, a propósito.
 */

import { useState } from "react";
import Link from "next/link";

const CAMPO =
  "w-full rounded-[var(--radius-control)] bg-white border border-[#1B3A2D]/[0.16] px-4 py-3.5 text-[15px] text-[#1B3A2D] placeholder-[#1B3A2D]/30 shadow-[0_1px_2px_rgba(27,58,45,0.05)] focus:outline-none focus:border-[#1B3A2D]/45 transition";
const BOTON =
  "w-full rounded-[var(--radius-control)] bg-[#1B3A2D] text-white px-4 py-4 text-[14px] font-semibold uppercase tracking-[0.16em] hover:bg-[#1B3A2D]/95 focus:outline-none focus:ring-2 focus:ring-[#1B3A2D]/30 disabled:opacity-50 disabled:cursor-not-allowed transition";
const ETIQUETA =
  "block text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em]";

function Shell({ titulo, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] px-6 py-14">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 rounded-md bg-[#1B3A2D] flex items-center justify-center shrink-0 p-[3px]">
            <img src="/salamandrobot-blanco.png" alt="Salamandra Solutions" className="w-full h-full object-contain" />
          </div>
          <span className="text-[16px] font-extrabold tracking-[-0.02em] text-[#1B3A2D]">Salamandra Solutions</span>
        </div>
        <div className="mb-9">
          <p className="text-[10px] font-semibold text-[#1B3A2D]/50 uppercase tracking-[0.16em] mb-4">
            Recuperar el acceso
          </p>
          <h2 className="font-display-lg text-[38px] text-[#1B3A2D] leading-[1.05]">{titulo}</h2>
        </div>
        {children}
        <div className="mt-8">
          <Link href="/login" className="text-[12px] text-[#1B3A2D]/40 hover:text-[#1B3A2D]/80 transition">
            ← Volver a iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RecuperarPage() {
  // "usuario" → pedirlo · "sin-usuario" → el formulario de incidencia
  // "correo" / "admin" / "incidencia" → las tres pantallas de "hecho"
  const [paso, setPaso] = useState("usuario");
  const [usuario, setUsuario] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function pedir(e) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/recuperar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo pedir la recuperación. Prueba en un rato.");
        return;
      }
      setPaso(data.via === "correo" ? "correo" : "admin");
    } catch {
      setError("No hay conexión. Prueba en un rato.");
    } finally {
      setEnviando(false);
    }
  }

  async function abrirIncidencia(e) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/recuperar/usuario-olvidado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, nombre, cargo, correo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo registrar. Escríbenos a info@salamandrasolutions.com.");
        return;
      }
      setPaso("incidencia");
    } catch {
      setError("No hay conexión. Escríbenos a info@salamandrasolutions.com.");
    } finally {
      setEnviando(false);
    }
  }

  if (paso === "correo") {
    return (
      <Shell titulo="Mira tu correo">
        <p className="text-[15px] text-[#1B3A2D]/70 leading-relaxed">
          Te hemos enviado un correo a tu dirección de contacto con un enlace para
          elegir una contraseña nueva. <strong>Caduca en 30 minutos</strong> y solo
          vale una vez; si no aparece, mira la carpeta de spam.
        </p>
      </Shell>
    );
  }

  if (paso === "admin") {
    return (
      <Shell titulo="Aviso enviado">
        <p className="text-[15px] text-[#1B3A2D]/70 leading-relaxed">
          Hemos avisado dentro del CRM a la persona que administra tu centro: puede
          restablecerte la contraseña desde Configuración → Equipo y dártela en
          mano. Si te corre prisa, díselo directamente.
        </p>
      </Shell>
    );
  }

  if (paso === "incidencia") {
    return (
      <Shell titulo="Recibido">
        <p className="text-[15px] text-[#1B3A2D]/70 leading-relaxed">
          Hemos abierto una incidencia con Salamandra Solutions con los datos que
          nos has dado. En cuanto comprobemos que eres quien dices ser, te
          escribiremos al correo que has dejado para devolverte el acceso.
        </p>
      </Shell>
    );
  }

  if (paso === "sin-usuario") {
    return (
      <Shell titulo="¿Tampoco recuerdas tu usuario?">
        <form onSubmit={abrirIncidencia} className="space-y-5">
          <p className="text-[14px] text-[#1B3A2D]/60 leading-relaxed">
            Dinos quién eres y abrimos una incidencia con Salamandra Solutions
            para devolverte el acceso.
          </p>
          <div className="space-y-2">
            <label htmlFor="empresa" className={ETIQUETA}>Empresa o centro</label>
            <input id="empresa" required maxLength={120} value={empresa}
              onChange={(e) => setEmpresa(e.target.value)} className={CAMPO}
              placeholder="para quién trabajas" />
          </div>
          <div className="space-y-2">
            <label htmlFor="nombre" className={ETIQUETA}>Tu nombre</label>
            <input id="nombre" required maxLength={120} value={nombre}
              onChange={(e) => setNombre(e.target.value)} className={CAMPO}
              placeholder="nombre y apellidos" />
          </div>
          <div className="space-y-2">
            <label htmlFor="cargo" className={ETIQUETA}>Tu puesto</label>
            <input id="cargo" maxLength={80} value={cargo}
              onChange={(e) => setCargo(e.target.value)} className={CAMPO}
              placeholder="administración, terapeuta…" />
          </div>
          <div className="space-y-2">
            <label htmlFor="correo" className={ETIQUETA}>Un correo donde escribirte</label>
            <input id="correo" type="email" required maxLength={255} value={correo}
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              onChange={(e) => setCorreo(e.target.value)} className={CAMPO}
              placeholder="a dónde te mandamos el acceso" />
          </div>
          {error && <p className="text-[13px] text-red-700">{error}</p>}
          <button type="submit" disabled={enviando} className={BOTON}>
            {enviando ? "Enviando…" : "Avisar a Salamandra"}
          </button>
          <button type="button" onClick={() => { setPaso("usuario"); setError(""); }}
            className="w-full text-[12px] text-[#1B3A2D]/40 hover:text-[#1B3A2D]/80 transition">
            Sí que recuerdo mi usuario
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell titulo="Recupera tu contraseña">
      <form onSubmit={pedir} className="space-y-5">
        <p className="text-[14px] text-[#1B3A2D]/60 leading-relaxed">
          Escribe tu usuario y vemos cómo devolverte el acceso: si administras tu
          centro te llegará un correo; si no, avisaremos a quien lo administra.
        </p>
        <div className="space-y-2">
          <label htmlFor="usuario" className={ETIQUETA}>Tu usuario</label>
          <input id="usuario" required maxLength={255} autoComplete="username"
            autoCapitalize="off" autoCorrect="off" spellCheck={false} value={usuario}
            onChange={(e) => setUsuario(e.target.value)} className={CAMPO}
            placeholder="con el que entras al CRM" />
        </div>
        {error && <p className="text-[13px] text-red-700">{error}</p>}
        <button type="submit" disabled={enviando} className={BOTON}>
          {enviando ? "Un momento…" : "Continuar"}
        </button>
        <button type="button" onClick={() => { setPaso("sin-usuario"); setError(""); }}
          className="w-full text-[12px] text-[#1B3A2D]/40 hover:text-[#1B3A2D]/80 transition">
          Tampoco recuerdo mi usuario
        </button>
      </form>
    </Shell>
  );
}
