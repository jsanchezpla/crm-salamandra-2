"use client";

import Link from "next/link";
import Select from "../ui/Select.jsx";
import BarraDeHoras from "./BarraDeHoras.jsx";
import { formatoHoras, mensajeTope } from "../../lib/clinica/diagnostico.js";

/**
 * DiagnosticoFila — una fila de la lista de Diagnósticos (12/09/2026).
 *
 * Pinta LA FILA que devuelve la API (`lib/clinica/diagnosticoFila.js`): el
 * paciente con enlace a su ficha, el producto, el terapeuta asignado (un
 * desplegable que guarda al cambiar), la barra de horas, el estado y los
 * botones. Qué botones salen NO se decide aquí: viene en `acciones`, ya
 * cruzado con el estado y con quién mira (`permisos.puedeDecidir`), para que
 * la lista y la ficha de la cita no discrepen nunca sobre lo que se puede
 * hacer con un expediente.
 *
 * Lo único que la fila añade por su cuenta son dos frenos de PANTALLA, no de
 * regla: sin tipo de cita DIAGNÓSTICO o sin acceso a Citas, los dos enlaces a
 * la agenda salen apagados con su motivo (abrirían un cajón que no sabe qué
 * tipo poner, o un 403).
 *
 * Desde la segunda entrega (12/09/2026) el expediente tiene ficha propia
 * (`/clinica/diagnosticos/[id]`, enlace «Expediente») y el informe de
 * valoración nace desde ella: «Informe» solo sale cuando ya existe
 * (`urls.informe`). Los botones viven en `BotonesDeDiagnostico`, que la ficha
 * reusa tal cual: los MISMOS botones en los dos sitios, no dos copias.
 */

export const CHIP_ESTADO = {
  entrevista: "bg-sky-50 text-sky-700",
  en_curso: "bg-emerald-50 text-emerald-700",
  no_continua: "bg-neutral-100 text-neutral-500",
  cerrado: "bg-neutral-100 text-neutral-500",
};

const fmtFecha = (d) =>
  d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

export const ESTADO_CITA = { confirmed: "confirmada", pending: "pendiente", completed: "hecha", cancelled: "cancelada", no_show: "falta" };

const btn = "text-[11px] font-medium px-2 py-1 rounded-md transition-colors whitespace-nowrap";
const btnPrimario = `${btn} text-white hover:opacity-90`;
const btnNeutro = `${btn} border border-neutral-200 text-neutral-600 hover:bg-neutral-50`;
const btnApagado = `${btn} border border-neutral-100 text-neutral-300 cursor-not-allowed`;

/**
 * Los botones de un expediente, según `acciones` de la fila. Los mismos en la
 * lista y en la ficha; `conEnlaces` añade «Expediente» e «Informe» (la ficha
 * no se enlaza a sí misma).
 */
export function BotonesDeDiagnostico({
  expediente: e,
  motivoSinAgenda = null,
  ocupado = false,
  conEnlaces = true,
  onParar,
  onSeguir,
  onDesbloquear,
  onCerrar,
}) {
  const a = e.acciones ?? {};
  const puedeIrAAgenda = !motivoSinAgenda;
  const motivoAnadir = !puedeIrAAgenda
    ? motivoSinAgenda
    : e.horas?.agotado
      ? mensajeTope(e.horasMax) // la misma frase que daría el 422 de la agenda
      : null;

  return (
    <>
      {a.abrirEntrevista &&
        (puedeIrAAgenda ? (
          <Link href={e.urls.entrevista} className={btnPrimario} style={{ background: "var(--color-primary, #1B3A2D)" }}>
            Abrir entrevista inicial
          </Link>
        ) : (
          <span className={btnApagado} title={motivoSinAgenda}>Abrir entrevista inicial</span>
        ))}
      {a.seguir && (
        <button type="button" disabled={ocupado} onClick={() => onSeguir?.(e)} className={`${btnNeutro} text-emerald-700 border-emerald-200 hover:bg-emerald-50`}>
          Seguir con el diagnóstico
        </button>
      )}
      {a.parar && (
        <button type="button" disabled={ocupado} onClick={() => onParar?.(e)} className={btnNeutro}>
          Parar el diagnóstico
        </button>
      )}
      {a.anadirHoras &&
        (motivoAnadir ? (
          <span className={btnApagado} title={motivoAnadir}>Añadir horas</span>
        ) : (
          <Link href={e.urls.horas} className={btnPrimario} style={{ background: "var(--color-primary, #1B3A2D)" }}>
            Añadir horas
          </Link>
        ))}
      {a.desbloquear && (
        <button type="button" disabled={ocupado} onClick={() => onDesbloquear?.(e)} className={btnNeutro} title="Subir el tope de horas de este diagnóstico">
          Desbloquear horas
        </button>
      )}
      {a.cerrar && (
        <button type="button" disabled={ocupado} onClick={() => onCerrar?.(e)} className={`${btn} text-neutral-400 hover:text-neutral-800`}>
          Cerrar
        </button>
      )}
      {conEnlaces && e.urls?.expediente && (
        <Link href={e.urls.expediente} className={`${btn} text-[var(--color-primary,#1B3A2D)] hover:underline`} title="La ficha del expediente: registros de diagnóstico, citas e informe">
          Expediente
        </Link>
      )}
      {conEnlaces && e.urls?.informe && (
        <Link href={e.urls.informe} className={`${btn} text-indigo-700 hover:underline`} title="Abre el informe de valoración diagnóstica de este expediente">
          Informe
        </Link>
      )}
    </>
  );
}

