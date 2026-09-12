"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Select from "../ui/Select.jsx";
import BarraDeHoras, { LeyendaDeHoras } from "./BarraDeHoras.jsx";
import { BotonesDeDiagnostico, CHIP_ESTADO, ESTADO_CITA } from "./DiagnosticoFila.jsx";
import { useAccionesDeDiagnostico } from "./useAccionesDeDiagnostico.js";
import { anchoPantalla } from "../layout/anchoPantalla.js";
import { formatoHoras } from "../../lib/clinica/diagnostico.js";
import { ESTADOS_TERMINADOS } from "../../lib/clinica/registroDeDiagnostico.js";
import { SESSION_STATUS_LABEL } from "../../lib/clinica/serialize.js";

/**
 * ExpedienteDiagnostico — la FICHA de un expediente de diagnóstico
 * (12/09/2026, segunda entrega; Rodrigo con Isa, Aumenta).
 *
 * Lo que pidió Rodrigo, literal: «Informe de diagnóstico por paciente:
 * entradas por fecha y título (registros de diagnóstico, con IA como un
 * registro de sesión) que al final se unen con IA en el informe completo».
 * Esta pantalla es ese índice: la cabecera de la fila de la lista y tres
 * bloques debajo.
 *
 *   Registros de diagnóstico   por fecha: fecha · título · quién firma ·
 *                              estado · «Abrir». «Nuevo registro» estrena uno
 *                              suelto (sin cita) con el título que toca.
 *   Citas                      las del expediente: fecha · duración · tramo ·
 *                              estado · terapeuta · «Escribir registro» (si no
 *                              tiene) o «Seguir registro» (si ya lo tiene).
 *   Informe                    «Unir en informe» crea el informe de valoración
 *                              (una sola vez, firmado por el asignado) y salta
 *                              al editor con `?unir=1`, donde la IA junta los
 *                              registros terminados apartado por apartado. Si
 *                              ya existe: su estado y «Abrir el informe».
 *
 * ── NADA DE REGLA AQUÍ ─────────────────────────────────────────────────────
 * Todo lo que se puede hacer viene en la fila de la API
 * (`GET /api/clinica/diagnosticos/[id]`): `acciones` dice qué botones salen,
 * `urls.*` a dónde van (`nuevoRegistro`, `registro` de cada cita, `informe`),
 * `cobroAlSeguir` lo que costará seguir, `registros[]` ya ordenados y
 * titulados. Los botones y sus confirmaciones son los MISMOS de la lista
 * (`BotonesDeDiagnostico` + `useAccionesDeDiagnostico`), no una copia.
 *
 * La lista con `?paciente=` se pide aparte para lo que la ficha necesita y la
 * fila no trae: el equipo del desplegable, si el centro tiene tipo de cita
 * DIAGNÓSTICO (sin él los enlaces a la agenda van apagados) y el cobro de la
 * entrevista que nacería al parar. Sin ese GET la ficha sigue funcionando: el
 * desplegable solo enseñaría «Sin asignar» y los enlaces a la agenda saldrían.
 */

const fmtFechaHora = (d) =>
  d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const euros = (n) => `${Number(n ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`;

const ROTULO_TRAMO = { entrevista: "Entrevista inicial", horas: "Horas" };
const CHIP_SESION = {
  draft: "bg-neutral-100 text-neutral-600",
  ai_pending: "bg-sky-50 text-sky-700",
  registered: "bg-emerald-50 text-emerald-700",
  published: "bg-violet-50 text-violet-700",
};
const CHIP_INFORME = { draft: "bg-neutral-100 text-neutral-600", reviewed: "bg-sky-50 text-sky-700", delivered: "bg-emerald-50 text-emerald-700" };

const btn = "text-[11px] font-medium px-2 py-1 rounded-md transition-colors whitespace-nowrap";
const btnPrimario = `${btn} text-white hover:opacity-90 inline-flex items-center gap-1`;
const btnNeutro = `${btn} border border-neutral-200 text-neutral-600 hover:bg-neutral-50 inline-block`;

