"use client";

import { useState } from "react";

/**
 * Modal de credenciales de un solo uso.
 *
 * Enseña el usuario y la contraseña generada UNA única vez (el servidor no la
 * guarda en claro ni la vuelve a devolver). No hay email de invitación — es el
 * patrón de la casa: el admin la copia y se la pasa a la persona por el canal
 * que quiera. Por eso el modal no se cierra clicando fuera: solo con el botón,
 * para que nadie lo cierre sin querer antes de copiar.
 */
export default function CredentialsModal({ username, password, title = "Acceso creado", onClose }) {
  const [copied, setCopied] = useState(null); // "user" | "pass" | "both"

  async function copiar(texto, que) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopied(que);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* portapapeles bloqueado: se puede copiar a mano */ }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-bold text-neutral-900 mb-1" style={{ fontFamily: "'Syne', sans-serif" }}>
          {title}
        </h2>
        <p className="text-xs text-neutral-500 mb-4">
          Copia estos datos y pásaselos a la persona. <strong>La contraseña no se volverá a mostrar</strong>:
          si se pierde, habrá que restablecerla desde su ficha.
        </p>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-neutral-400">Usuario</div>
              <div className="text-sm font-mono text-neutral-900 break-all">{username}</div>
            </div>
            <button type="button" onClick={() => copiar(username, "user")}
              className="shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold border border-neutral-300 text-neutral-700 hover:bg-neutral-50">
              {copied === "user" ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-neutral-400">Contraseña</div>
              <div className="text-sm font-mono text-neutral-900 break-all">{password}</div>
            </div>
            <button type="button" onClick={() => copiar(password, "pass")}
              className="shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold border border-neutral-300 text-neutral-700 hover:bg-neutral-50">
              {copied === "pass" ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-5">
          <button type="button"
            onClick={() => copiar(`Usuario: ${username}\nContraseña: ${password}`, "both")}
            className="px-3 py-2 rounded-lg text-[11px] font-semibold border border-neutral-300 text-neutral-700 hover:bg-neutral-50">
            {copied === "both" ? "¡Copiado!" : "Copiar los dos"}
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            Ya los he guardado
          </button>
        </div>
      </div>
    </div>
  );
}
