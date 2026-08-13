"use client";

/**
 * CorregirFichajeModal — arreglar un tramo, con el original a la vista.
 *
 * El motivo es OBLIGATORIO, y esa es la única regla que importa aquí. Sin él,
 * corregir un fichaje y falsearlo se parecen demasiado: dentro de seis meses,
 * cuando alguien discuta su nómina, la pantalla tiene que poder decir «el Excel
 * decía 8h, Fulana lo dejó en 7h el día 3 porque el reloj no registró la
 * salida». Con el número solo, no se puede.
 *
 * Lo que decía el fichero se enseña arriba y NO se puede tocar: se guarda en
 * `minutosOriginal` y no lo pisa nadie.
 */

import { useState } from "react";

import { formatearMinutos } from "@/lib/fichaje/parseHora.js";

function aMinutos(txt) {
  const s = String(txt || "").trim();
  const reloj = /^(\d{1,2})[:h](\d{1,2})$/i.exec(s);
  if (reloj) return Number(reloj[1]) * 60 + Number(reloj[2]);
  const dec = /^(\d{1,2})([,.](\d+))?$/.exec(s);
  if (dec) return Math.round(Number(s.replace(",", ".")) * 60);
  return null;
}

export default function CorregirFichajeModal({ fichaje, onClose, onHecho }) {
  const [horas, setHoras] = useState(() => {
    const m = Number(fichaje.minutos) || 0;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  });
  const [entrada, setEntrada] = useState(fichaje.entradaAt ? String(fichaje.entradaAt).slice(0, 5) : "");
  const [salida, setSalida] = useState(fichaje.salidaAt ? String(fichaje.salidaAt).slice(0, 5) : "");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  const minutos = aMinutos(horas);
  const original = fichaje.minutosOriginal ?? fichaje.minutos;

  async function guardar(borrar = false) {
    if (!nota.trim()) return setError("Escribe el motivo: es lo que hace que esto sea una corrección y no un número cambiado.");
    if (!borrar && (minutos === null || minutos < 0 || minutos > 1440)) {
      return setError("Las horas no se entienden. Escribe «7:30» o «7,5».");
    }
    setOcupado(true);
    setError(null);
    try {
      const url = borrar
        ? `/api/fichaje/${fichaje.id}?nota=${encodeURIComponent(nota.trim())}`
        : `/api/fichaje/${fichaje.id}`;
      const r = await fetch(url, {
        method: borrar ? "DELETE" : "PATCH",
        headers: borrar ? undefined : { "Content-Type": "application/json" },
        body: borrar
          ? undefined
          : JSON.stringify({
              minutos,
              entradaAt: entrada || null,
              salidaAt: salida || null,
              nota: nota.trim(),
            }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setError(j?.error || `HTTP ${r.status}`);
        setOcupado(false);
        return;
      }
      onHecho?.();
    } catch (e) {
      setError(e.message || "Error de red");
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={ocupado ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md">
        <header className="px-6 py-4 border-b border-gray-100">
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Corregir jornada</div>
          <h2 className="text-lg font-semibold text-gray-900">{fichaje.nombre}</h2>
          <p className="text-sm text-gray-500">{fichaje.fecha}</p>
        </header>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {fichaje.origen === "import" ? "Vino del Excel" : fichaje.origen === "manual" ? "Añadido a mano" : "Ya corregido"}
            {" · "}el fichero decía <strong>{formatearMinutos(original)}</strong>
            {fichaje.hojaExcel && <span className="text-gray-400"> (hoja {fichaje.hojaExcel}, fila {fichaje.filaExcel})</span>}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">Entrada</span>
              <input type="time" value={entrada} onChange={(e) => setEntrada(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-200" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">Salida</span>
              <input type="time" value={salida} onChange={(e) => setSalida(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-200" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">Horas</span>
              <input type="text" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="7:30"
                className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-200" />
            </label>
          </div>
          <p className="text-xs text-gray-400 -mt-2">
            Las horas mandan sobre entrada y salida: si cambias solo la entrada, ajusta también el total.
          </p>

          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1">
              Motivo <span className="text-red-500">*</span>
            </span>
            <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder="El reloj no registró la salida; me lo confirmó ella por WhatsApp."
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 resize-none" />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          <button type="button" onClick={() => guardar(true)} disabled={ocupado}
            className="px-3 py-2 text-sm rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50">
            Dar de baja
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={ocupado}
              className="px-4 py-2 text-sm rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={() => guardar(false)} disabled={ocupado}
              className="px-4 py-2 text-sm rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50">
              {ocupado ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
