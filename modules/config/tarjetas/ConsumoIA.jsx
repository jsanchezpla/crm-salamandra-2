"use client";

import { useEffect, useState } from "react";

/**
 * Consumo estimado de la IA, dentro de la tarjeta de Anthropic de
 * Configuración → IA (11/09/2026).
 *
 * Nace del día en que Aumenta se quedó sin saldo sin que nadie viera venirlo:
 * quien teclea no es quien paga, y quien paga no tenía dónde mirar. Aquí se
 * ve cuánto lleva el mes, en qué se va y cuántas llamadas se han ahorrado por
 * repetidas. Es una estimación con precios públicos; la cifra oficial está en
 * la consola del proveedor, y se dice.
 */

const USD_POR_EUR = 1.1;
const ETIQUETA_MODELO = {
  "claude-haiku-4-5-20251001": "Haiku",
  "claude-sonnet-5": "Sonnet",
  "claude-opus-4-8": "Opus",
};

function usd(n) {
  return `${(Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}
function eur(n) {
  return `≈ ${((Number(n) || 0) / USD_POR_EUR).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function fecha(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

export default function ConsumoIA() {
  const [datos, setDatos] = useState(null);
  const [fallo, setFallo] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/tenant/ia/consumo")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se pudo leer el consumo");
        if (vivo) setDatos(j.data);
      })
      .catch((e) => vivo && setFallo(e.message));
    return () => {
      vivo = false;
    };
  }, []);

  if (fallo) return null;
  if (!datos) return <p className="text-xs text-neutral-400 mt-3">Calculando el consumo…</p>;
  if (datos.sinTabla || !datos.mes) return null;

  const { mes, anterior, desdeCuando, modelo } = datos;
  const top = mes.porAccion.slice(0, 4);
  const reutilizadas = mes.total.reutilizadas;

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Consumo estimado de este mes</div>
          <div className="text-2xl font-semibold text-neutral-900 mt-1">
            {usd(mes.total.costeUsd)} <span className="text-sm font-normal text-neutral-500">{eur(mes.total.costeUsd)}</span>
          </div>
        </div>
        <div className="text-xs text-neutral-500 text-right">
          <div>{mes.total.llamadas.toLocaleString("es-ES")} llamadas · modelo {ETIQUETA_MODELO[modelo] ?? modelo}</div>
          {reutilizadas > 0 && <div>{reutilizadas.toLocaleString("es-ES")} {reutilizadas === 1 ? "devuelta" : "devueltas"} sin coste por repetidas</div>}
          {mes.total.minutosAudio > 0 && <div>{mes.total.minutosAudio.toLocaleString("es-ES")} min de audio transcritos</div>}
        </div>
      </div>

      {top.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-200 text-xs">
          {top.map((a) => (
            <li key={`${a.proveedor}:${a.accion}`} className="flex justify-between gap-3 py-1.5">
              <span className="text-neutral-700 truncate">{a.accion}</span>
              <span className="text-neutral-500 whitespace-nowrap">
                {a.llamadas} · {usd(a.costeUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-neutral-400 leading-relaxed">
        {anterior?.total?.llamadas > 0 && <>Mes anterior: {usd(anterior.total.costeUsd)}. </>}
        Estimación con los precios públicos de Anthropic y OpenAI
        {desdeCuando ? `, contando desde el ${fecha(desdeCuando)}` : ""}. La cifra oficial está en la consola de cada proveedor.
      </p>
    </div>
  );
}
