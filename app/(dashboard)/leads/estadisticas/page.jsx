"use client";

/**
 * Estadísticas de Leads (01/08/2026) — la pantalla PADRE del grupo.
 *
 * Leads tiene dos orígenes y hasta hoy no había ningún sitio donde verlos
 * juntos: el embudo por un lado, la bandeja de la web por otro, y nadie
 * respondiendo «¿de dónde nos está entrando la gente?».
 *
 * Quien no tenga Leads Comerciales no ve ese bloque en absoluto. Un cero grande
 * en pantalla se lee como una avería, no como «esto no lo tienes».
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";

function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const hoyISO = () => fechaISO(new Date());
function haceMeses(n) {
  const h = new Date();
  return fechaISO(new Date(h.getFullYear(), h.getMonth() - n, 1));
}

function Kpi({ label, value, sub, tono = "neutral" }) {
  const color =
    tono === "bien" ? "text-emerald-700" : tono === "ojo" ? "text-amber-700" : tono === "mal" ? "text-red-700" : "text-[var(--ink-900)]";
  return (
    <div className="bg-white border border-neutral-100 rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
      <div className={`text-2xl font-display mt-0.5 tabular ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Barras horizontales sin librería: son cuatro filas, no hace falta un motor. */
function Barras({ datos, etiqueta, valor, vacio }) {
  if (!datos?.length) return <p className="text-xs text-neutral-400">{vacio}</p>;
  const max = Math.max(1, ...datos.map((d) => valor(d)));
  return (
    <div className="space-y-1.5">
      {datos.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-[11px] text-neutral-600 w-40 shrink-0 truncate">{etiqueta(d)}</span>
          <span className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.round((valor(d) / max) * 100)}%`, background: "var(--color-primary, #1B3A2D)" }}
            />
          </span>
          <span className="text-[11px] text-neutral-700 tabular w-10 text-right">{valor(d)}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ titulo, children, nota, accion }) {
  return (
    <section className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="px-4 lg:px-5 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
        <h2 className="eyebrow">{titulo}</h2>
        {accion}
      </div>
      <div className="px-4 lg:px-5 py-4 space-y-4">{children}</div>
      {nota && <p className="px-4 lg:px-5 py-2 text-[10px] text-neutral-400 border-t border-neutral-50">{nota}</p>}
    </section>
  );
}

/** Entrada por mes: dos series apiladas en columnas, sin librería. */
function PorMes({ meses, hayComerciales }) {
  const max = Math.max(1, ...meses.map((m) => m.profesionales + m.comerciales));
  return (
    <div>
      <div className="flex items-end gap-1.5 h-32">
        {meses.map((m) => {
          const total = m.profesionales + m.comerciales;
          return (
            <div key={m.clave} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${m.etiqueta}: ${total}`}>
              <span className="text-[10px] text-neutral-400 tabular">{total || ""}</span>
              <span className="w-full flex flex-col justify-end" style={{ height: `${Math.round((total / max) * 100)}%` }}>
                {hayComerciales && m.comerciales > 0 && (
                  <span
                    className="block w-full rounded-t"
                    style={{ height: `${Math.round((m.comerciales / Math.max(1, total)) * 100)}%`, background: "var(--color-primary, #1B3A2D)", opacity: 0.45 }}
                  />
                )}
                <span
                  className="block w-full"
                  style={{ height: `${Math.round((m.profesionales / Math.max(1, total)) * 100)}%`, background: "var(--color-primary, #1B3A2D)" }}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {meses.map((m) => (
          <span key={m.clave} className="flex-1 text-[9px] text-neutral-400 text-center truncate">{m.etiqueta}</span>
        ))}
      </div>
      {hayComerciales && (
        <div className="flex items-center gap-4 mt-3 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--color-primary, #1B3A2D)" }} /> Profesionales
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--color-primary, #1B3A2D)", opacity: 0.45 }} /> Comerciales
          </span>
        </div>
      )}
    </div>
  );
}

