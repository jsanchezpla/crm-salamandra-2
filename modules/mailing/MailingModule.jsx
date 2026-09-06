"use client";

/**
 * MailingModule — la portada del módulo: las campañas del centro y el
 * contador de cuota (lo que lleva gastado este mes) arriba, para verlo ANTES
 * de darle a enviar.
 *
 * Nació el 06/09/2026 con el sprint 1 del módulo (plan del 23/08/2026).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import Cabecera from "./Cabecera.jsx";
import { api, botonPrimario, botonSecundario, Chip, estiloPrimario, fecha, num } from "./api.js";

function Tarjeta({ titulo, valor, detalle, tono = "" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{titulo}</div>
      <div className={`mt-1 text-2xl font-semibold ${tono || "text-gray-900"}`}>{valor}</div>
      {detalle && <div className="mt-0.5 text-xs text-gray-500">{detalle}</div>}
    </div>
  );
}

export default function MailingModule({ vocab }) {
  const router = useRouter();
  const { confirmar, pedirTexto, dialogo } = useDialogo();
  const [estado, setEstado] = useState(null);
  const [uso, setUso] = useState(null);
  const [campanas, setCampanas] = useState(null);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [e, u, c] = await Promise.all([api("/estado?comprobar=1"), api("/uso"), api("/campanas")]);
      setEstado(e);
      setUso(u);
      setCampanas(c.campanas);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const nueva = async () => {
    const nombre = await pedirTexto({ titulo: "Nueva campaña", texto: "Un nombre para reconocerla en la lista (no lo ve nadie más).", etiqueta: "Nombre" });
    if (!nombre?.trim()) return;
    setCreando(true);
    try {
      const r = await api("/campanas", { metodo: "POST", body: { nombre: nombre.trim() } });
      router.push(`/mailing/${r.campana.id}`);
    } catch (err) {
      setError(err.message);
      setCreando(false);
    }
  };

  const duplicar = async (c) => {
    try {
      const r = await api(`/campanas/${c.id}/duplicar`, { metodo: "POST" });
      router.push(`/mailing/${r.campana.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const borrar = async (c) => {
    const ok = await confirmar({
      titulo: `¿Borrar «${c.nombre}»?`,
      texto: c.enviados ? `Ya salió a ${num(c.enviados)} personas: se pierden sus métricas. La lista de bajas no se toca.` : "Se borra el borrador entero.",
      tono: "peligro",
    });
    if (!ok) return;
    try {
      await api(`/campanas/${c.id}`, { metodo: "DELETE" });
      setCampanas((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      setError(err.message);
    }
  };

  const cuenta = uso?.cuenta;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Cabecera
        subtitulo={`Campañas y novedades para ${vocab?.plural?.toLowerCase() ?? "clientes"} y suscriptores que han dicho que sí.`}
        estado={estado}
        derecha={
          <button type="button" onClick={nueva} disabled={creando} className={botonPrimario} style={estiloPrimario}>
            + Nueva campaña
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error} <button className="underline ml-2" onClick={() => { setError(null); cargar(); }}>Reintentar</button>
        </div>
      )}

      {uso && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <Tarjeta titulo="Este mes" valor={num(uso.mes.enviados)} detalle={`correos · ${uso.mes.costeUsd.toFixed(2)} $ (0,10 $ por mil)`} />
          <Tarjeta titulo="Enviados en total" valor={num(uso.total.enviados)} detalle={`${num(uso.total.rebotes)} rebotes · ${num(uso.total.quejas)} quejas`} />
          <Tarjeta
            titulo="Tasa de quejas"
            valor={`${uso.total.tasaQuejas} %`}
            detalle="AWS revisa al 0,1 % y para al 0,5 %"
            tono={uso.total.tasaQuejas >= 0.5 ? "text-red-600" : uso.total.tasaQuejas >= 0.1 ? "text-amber-600" : "text-emerald-700"}
          />
          <Tarjeta
            titulo="Cuenta de AWS"
            valor={cuenta ? (cuenta.ok ? (cuenta.sandbox ? "Pruebas" : "Producción") : "Error") : estado?.ses?.configurado ? "—" : "Sin configurar"}
            detalle={cuenta?.ok ? `${num(cuenta.enviados24h)} de ${num(cuenta.max24h)} en 24 h · ${cuenta.ritmoMax}/s` : cuenta?.error ?? "Configuración → Conexiones"}
            tono={cuenta?.ok ? (cuenta.sandbox ? "text-amber-600" : "text-emerald-700") : ""}
          />
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {campanas === null ? (
          <div className="p-8 text-sm text-gray-500">Cargando…</div>
        ) : campanas.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-gray-700 font-medium">Todavía no hay campañas.</p>
            <p className="text-sm text-gray-500 mt-1">
              Empieza por una: se escribe por bloques, se manda una prueba y se envía a quien esté en la <Link href="/mailing/lista" className="underline">lista</Link>.
            </p>
            <button type="button" onClick={nueva} className={`${botonPrimario} mt-4`} style={estiloPrimario}>+ Nueva campaña</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="px-4 py-3">Campaña</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Audiencia</th>
                  <th className="px-4 py-3 text-right">Enviados</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {campanas.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/mailing/${c.id}`} className="font-medium text-gray-900 hover:underline">{c.nombre}</Link>
                      <div className="text-xs text-gray-500 truncate max-w-[360px]">{c.asunto || <span className="italic">sin asunto</span>}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Chip estado={c.estado} />
                      {c.estado === "programada" && c.programadaPara && <div className="text-[11px] text-gray-500 mt-0.5">{fecha(c.programadaPara)}</div>}
                      {c.ultimoError && <div className="text-[11px] text-red-600 mt-0.5 max-w-[240px] truncate" title={c.ultimoError}>{c.ultimoError}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.audiencia === "segmento" ? c.segmento?.nombre ?? "Segmento" : "Todos los que han dicho que sí"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.totalDestinatarios ? (
                        <span>
                          {num(c.enviados)}<span className="text-gray-400"> / {num(c.totalDestinatarios)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fecha(c.terminadaAt ?? c.empezadaAt ?? c.actualizadoEn)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => duplicar(c)} className="text-xs underline text-gray-500 hover:text-gray-800 mr-3">Duplicar</button>
                      {c.estado !== "enviando" && (
                        <button type="button" onClick={() => borrar(c)} className="text-xs underline text-gray-400 hover:text-red-600">Borrar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 text-xs text-gray-500">
        Cada correo sale con su enlace de baja de un clic y con «ver en el navegador». Las aperturas se enseñan como dato orientativo; la métrica que vale es el clic.
      </p>
      {dialogo}
    </div>
  );
}