export default function DiagnosticoFila({
  expediente: e,
  equipo = [],
  motivoSinAgenda = null,
  ocupado = false,
  onCambiarTerapeuta,
  onParar,
  onSeguir,
  onDesbloquear,
  onCerrar,
}) {
  return (
    <tr className={`border-b border-neutral-50 transition-colors ${e.abierto ? "hover:bg-neutral-50/50" : "text-neutral-400"}`}>
      <td className="px-4 py-3 align-top">
        {e.paciente ? (
          <Link href={`/pacientes/${e.paciente.id}`} className="font-medium text-neutral-800 hover:underline">
            {e.paciente.nombre}
          </Link>
        ) : (
          <span className="italic text-neutral-400">(sin paciente)</span>
        )}
        {e.entrevista && (
          <div className="text-[11px] text-neutral-400 mt-0.5">
            Entrevista {fmtFecha(e.entrevista.scheduledAt)}
            {e.entrevista.status && ESTADO_CITA[e.entrevista.status] ? ` · ${ESTADO_CITA[e.entrevista.status]}` : ""}
          </div>
        )}
        {e.cobroPendiente && (
          <div className="text-[11px] text-amber-700 mt-0.5 tabular">
            {e.cobroPendiente.importe.toLocaleString("es-ES", { minimumFractionDigits: 2 })} € sin cobrar
          </div>
        )}
      </td>

      <td className="px-4 py-3 align-top text-xs text-neutral-600">
        {e.producto?.nombre}
        {e.horasDesbloqueadasAt && (
          <div className="text-[11px] text-neutral-400 mt-0.5" title="Se subió el tope de horas de este diagnóstico">
            tope subido a {formatoHoras(e.horasMax)} h
          </div>
        )}
      </td>

      <td className="px-4 py-3 align-top">
        <Select
          value={e.therapistId ?? ""}
          onChange={(v) => onCambiarTerapeuta?.(e, v || null)}
          disabled={ocupado || !e.abierto}
          aria-label="Terapeuta asignado"
          options={[{ value: "", label: "— Sin asignar —" }, ...equipo.map((m) => ({ value: m.id, label: m.nombre }))]}
          className="text-xs border border-neutral-200 rounded-lg px-2 py-1 bg-white hover:border-neutral-300 min-w-[150px]"
        />
      </td>

      <td className="px-4 py-3 align-top">
        <BarraDeHoras tramos={e.tramos} rotulo={e.rotuloHoras} agotado={e.horas?.agotado && e.abierto} />
      </td>

      <td className="px-4 py-3 align-top">
        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${CHIP_ESTADO[e.status] ?? "bg-neutral-100 text-neutral-500"}`}>
          {e.rotuloEstado}
        </span>
      </td>

      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap items-center gap-1.5 justify-end">
          <BotonesDeDiagnostico
            expediente={e}
            motivoSinAgenda={motivoSinAgenda}
            ocupado={ocupado}
            onParar={onParar}
            onSeguir={onSeguir}
            onDesbloquear={onDesbloquear}
            onCerrar={onCerrar}
          />
        </div>
      </td>
    </tr>
  );
}
