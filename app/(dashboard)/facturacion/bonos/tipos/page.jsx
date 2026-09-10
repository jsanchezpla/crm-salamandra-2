"use client";

/**
 * /facturacion/bonos/tipos — LOS GRUPOS: cada tipo de bono con la gente que lo
 * lleva detrás (10/09/2026, Rodrigo: «que se puedan ordenar por grupos igual
 * que cuotas»).
 *
 * La pantalla de Bonos mira los BONOS: una fila por bono dado, ordenados por
 * fecha. Esta mira el CATÁLOGO: una fila por bono que vende la casa, diciendo
 * cuánta gente lo tiene abierto, cuántas sesiones quedan por dar y cuánto falta
 * por cobrar. Es la pregunta del centro cuando repasa el curso: «¿quién está en
 * el bono de habilidades sociales?».
 *
 * El espejo de «Tipos de cuota», con el catálogo que le toca: allí los tipos son
 * conceptos de facturación y aquí son TIPOS DE CITA, porque un bono no es una
 * línea de precio: es el derecho a N sesiones de una terapia, y eso lo define la
 * agenda.
 *
 * Las cuentas viven en `lib/billing/bonos.js`, con su prueba: aquí no se suma
 * nada.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { formatMoney } from "@/lib/payments/money.js";
import { coincidePorNombre } from "@/lib/utils/busqueda.js";

export default function TiposDeBonoPage() {
  const [tipos, setTipos] = useState([]);
  const [totales, setTotales] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [busca, setBusca] = useState("");
  // Un centro puede tener veinte tipos de cita y vender bonos de tres. Sacarlos
  // todos de primeras entierra los que sí son bonos de alguien.
  const [verVacios, setVerVacios] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/billing/bonos/tipos", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los tipos de bono");
      setTipos(j.data?.tipos ?? []);
      setTotales(j.data?.totales ?? null);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const lista = tipos.filter(
      (t) => (verVacios || t.bonos > 0 || t.cerrados > 0) && coincidePorNombre(busca, [t.name])
    );
    // Primero los que más gente lleva abierta: es el orden en que se repasan.
    return lista.sort((a, b) => b.bonos - a.bonos || a.name.localeCompare(b.name, "es"));
  }, [tipos, busca, verVacios]);

  const conGente = tipos.filter((t) => t.bonos > 0).length;

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Operativa · Bonos</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Tipos de bono
            <HelpTooltip title="Tipos de bono" placement="bottom">
              Cada bono que vende la casa con la gente que lo tiene abierto detrás: entra en uno y verás{" "}
              <strong className="text-white">quién lo lleva</strong>, cuántas sesiones le quedan a cada
              uno y qué falta por cobrar. Desde ahí se{" "}
              <strong className="text-white">añaden pacientes al grupo</strong> de una tacada. Los tipos
              salen de los tipos de cita: ahí se decide cuántas sesiones incluye cada bono y a qué precio.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {conGente} {conGente === 1 ? "tipo con bonos abiertos" : "tipos con bonos abiertos"} de {tipos.length}
            {totales?.sesionesLibres > 0 && <> · <span className="tabular">{totales.sesionesLibres}</span> {totales.sesionesLibres === 1 ? "sesión" : "sesiones"} por dar</>}
            {totales?.pendiente > 0 && <> · <span className="text-amber-700 tabular">{formatMoney(totales.pendiente)}</span> sin cobrar</>}
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <Link href="/facturacion/bonos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Todos los bonos
          </Link>
          <Link
            href="/citas/tipos"
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition"
          >Tipos de cita</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar un tipo de bono..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={verVacios}
            onChange={(e) => setVerVacios(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
          />
          Ver también los que no lleva nadie
        </label>
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3 font-medium">Tipo de bono</th>
                <th className="px-4 py-3 font-medium text-right">Sesiones</th>
                <th className="px-4 py-3 font-medium text-right">Precio</th>
                <th className="px-4 py-3 font-medium text-right">Abiertos</th>
                <th className="px-4 py-3 font-medium">Quién lo lleva</th>
                <th className="px-4 py-3 font-medium text-right">Por dar</th>
                <th className="px-4 py-3 font-medium text-right">Sin cobrar</th>
                <th className="px-4 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {cargando && tipos.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!cargando && visibles.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">
                  {tipos.length
                    ? "Ningún tipo de bono con gente detrás. Marca la casilla para ver también los vacíos."
                    : "Este centro todavía no vende bonos. Un bono es un tipo de cita con más de una sesión: se configura en Citas → Tipos de cita."}
                </td></tr>
              )}
              {visibles.map((t) => (
                <tr key={t.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/facturacion/bonos/tipos/${t.id}`} className="text-neutral-800 hover:underline">
                      {t.name}
                    </Link>
                    <span className="block text-[11px] text-neutral-400">
                      {!t.enElCatalogo
                        ? "ya no está en el catálogo"
                        : [t.oculto ? "oculto en la agenda" : null, !t.activo ? "apagado" : null]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-right tabular text-neutral-600">
                    {t.sesionesDelTipo ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-right tabular text-neutral-600">
                    {t.precio ? formatMoney(t.precio) : <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right tabular text-neutral-700">
                    {t.bonos}
                    {t.cerrados > 0 && <span className="text-neutral-400"> · {t.cerrados} cerrados</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600">
                    {t.bonos === 0 ? (
                      <span className="text-neutral-300">nadie</span>
                    ) : (
                      <>
                        {t.pacientes > 0 && <>{t.pacientes} {t.pacientes === 1 ? "paciente" : "pacientes"}</>}
                        {t.pacientes > 0 && t.sinPaciente > 0 && " · "}
                        {t.sinPaciente > 0 && (
                          <span title="Bonos a nombre de la familia: se los gasta el primero que pida cita">
                            {t.sinPaciente} de familia
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-right tabular text-neutral-600">
                    {t.sesionesLibres || <span className="text-neutral-300">0</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right tabular">
                    {t.pendiente > 0 ? (
                      <span className="text-amber-700">{formatMoney(t.pendiente)}</span>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/facturacion/bonos/tipos/${t.id}`} className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900">
                      Ver el grupo →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-neutral-400">
        «Sin cobrar» es lo que falta por entrar de los bonos ABIERTOS, leído de su cobro en Cobros. Lo
        vendido de un bono ya agotado no se cuenta aquí: se cobró en su día o se quedó sin cobrar, y eso
        se ve entrando en el grupo.
      </p>
    </div>
  );
}