export default function LeadsEstadisticasPage() {
  const [rango, setRango] = useState({ desde: haceMeses(11), hasta: hoyISO() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const qs = useMemo(() => `desde=${rango.desde}&hasta=${rango.hasta}`, [rango]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/leads/estadisticas?${qs}`, { cache: "no-store" })
      .then(async (r) => ({ r, j: await r.json().catch(() => ({})) }))
      .then(({ r, j }) => {
        if (r.status === 403) throw new Error("Este cliente no tiene el módulo de Leads activo");
        if (!j.ok) throw new Error(j.error || "No se pudieron cargar las estadísticas");
        setData(j.data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [qs]);

  useEffect(() => load(), [load]);

  const p = data?.profesionales;
  const c = data?.comerciales;
  const entrada = (p?.total ?? 0) + (c?.total ?? 0);

  const inputCls =
    "text-xs px-2.5 py-2 rounded-lg border border-neutral-200 focus:border-neutral-400 outline-none";

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Captación</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">
            Estadísticas de Leads
            {/* Solo hay ayuda si hay DOS puertas: sin Leads Comerciales no hay
                nada que distinguir y el globo sobraría. */}
            {c && (
              <HelpTooltip title="Qué cuenta cada cifra" className="ml-2">
                Entradas y el gráfico por mes suman las dos puertas. Las otras tres cifras de
                arriba, el embudo y De dónde vienen son{" "}
                <strong className="text-white">solo de Leads Profesionales</strong>. Aceptar un
                Lead Comercial también crea ficha, pero suma en su bloque de abajo, no aquí.
              </HelpTooltip>
            )}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Cuánta gente entra, por qué puerta y en qué acaba.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setRango({ desde: haceMeses(11), hasta: hoyISO() })}
            className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400">
            Últimos 12 meses
          </button>
          <button onClick={() => setRango({ desde: `${new Date().getFullYear()}-01-01`, hasta: hoyISO() })}
            className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400">
            Este año
          </button>
          <input type="date" value={rango.desde} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} className={inputCls} />
          <input type="date" value={rango.hasta} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} className={inputCls} />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-xs rounded-xl px-4 py-3">{error}</div>
      )}
      {loading && !data && <p className="text-xs text-neutral-400">Contando…</p>}

      {data && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Entradas" value={entrada} sub={c ? `${p.total} profesionales · ${c.total} comerciales` : "leads profesionales"} />
            <Kpi label="En marcha" value={p.abiertos} sub="ni ganados ni descartados" />
            {/* Solo donde el embudo pueda dar a alguien por ganado. Hay
                embudos que terminan en Nuevo, Contactado y Descartado: ahí este
                0 no puede subir nunca y la conversión sería un 0 % en cuanto se
                descarte a alguien. Serían números ciertos y engañarían igual,
                porque no es que no conviertan — es que no tienen dónde
                apuntarlo. Mismo criterio que «Con ficha» de aquí abajo, y lo
                decide el servidor en `lib/leads/embudos.js`. Un 0 de verdad
                (embudo con etapa ganadora, nadie convertido todavía) SÍ se
                sigue viendo: por eso «distinto de null» y no «si es falso». */}
            {p.ganados != null && (
              <Kpi label="Convertidos" value={p.ganados} sub={p.conversion != null ? `${p.conversion}% de los cerrados` : "aún no hay cerrados"}
                tono={p.conversion != null && p.conversion >= 50 ? "bien" : "neutral"} />
            )}
            {/* Solo donde hay fichas que crear. Sin el módulo Clientes un lead
                no puede convertirse en cliente, así que la cifra sería un 0
                clavado para siempre, y un cero grande se lee como una avería,
                no como «esto no lo tienes» — el mismo criterio que ya se sigue
                con el bloque de Leads Comerciales. Un 0 de verdad (con
                Clientes, sin haber convertido a nadie todavía) SÍ se sigue
                viendo: por eso «distinto de null» y no «si es falso». */}
            {p.conFicha != null && (
              <Kpi label="Con ficha creada" value={p.conFicha} sub="leads que ya son cliente" />
            )}
          </div>

          <Panel titulo="Entrada por mes" nota="Cada columna es el mes en que entró el lead, no en el que se cerró.">
            <PorMes meses={data.meses} hayComerciales={!!c} />
          </Panel>

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel
              titulo="Embudo · Leads Profesionales"
              accion={<Link href="/leads" className="text-[11px] text-neutral-500 hover:text-neutral-800">Ver la lista →</Link>}
              nota="La conversión se calcula sobre los cerrados: los que siguen en marcha no cuentan como fracaso."
            >
              <Barras datos={p.etapas} etiqueta={(d) => d.etiqueta} valor={(d) => d.n} vacio="Ningún lead en este periodo." />
            </Panel>

            <Panel titulo="De dónde vienen" nota="Los ocho orígenes con más entradas.">
              <Barras datos={p.origenes} etiqueta={(d) => d.origen} valor={(d) => d.n} vacio="Sin datos de origen." />
            </Panel>
          </div>

          {c && (
            <Panel
              titulo="Bandeja · Leads Comerciales"
              accion={<Link href="/formularios" className="text-[11px] text-neutral-500 hover:text-neutral-800">Ver la bandeja →</Link>}
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Recibidas" value={c.total} />
                <Kpi label="Pendientes" value={c.pendientes} tono={c.pendientes > 0 ? "ojo" : "neutral"}
                  sub={c.esperaMaxima != null ? `la más antigua, ${c.esperaMaxima} día${c.esperaMaxima === 1 ? "" : "s"}` : null} />
                <Kpi label="Aceptadas" value={c.aceptadas} sub={c.aceptacion != null ? `${c.aceptacion}% de las resueltas` : null} />
                <Kpi label="Descartadas" value={c.rechazadas} />
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
