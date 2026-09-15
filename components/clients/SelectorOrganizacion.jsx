"use client";

/**
 * SelectorOrganizacion — elegir la universidad o la empresa de una ficha, o
 * crear una nueva sin salir de ella (15/09/2026, Rodrigo; AV-0153).
 *
 * Las opciones son FICHAS con ese tipo (`clients.tipo_ficha`), no una lista de
 * nombres: la universidad es quien paga y su ficha es la que se factura.
 * «+ Crear … nueva» da de alta la ficha ya marcada con su tipo y la deja
 * elegida, que es para lo que se estaba creando.
 *
 * @param tipo       'universidad' | 'empresa'
 * @param value      id de la ficha elegida, o ""
 * @param onChange   (id|null, nombre|null) => void
 * @param excluirId  la propia ficha, que no puede elegirse a sí misma
 */

import { useCallback, useEffect, useState } from "react";

const TEXTOS = {
  universidad: { ninguna: "Sin universidad", nueva: "+ Crear una universidad nueva", placeholder: "Nombre de la universidad", la: "la universidad" },
  empresa: { ninguna: "Sin empresa", nueva: "+ Crear una empresa nueva", placeholder: "Nombre de la empresa", la: "la empresa" },
};

export default function SelectorOrganizacion({ tipo, value, onChange, excluirId = null, disabled = false, etiqueta = null }) {
  const t = TEXTOS[tipo] ?? TEXTOS.empresa;
  const [opciones, setOpciones] = useState([]);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/clients?tipo=${tipo}&limit=200&orden=nombre&dir=asc`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      setOpciones((j?.data?.clients ?? []).filter((c) => String(c.id) !== String(excluirId)));
    } catch {
      setOpciones([]);
    }
  }, [tipo, excluirId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear() {
    const n = nombre.trim();
    if (!n) return;
    // Ya existía con otras mayúsculas: se elige esa y no se duplica la ficha.
    const yaEsta = opciones.find((o) => o.name.toLocaleLowerCase("es") === n.toLocaleLowerCase("es"));
    if (yaEsta) {
      onChange(String(yaEsta.id), yaEsta.name);
      setCreando(false);
      setNombre("");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, tipoFicha: tipo, type: "company" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.data?.id) throw new Error(j?.error || `No se ha podido crear ${t.la}`);
      setOpciones((prev) => [...prev, j.data].sort((a, b) => a.name.localeCompare(b.name, "es")));
      setCreando(false);
      setNombre("");
      onChange(String(j.data.id), j.data.name);
    } catch (e) {
      setError(e.message);
    }
    setGuardando(false);
  }

  const elegida = opciones.find((o) => String(o.id) === String(value));

  return (
    <div>
      {etiqueta && <label className="block text-[11px] font-medium text-gray-500 mb-1">{etiqueta}</label>}
      <select
        value={value || ""}
        disabled={disabled || guardando}
        onChange={(e) => {
          const id = e.target.value || null;
          const o = opciones.find((x) => String(x.id) === id);
          onChange(id, o?.name ?? null);
        }}
        className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-sm bg-white"
      >
        <option value="">{t.ninguna}</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
        {/* La que tenía y ya no está marcada con ese tipo: se enseña para que
            no parezca que se ha perdido, y se puede quitar. */}
        {value && !elegida && <option value={value}>(ficha que ya no es {tipo})</option>}
      </select>
      {!creando ? (
        <button
          type="button"
          onClick={() => setCreando(true)}
          disabled={disabled}
          className="text-[11px] text-[var(--color-primary)] hover:underline mt-1.5 disabled:opacity-40"
        >
          {t.nueva}
        </button>
      ) : (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); crear(); }
              if (e.key === "Escape") { setCreando(false); setNombre(""); }
            }}
            placeholder={t.placeholder}
            maxLength={200}
            className="flex-1 min-w-0 border border-gray-200 rounded-md px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={crear}
            disabled={guardando || !nombre.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-40 shrink-0"
          >
            Crear
          </button>
          <button
            type="button"
            onClick={() => { setCreando(false); setNombre(""); }}
            className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-800 shrink-0"
          >
            Cancelar
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}
