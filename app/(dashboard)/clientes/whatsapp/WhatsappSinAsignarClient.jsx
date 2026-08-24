"use client";

/**
 * WhatsApp sin asignar — la bandeja de lo que no es de nadie.
 *
 * Una fila por NÚMERO, no por mensaje: lo que se decide aquí es «esta
 * conversación es de esta persona», y eso se decide una vez por número aunque
 * haya veinte mensajes debajo.
 *
 * Al asignar, el número queda además registrado en la ficha como teléfono
 * secundario, así que los siguientes mensajes entran solos y la conversación no
 * vuelve a esta lista. Sin eso esto sería una noria: asignar lo mismo cada
 * semana.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const fmtFecha = (iso) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" });

const fmtFechaHora = (iso) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

/** 34600999888 → +34 600 99 98 88. Otros prefijos, sin agrupar. */
function fmtTelefono(digitos) {
  const d = String(digitos ?? "");
  if (d.startsWith("34") && d.length === 11) {
    const n = d.slice(2);
    return `+34 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }
  return `+${d}`;
}

export default function WhatsappSinAsignarClient() {
  const [conversaciones, setConversaciones] = useState(null);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(() => {
    let vivo = true;
    fetch("/api/whatsapp/sin-asignar", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (j?.ok) setConversaciones(j.data.conversaciones ?? []);
        else setError(j?.error || "No se ha podido cargar");
      })
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, []);

  useEffect(() => cargar(), [cargar]);

  const alAsignar = useCallback((phone) => {
    setConversaciones((prev) => (prev ?? []).filter((c) => c.phone !== phone));
    setAbierta(null);
  }, []);

  return (
    <div className={anchoPantalla("listado")}>
      <div className="mb-6">
        <Link href="/clientes" className="text-xs text-gray-400 hover:text-gray-700">← Clientes</Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">WhatsApp sin asignar</h1>
        <p className="text-sm text-gray-500 mt-1">
          Mensajes que han llegado desde números que no están en ninguna ficha. Al asignarlos, el número queda guardado
          en la ficha y los siguientes entran solos.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {!error && conversaciones === null && <p className="text-sm text-gray-400">Cargando…</p>}

      {!error && conversaciones?.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center">
          <p className="text-sm text-gray-500">No hay ningún mensaje sin asignar.</p>
          <p className="text-xs text-gray-400 mt-1">
            Todo lo que ha llegado por WhatsApp está colgado de la ficha de alguien.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {(conversaciones ?? []).map((c) => (
          <div key={c.phone} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 font-mono">{fmtTelefono(c.phone)}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {c.total} mensaje{c.total === 1 ? "" : "s"} · desde el {fmtFecha(c.desde)}
                  </div>
                </div>
                <button
                  onClick={() => setAbierta(abierta === c.phone ? null : c.phone)}
                  className="text-xs font-medium text-white px-3 py-1.5 rounded-lg shrink-0"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  {abierta === c.phone ? "Cancelar" : "Asignar a una ficha"}
                </button>
              </div>

              <div className="mt-3 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                <p className="text-[13px] text-gray-700 line-clamp-3 whitespace-pre-wrap break-words">
                  {c.ultimo.direction === "out" && (
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1.5">Enviado</span>
                  )}
                  {c.ultimo.body || <span className="italic text-gray-400">(sin texto)</span>}
                </p>
                <div className="text-[10px] text-gray-400 mt-1">{fmtFechaHora(c.ultimo.sentAt)}</div>
              </div>
            </div>

            {abierta === c.phone && <BuscadorDeFicha phone={c.phone} onAsignado={alAsignar} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Buscar la ficha y asignarle la conversación. */
function BuscadorDeFicha({ phone, onAsignado }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState(null);
  const peticion = useRef(0);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setResultados([]);
      return undefined;
    }
    // Se espera a que deje de teclear: sin esto son cinco búsquedas por palabra.
    const reloj = setTimeout(async () => {
      const mio = ++peticion.current;
      setBuscando(true);
      try {
        const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=8`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        // Solo si es la ÚLTIMA búsqueda lanzada: una respuesta lenta de hace
        // dos letras no debe pisar la de ahora.
        if (mio === peticion.current) setResultados(j?.data?.clients ?? j?.data ?? []);
      } finally {
        if (mio === peticion.current) setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(reloj);
  }, [texto]);

  async function asignar(cliente) {
    setGuardando(cliente.id);
    setError(null);
    try {
      const r = await fetch("/api/whatsapp/sin-asignar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, clientId: cliente.id }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "No se ha podido asignar");
      onAsignado(phone);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
        ¿De quién es esta conversación?
      </label>
      <input
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar por nombre, email o teléfono…"
        className="w-full mt-1.5 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 focus:outline-none focus:border-gray-400 placeholder-gray-300"
      />

      {buscando && <p className="text-[11px] text-gray-400 mt-2">Buscando…</p>}

      {!buscando && texto.trim().length >= 2 && resultados.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-2">
          Ninguna ficha coincide. Si es alguien nuevo, dale de alta primero en Clientes y vuelve aquí.
        </p>
      )}

      {resultados.length > 0 && (
        <ul className="mt-2 border border-gray-200 rounded-lg overflow-hidden bg-white divide-y divide-gray-100">
          {resultados.map((cli) => (
            <li key={cli.id} className="px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-800 truncate">{cli.name}</div>
                <div className="text-[11px] text-gray-400 truncate">
                  {[cli.email, cli.phone].filter(Boolean).join(" · ") || "sin datos de contacto"}
                </div>
              </div>
              <button
                onClick={() => asignar(cli)}
                disabled={guardando === cli.id}
                className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50"
              >
                {guardando === cli.id ? "Asignando…" : "Es esta"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}
