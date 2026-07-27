"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * Botón "Sincronizar web" de la pantalla de Clientes.
 *
 * PARA QUÉ: cerrar el círculo web ↔ CRM. Cada alta nueva en WordPress avisa sola
 * al CRM, pero las cuentas creadas ANTES de montar ese aviso nunca llegaron.
 * Este botón lanza la puesta al día: WordPress manda todos sus usuarios y los
 * que no tengan ficha aparecen como solicitudes en Formularios.
 *
 * MISMO PATRÓN que el banner de Formación: el CRM NO llama a WordPress por su
 * cuenta (haría falta guardar allí una contraseña). Se abre el enlace en el
 * navegador de quien está usando el CRM, que ya va logueado como administrador
 * de su web. Por eso el modal explica el paso en vez de ejecutarlo.
 *
 * Si el tenant no tiene el enlace configurado, no se pinta nada.
 */
export default function SyncWebButton() {
  const [estado, setEstado] = useState(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(() => {
    fetch("/api/clients/wp-sync", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setEstado(j.data); })
      .catch(() => {});
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (!estado?.enabled) return null;

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="flex items-center gap-2 bg-white border border-[var(--ink-200)] hover:border-[var(--ink-300)] text-[var(--ink-700)] text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors"
        title="Traer al CRM los usuarios de la web que aún no tienen ficha"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M2.985 19.644v-4.992h4.992m0 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        <span className="hidden sm:inline">Sincronizar web</span>
        {estado.pendientes > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold flex items-center justify-center">
            {estado.pendientes > 99 ? "99+" : estado.pendientes}
          </span>
        )}
      </button>

      {abierto && (
        <SyncWebModal
          url={estado.url}
          pendientes={estado.pendientes}
          onClose={() => { setAbierto(false); cargar(); }}
        />
      )}
    </>
  );
}

function SyncWebModal({ url, pendientes, onClose }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // wp-admin del propio tenant, derivado del enlace (no hardcodear dominios).
  const wpAdmin = (() => {
    try { return new URL(url).origin + "/wp-admin"; } catch { return "tu web (wp-admin)"; }
  })();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { /* portapapeles bloqueado: se puede copiar del cuadro a mano */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-neutral-900 mb-3" style={{ fontFamily: "'Syne', sans-serif" }}>
          Sincronizar clientes con la web
        </h2>

        <div className="text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>
            Trae al CRM las personas que tienen cuenta en la web pero todavía no tienen ficha
            de cliente. No crea fichas por su cuenta: llegan como <strong>solicitudes</strong> y tú
            decides cuáles aceptas.
          </p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Entra como administradora en <code className="bg-neutral-100 px-1 rounded break-all">{wpAdmin}</code>.</li>
            <li>
              Abre este enlace (botón «Abrir») o cópialo en el navegador:
              <div className="mt-1 bg-neutral-50 border border-neutral-200 rounded-md px-2 py-1.5 text-[11px] font-mono text-neutral-700 break-all">
                {url}
              </div>
            </li>
            <li>Verás en pantalla cuántas solicitudes nuevas se han creado.</li>
            <li>
              Vuelve al CRM y revísalas en{" "}
              <Link href="/formularios" className="font-semibold text-[var(--color-primary)] underline decoration-dotted">
                Formularios
              </Link>.
            </li>
          </ol>
          <p className="text-[11px] text-neutral-400">
            Se puede repetir sin miedo: quien ya tiene ficha o ya está en la bandeja no se duplica.
            Las altas nuevas de la web llegan solas, esto es solo para ponerse al día.
          </p>
        </div>

        {pendientes > 0 && (
          <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            Ahora mismo tienes <strong>{pendientes}</strong> {pendientes === 1 ? "solicitud" : "solicitudes"} de la web
            sin revisar en Formularios.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={copiar}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-neutral-700 border border-neutral-300 hover:bg-neutral-50 transition"
          >
            {copiado ? "¡Copiado!" : "Copiar enlace"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
            style={{ background: "var(--color-primary)" }}
          >
            Abrir
          </a>
        </div>
      </div>
    </div>
  );
}