function Bloque({ titulo, aparte = null, children }) {
  return (
    <section className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-neutral-100">
        <h2 className="text-sm font-medium text-neutral-800">{titulo}</h2>
        {aparte}
      </div>
      {children}
    </section>
  );
}

function Vacio({ children }) {
  return <p className="px-4 py-8 text-center text-xs text-neutral-400">{children}</p>;
}

export default function ExpedienteDiagnostico({ id }) {
  const router = useRouter();
  const [expediente, setExpediente] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [noExiste, setNoExiste] = useState(false);
  // Lo que la fila no trae: equipo, tipo DIAGNÓSTICO del centro y el cobro de
  // la entrevista al parar (el mismo GET que la lista, acotado al paciente).
  const [aux, setAux] = useState(null);
  const [tieneCitas, setTieneCitas] = useState(true);
  const [creandoInforme, setCreandoInforme] = useState(false);

  const cargar = useCallback(async () => {
    setErrorCarga(null);
    try {
      const r = await fetch(`/api/clinica/diagnosticos/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (r.status === 404) { setNoExiste(true); return; }
      if (!j.ok) throw new Error(j.error || "No se pudo cargar el expediente");
      setExpediente(j.data.expediente);
    } catch (e) {
      setErrorCarga(e.message);
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  const patientId = expediente?.paciente?.id ?? null;
  useEffect(() => {
    if (!patientId) return;
    fetch(`/api/clinica/diagnosticos?estado=todos&paciente=${patientId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setAux(j.data); })
      .catch(() => {});
  }, [patientId]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setTieneCitas((j.data?.enabledModules ?? []).includes("citas")); })
      .catch(() => {});
  }, []);

  const reemplazar = useCallback((fila) => setExpediente(fila), []);
  const acciones = useAccionesDeDiagnostico({ cobroEntrevista: aux?.cobroEntrevista ?? null, reemplazar, recargar: cargar });
  const { confirmar, flash, setErrorMsg } = acciones;
  const errorMsg = errorCarga ?? acciones.errorMsg;

  const equipo = aux?.equipo ?? [];
  const nombreDelEquipo = (tmId) => (tmId ? (equipo.find((m) => m.id === tmId)?.nombre ?? null) : null);

  const motivoSinAgenda = !aux
    ? null
    : !tieneCitas
      ? "No tienes acceso al módulo de Citas: pide a dirección que abra la cita"
      : !aux.tipoDiagnostico
        ? "Este centro no tiene un tipo de cita DIAGNÓSTICO: créalo en Citas → Tipos de cita"
        : null;

  /**
   * «Unir en informe»: crea el informe de valoración (una sola vez) y salta al
   * editor con `?unir=1`, donde está el botón que llama a la IA. Se dice quién
   * firma y cuántos registros terminados entran; la IA no se dispara aquí.
   */
  async function unirEnInforme() {
    const e = expediente;
    const terminados = (e.registros ?? []).filter((r) => ESTADOS_TERMINADOS.includes(r.status)).length;
    const borradores = (e.registros ?? []).length - terminados;
    const firma = e.terapeuta?.nombre ? `Lo firmará ${e.terapeuta.nombre} (el terapeuta asignado; se puede cambiar en el informe).` : "No hay terapeuta asignado: lo firmarás tú (se puede cambiar en el informe).";
    const material =
      terminados > 0
        ? `Nace con ${terminados} ${terminados === 1 ? "registro terminado" : "registros terminados"} como base${borradores > 0 ? ` (${borradores} en borrador no entran hasta que se registren)` : ""}.`
        : `Todavía no hay registros terminados: nacerá vacío y podrás unirlos cuando los registres${borradores > 0 ? ` (hay ${borradores} en borrador)` : ""}.`;
    const ok = await confirmar({
      titulo: `¿Crear el informe de valoración de ${e.paciente?.nombre ?? "este paciente"}?`,
      texto: `${firma}\n\n${material}\n\nDespués, en el informe, «Unir los registros con la IA» junta su texto apartado por apartado y tú aceptas lo que valga. La IA no se dispara ahora.`,
      confirmar: "Crear el informe",
    });
    if (!ok) return;
    setCreandoInforme(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/diagnosticos/${e.id}/informe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo crear el informe");
      if (j.data.expediente) setExpediente(j.data.expediente);
      const informeId = j.data.informe?.id ?? j.data.expediente?.informe?.id;
      if (informeId) {
        router.push(`/clinica/informes/${informeId}?unir=1`);
        return;
      }
      flash(j.data.creado ? "Informe creado" : "El informe ya existía");
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setCreandoInforme(false);
    }
  }

  if (noExiste) {
    return (
      <div className={`${anchoPantalla("listado")} space-y-4`}>
        <Link href="/clinica/diagnosticos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Diagnósticos</Link>
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
          Ese diagnóstico no existe (o los diagnósticos aún no están disponibles en este centro).
        </div>
      </div>
    );
  }

  if (cargando && !expediente) {
    return (
      <div className={`${anchoPantalla("listado")} space-y-4`}>
        <Link href="/clinica/diagnosticos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Diagnósticos</Link>
        <p className="text-xs text-neutral-400">Cargando…</p>
      </div>
    );
  }

  const e = expediente;
  if (!e) {
    return (
      <div className={`${anchoPantalla("listado")} space-y-4`}>
        <Link href="/clinica/diagnosticos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Diagnósticos</Link>
        {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}
      </div>
    );
  }

  const ocupado = acciones.ocupadoId === e.id;
  const registros = e.registros ?? [];
  const citas = e.citas ?? [];
  const dinero = e.dinero ?? {};
  const seguir = e.acciones?.seguir ? e.cobroAlSeguir : null;

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      {/* ── Migas y cabecera ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">
            <Link href="/clinica/diagnosticos" className="hover:text-neutral-700 transition-colors">Clínica · Diagnósticos</Link> · Expediente
          </div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {e.paciente ? (
              <Link href={`/pacientes/${e.paciente.id}`} className="hover:underline">{e.paciente.nombre}</Link>
            ) : (
              <span className="italic text-neutral-400">(sin paciente)</span>
            )}
            <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full align-middle ${CHIP_ESTADO[e.status] ?? "bg-neutral-100 text-neutral-500"}`}>
              {e.rotuloEstado}
            </span>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {e.producto?.nombre} · {formatoHoras(e.horasMax)} h
            {e.horasDesbloqueadasAt ? " (tope subido)" : ""}
            {e.entrevista ? ` · entrevista ${fmtFechaHora(e.entrevista.scheduledAt)}${ESTADO_CITA[e.entrevista.status] ? `, ${ESTADO_CITA[e.entrevista.status]}` : ""}` : ""}
          </p>
        </div>
        <Link href="/clinica/diagnosticos" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors self-start lg:self-auto">
          ← Diagnósticos
        </Link>
      </div>

      {aux?.sinMigrar && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
          Los diagnósticos aún no están disponibles en este centro. Avisa a Salamandra.
        </div>
      )}
      {aux && !aux.sinMigrar && !aux.tipoDiagnostico && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
          Este centro no tiene un tipo de cita <strong>DIAGNÓSTICO</strong>: la entrevista y las horas no se pueden abrir
          desde aquí hasta crearlo en <Link href="/citas/tipos" className="underline">Citas → Tipos de cita</Link>.
        </div>
      )}
      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}
      {acciones.okMsg && <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-700">{acciones.okMsg}</div>}

      {/* ── La cabecera de la fila: terapeuta, barra, dinero, botones ────── */}
      <section className={`bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-4 ${e.abierto ? "" : "text-neutral-400"}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Terapeuta asignado</div>
            <Select
              value={e.therapistId ?? ""}
              onChange={(v) => acciones.cambiarTerapeuta(e, v || null)}
              disabled={ocupado || !e.abierto}
              aria-label="Terapeuta asignado"
              options={[
                { value: "", label: "— Sin asignar —" },
                ...equipo.map((m) => ({ value: m.id, label: m.nombre })),
                // Si el asignado ya no está en el equipo activo, se enseña igual.
                ...(e.therapistId && !equipo.some((m) => m.id === e.therapistId) ? [{ value: e.therapistId, label: e.terapeuta?.nombre ?? "(ya no está)" }] : []),
              ]}
              className="text-xs border border-neutral-200 rounded-lg px-2 py-1 bg-white hover:border-neutral-300 w-full"
            />
            <div className="text-[11px] text-neutral-400 mt-1">Firma por defecto los registros y el informe.</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Horas</div>
            <BarraDeHoras tramos={e.tramos} rotulo={e.rotuloHoras} agotado={e.horas?.agotado && e.abierto} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Dinero</div>
            <div className="text-xs text-neutral-600 space-y-0.5 tabular">
              {dinero.cobrado > 0 && <div>Cobrado {euros(dinero.cobrado)}</div>}
              {e.cobroPendiente && <div className="text-amber-700">{euros(e.cobroPendiente.importe)} sin cobrar</div>}
              {dinero.devuelto > 0 && <div>Devuelto {euros(dinero.devuelto)}</div>}
              {dinero.entrevista ? (
                <div className="text-[11px] text-neutral-400">
                  Entrevista {dinero.entrevista.status === "completed" ? "cobrada" : dinero.entrevista.status === "pending" ? "pendiente" : dinero.entrevista.status} · {euros(dinero.entrevista.importe)}
                </div>
              ) : (
                <div className="text-[11px] text-neutral-400">Entrevista sin cobro apuntado</div>
              )}
              {seguir && seguir.importe !== null && (
                <div className="text-[11px] text-neutral-400">
                  Al seguir: {euros(seguir.importe)}{seguir.descuento > 0 ? ` (descontada la entrevista de ${euros(seguir.descuento)})` : ""}
                </div>
              )}
              {!(dinero.cobrado > 0) && !e.cobroPendiente && !(dinero.devuelto > 0) && !dinero.entrevista && !seguir && (
                <div className="text-neutral-400">Sin dinero todavía</div>
              )}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Notas</div>
            <div className="text-xs text-neutral-600 whitespace-pre-line">{e.notes || <span className="text-neutral-300">—</span>}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-neutral-100">
          <BotonesDeDiagnostico
            expediente={e}
            motivoSinAgenda={motivoSinAgenda}
            ocupado={ocupado}
            conEnlaces={false}
            onParar={acciones.parar}
            onSeguir={acciones.seguir}
            onDesbloquear={acciones.desbloquear}
            onCerrar={acciones.cerrar}
          />
          <span className="ml-auto"><LeyendaDeHoras /></span>
        </div>
      </section>

      {/* ── Registros de diagnóstico ─────────────────────────────────────── */}
      <Bloque
        titulo={`Registros de diagnóstico${registros.length ? ` · ${registros.length}` : ""}`}
        aparte={
          e.urls?.nuevoRegistro ? (
            <Link href={e.urls.nuevoRegistro} className={btnPrimario} style={{ background: "var(--color-primary, #1B3A2D)" }} title={`Se abre como «${e.siguienteTitulo}»; el título se puede cambiar`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              Nuevo registro
            </Link>
          ) : null
        }
      >
        {registros.length === 0 ? (
          <Vacio>
            Todavía no hay registros de diagnóstico. Se escriben desde cada cita («Escribir registro», abajo) o sueltos con «Nuevo registro».
          </Vacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">Título</th>
                  <th className="px-4 py-2.5 font-medium">Firma</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                    <td className="px-4 py-2.5 align-top text-xs text-neutral-600 tabular whitespace-nowrap">{fmtFecha(r.sessionDate)}</td>
                    <td className="px-4 py-2.5 align-top">
                      {r.url ? (
                        <Link href={r.url} className="font-medium text-neutral-800 hover:underline">{r.titulo}</Link>
                      ) : (
                        <span className="font-medium text-neutral-800">{r.titulo}</span>
                      )}
                      {r.esEntrevista && <span className="ml-2 text-[10px] font-medium text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-full">Entrevista</span>}
                    </td>
                    <td className="px-4 py-2.5 align-top text-xs text-neutral-600">{r.terapeuta?.nombre ?? <span className="text-neutral-300">—</span>}</td>
                    <td className="px-4 py-2.5 align-top">
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${CHIP_SESION[r.status] ?? "bg-neutral-100 text-neutral-500"}`}>
                        {SESSION_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 align-top text-right">
                      {r.url && <Link href={r.url} className={btnNeutro}>Abrir</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloque>

      {/* ── Citas ────────────────────────────────────────────────────────── */}
      <Bloque titulo={`Citas${citas.length ? ` · ${citas.length}` : ""}`}>
        {citas.length === 0 ? (
          <Vacio>
            Sin citas todavía. «Abrir entrevista inicial» y «Añadir horas» las crean en la agenda ya atadas a este expediente.
          </Vacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">Duración</th>
                  <th className="px-4 py-2.5 font-medium">Tramo</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium">Terapeuta</th>
                  <th className="px-4 py-2.5 font-medium text-right">Registro</th>
                </tr>
              </thead>
              <tbody>
                {citas.map((c) => {
                  const cancelada = c.status === "cancelled";
                  return (
                    <tr key={c.id} className={`border-b border-neutral-50 transition-colors ${cancelada ? "text-neutral-400" : "hover:bg-neutral-50/50"}`}>
                      <td className="px-4 py-2.5 align-top text-xs tabular whitespace-nowrap">{fmtFechaHora(c.scheduledAt)}</td>
                      <td className="px-4 py-2.5 align-top text-xs tabular">{c.duration ? `${c.duration} min` : "—"}</td>
                      <td className="px-4 py-2.5 align-top text-xs">{ROTULO_TRAMO[c.tramo] ?? c.tramo ?? "—"}</td>
                      <td className="px-4 py-2.5 align-top text-xs">{ESTADO_CITA[c.status] ?? c.status ?? "—"}</td>
                      <td className="px-4 py-2.5 align-top text-xs">{nombreDelEquipo(c.teamMemberId) ?? <span className="text-neutral-300">—</span>}</td>
                      <td className="px-4 py-2.5 align-top text-right">
                        {c.urls?.registro && !cancelada && (
                          <Link href={c.urls.registro} className={c.sessionId ? btnNeutro : `${btn} text-[var(--color-primary,#1B3A2D)] border border-[var(--color-primary,#1B3A2D)]/30 hover:bg-neutral-50 inline-block`}>
                            {c.sessionId ? "Seguir registro" : "Escribir registro"}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Bloque>

      {/* ── Informe ──────────────────────────────────────────────────────── */}
      <Bloque titulo="Informe de valoración diagnóstica">
        {e.informe ? (
          <div className="px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-xs text-neutral-600 sm:flex-1">
              <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full mr-2 ${CHIP_INFORME[e.informe.status] ?? "bg-neutral-100 text-neutral-500"}`}>
                {e.informe.statusLabel ?? e.informe.status}
              </span>
              Informe del {fmtFecha(e.informe.reportDate)}. Los registros terminados se unen desde el propio informe («Unir los registros con la IA»).
            </div>
            <Link href={e.informe.url} className={btnPrimario} style={{ background: "var(--color-primary, #1B3A2D)" }}>
              Abrir el informe
            </Link>
          </div>
        ) : (
          <div className="px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-xs text-neutral-600 sm:flex-1">
              Todavía no hay informe. «Unir en informe» crea el informe de valoración diagnóstica de este expediente
              (firmado por el terapeuta asignado) y abre el editor, donde la IA junta los registros terminados apartado
              por apartado y tú aceptas lo que valga.
            </p>
            <button
              type="button"
              onClick={unirEnInforme}
              disabled={creandoInforme || ocupado}
              className={`${btnPrimario} disabled:opacity-50`}
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {creandoInforme ? "Creando…" : "Unir en informe"}
            </button>
          </div>
        )}
      </Bloque>

      {acciones.dialogo}
    </div>
  );
}
