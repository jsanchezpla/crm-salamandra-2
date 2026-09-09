"use client";

/**
 * /facturacion/cuotas/tipos — LOS TIPOS DE CUOTA, con sus pacientes detrás
 * (09/09/2026, petición de Aumenta: «diferentes tipos de cuotas… dentro de cada
 * cuota, pacientes asignados, ficha y los meses del curso»).
 *
 * La pantalla de Cuotas mira las ASIGNACIONES: 278 filas seguidas, una por
 * familia. Esta mira el CATÁLOGO: una fila por cuota de la casa —también la
 * entrevista inicial, los bonos y los informes— diciendo cuánta gente la lleva
 * y cuánto suma al mes. Es la pregunta que hace el centro cuando repasa el
 * curso: «¿quién está en Logopedia 60x2?».
 *
 * Las cuentas viven en `lib/billing/tiposDeCuota.js`, con su prueba: aquí no se
 * suma nada.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { fmtMoney } from "../../_components/Kpi.jsx";
import { coincidePorNombre } from "@/lib/utils/busqueda.js";

export default function TiposDeCuotaPage() {
  const [tipos, setTipos] = useState([]);
  const [sinTipo, setSinTipo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [busca, setBusca] = useState("");
  // Aumenta tiene 46 conceptos y la mitad no los paga nadie (sesiones sueltas,
  // diagnósticos, la reserva de plaza). Enseñarlos todos de primeras entierra
  // las veinte que sí son cuotas de alguien.
  const [verVacios, setVerVacios] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/billing/cuotas/tipos", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los tipos de cuota");
      setTipos(j.data?.tipos ?? []);
      setSinTipo(j.data?.sinTipo ?? null);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const lista = tipos.filter(
      (t) => (verVacios || t.cuotas > 0 || t.bajas > 0) && coincidePorNombre(busca, [t.name, t.description, t.category])
    );
    // Primero las que más gente lleva: es el orden en que se repasan.
    return lista.sort((a, b) => b.cuotas - a.cuotas || a.name.localeCompare(b.name, "es"));
  }, [tipos, busca, verVacios]);

  const conGente = tipos.filter((t) => t.cuotas > 0).length;
  const alMes = visibles.reduce((s, t) => s + Number(t.alMes || 0), 0);

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Operativa · Cuotas</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Tipos de cuota
            <HelpTooltip title="Tipos de cuota" placement="bottom">
              Cada cuota de la casa con la gente que la paga detrás: entra en una y podrás{" "}
              <strong className="text-white">añadir o quitar pacientes</strong>, ver su ficha de
              facturación (precio y texto de la factura) y repasar{" "}
              <strong className="text-white">mes a mes el curso</strong>, de septiembre a junio.
              Los tipos salen del catálogo de Configuración: ahí se crean y se les pone precio.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {conGente} {conGente === 1 ? "tipo con pacientes" : "tipos con pacientes"} de {tipos.length}
            {alMes > 0 && <> · <span className="tabular">{fmtMoney(alMes)}</span> al mes</>}
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <Link href="/facturacion/cuotas" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Todas las cuotas
          </Link>
          <Link
            href="/facturacion/configuracion"
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Catálogo
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar un tipo de cuota…"
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={verVacios}
            onChange={(e) => setVerVacios(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
          />
          Ver también los que no tiene nadie
        </label>
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[840px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3 font-medium">Tipo de cuota</th>
                <th className="px-4 py-3 font-medium">Texto en la factura</th>
                <th className="px-4 py-3 font-medium text-right">Precio</th>
                <th className="px-4 py-3 font-medium text-right">Pacientes</th>
                <th className="px-4 py-3 font-medium text-right">Cuotas</th>
                <th className="px-4 py-3 font-medium text-right">Al mes</th>
              </tr>
            </thead>
            <tbody>
              {cargando && tipos.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-xs text-neutral-400">Cargando…</td></tr>
              )}
              {!cargando && visibles.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-xs text-neutral-400">
                  {busca.trim() ? "Ningún tipo de cuota se llama así." : "Todavía no hay ningún tipo de cuota con pacientes."}
                </td></tr>
              )}
              {visibles.map((t) => (
                <tr key={t.id} className="border-b border-neutral-50 hover:bg-neutral-50/60 transition">
                  <td className="px-4 py-3">
                    <Link href={`/facturacion/cuotas/tipos/${t.id}`} className="text-neutral-800 font-medium hover:underline">
                      {t.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {t.category && <span className="text-[10.5px] text-neutral-400">{t.category}</span>}
                      {!t.active && t.enElCatalogo && (
                        <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">apagado en el catálogo</span>
                      )}
                      {!t.enElCatalogo && (
                        <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">borrado del catálogo</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{t.description || <span className="text-neutral-300">el nombre de arriba</span>}</td>
                  <td className="px-4 py-3 text-right tabular text-neutral-600">
                    {t.unitPrice === null ? "—" : fmtMoney(t.unitPrice)}
                  </td>
                  {/* Cuántos NIÑOS la llevan. Una cuota a nombre de la familia
                      cubre a los pacientes de esa familia; cuando la familia no
                      tiene ninguno dado de alta, lo que hay que decir es cuántas
                      familias son, no un cero (09/09/2026). */}
                  <td className="px-4 py-3 text-right tabular text-neutral-800">
                    {t.pacientes > 0 ? t.pacientes : t.familias > 0 ? `${t.familias} fam.` : "—"}
                    {t.pacientes > 0 && t.cuotasSinPaciente > 0 && (
                      <div className="text-[10.5px] text-neutral-400 font-normal">
                        y {t.cuotasSinPaciente} sin paciente
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-neutral-600">
                    {t.cuotas}
                    {t.bajas > 0 && <span className="text-neutral-400"> · {t.bajas} de baja</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-neutral-800">
                    {fmtMoney(t.alMes)}
                    {t.compartidas > 0 && (
                      <div className="text-[10.5px] text-neutral-400 font-normal">
                        y {t.compartidas} dentro de otra cuota
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sinTipo?.cuotas > 0 && (
        <p className="text-[11.5px] text-neutral-400 mt-3">
          Hay {sinTipo.cuotas} {sinTipo.cuotas === 1 ? "cuota" : "cuotas"} con un importe suelto y sin
          ningún tipo detrás: no salen aquí porque no son de ninguno.{" "}
          <Link href="/facturacion/cuotas" className="underline hover:text-neutral-700">Verlas en Cuotas</Link>.
        </p>
      )}
      <p className="text-[11.5px] text-neutral-400 mt-1">
        «Al mes» suma solo las cuotas que llevan ese tipo y nada más. Una cuota con dos terapias
        no es de ninguno de los dos por separado, así que se cuenta aparte.
      </p>
    </div>
  );
}
