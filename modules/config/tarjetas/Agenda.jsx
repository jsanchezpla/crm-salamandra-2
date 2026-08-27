"use client";

// modules/config/tarjetas/Agenda.jsx — pestaña «Agenda» de Configuración:
// cómo funciona la agenda por dentro (recordatorios, agenda compartida, color
// de bloqueos, videollamada y avisos por WhatsApp).


import { useEffect, useState } from "react";
import { COLOR_BLOQUEO_POR_DEFECTO, colorTextoSobre } from "../../../lib/citas/coloresBloqueo.js";
import { PrimaryButton } from "./ui.jsx";
export function RecordatoriosCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Recordatorio de cita</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Un correo automático el día antes, con la hora, el sitio (o el enlace de videollamada)
            y un botón para avisar si no puede venir. Reduce las citas a las que no se presenta
            nadie, que es una hora perdida que no se recupera.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar recordatorios" : "Activar recordatorios"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: se envía a las citas confirmadas del día siguiente.</span>
          : <span className="text-neutral-400">Apagado: no se manda ningún recordatorio.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Solo a citas <strong>confirmadas</strong> y con email. Cada persona recibe uno y solo uno.
        Las citas pendientes de confirmar no reciben recordatorio.
      </p>
    </div>
  );
}

export function AgendaCompartidaCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Agenda compartida</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Que cada profesional vea las citas de TODO el equipo, no solo las suyas. Útil en un
            centro donde se cubren entre compañeras y hay que cuadrar recuperaciones sin
            preguntar. Con el interruptor apagado, cada una ve únicamente su agenda.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar agenda compartida" : "Activar agenda compartida"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activa: todo el equipo ve la agenda completa.</span>
          : <span className="text-neutral-400">Apagada: cada profesional ve solo sus citas.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Ojo: el listado de citas enseña <strong>nombre, email y teléfono</strong> del paciente. Al
        encenderlo, esos datos quedan a la vista de toda la plantilla.
      </p>
    </div>
  );
}

/**
 * Color de los tramos bloqueados de la agenda (10/08/2026, Rodrigo).
 *
 * Es el del CENTRO. Cada profesional puede pisarlo con el suyo desde su ficha
 * de equipo, y por eso la tarjeta lo dice: si no, alguien cambia esto, ve que
 * los bloqueos de una compañera siguen igual y piensa que no se ha guardado.
 */
export function ColorBloqueosCard({ color, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(color ?? COLOR_BLOQUEO_POR_DEFECTO);

  // Si el color llega más tarde que el primer render (la carga es asíncrona),
  // el selector tiene que ponerse al día o enseñaría el negro por defecto.
  useEffect(() => { setBorrador(color ?? COLOR_BLOQUEO_POR_DEFECTO); }, [color]);

  const valido = /^#[0-9a-fA-F]{6}$/.test(borrador.trim());
  const sinCambios = borrador.trim().toUpperCase() === (color ?? "").toUpperCase();

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Color de los bloqueos</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        El color con el que se pintan en la agenda las vacaciones, ausencias y cierres del
        centro. Cada profesional puede tener el suyo propio desde su ficha en Equipo; este es el
        que se usa cuando no lo tiene.
      </p>

      <div className="mt-3 flex gap-2 flex-wrap items-end">
        <div>
          <label className="block text-[11px] text-neutral-500 mb-1">Color</label>
          <input
            type="color"
            value={valido ? borrador : COLOR_BLOQUEO_POR_DEFECTO}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value.toUpperCase())}
            className="h-10 w-14 border border-neutral-200 rounded-lg p-1 disabled:opacity-40 cursor-pointer"
            aria-label="Elegir el color de los bloqueos"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="block text-[11px] text-neutral-500 mb-1">Código</label>
          <input
            type="text"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder={COLOR_BLOQUEO_POR_DEFECTO}
            className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 font-mono disabled:bg-neutral-50"
          />
        </div>
        {!readOnly && (
          <PrimaryButton onClick={() => valido && onGuardar(borrador.trim().toUpperCase())}>
            Guardar
          </PrimaryButton>
        )}
      </div>

      {!valido && (
        <p className="text-[11px] text-rose-600 mt-2">
          Tiene que ser un código de color tipo <span className="font-mono">#0F0F0F</span>.
        </p>
      )}

      {/* Cómo queda. La muestra lleva la MISMA letra que calcula la agenda, o
          enseñaría algo legible aquí e ilegible allí. */}
      <div className="mt-3">
        <div className="text-[11px] text-neutral-500 mb-1">Así se verá en la agenda</div>
        <div
          className="rounded px-2 py-1 text-[11px] font-medium inline-block"
          style={{
            backgroundColor: valido ? borrador : COLOR_BLOQUEO_POR_DEFECTO,
            color: colorTextoSobre(valido ? borrador : COLOR_BLOQUEO_POR_DEFECTO),
          }}
        >
          Vacaciones · Laura
        </div>
      </div>

      {!readOnly && !sinCambios && valido && (
        <p className="text-[10px] text-neutral-400 mt-2">Sin guardar todavía.</p>
      )}
    </div>
  );
}

export function VideollamadaCard({ meetModo, salas = [], readOnly, onChange }) {
  const auto = meetModo === "automatico";
  const opciones = [
    {
      id: "manual",
      titulo: "A mano (recomendado)",
      desc: "La cita se crea sin enlace. Lo pegas en su ficha y pulsas «Guardar y enviar» para que le llegue al paciente por email.",
    },
    {
      id: "automatico",
      titulo: "Automático (sala fija)",
      desc: "Si tienes sala de videollamada contratada (Google Meet, Zoom…) y su enlace puesto en el tipo de cita, la cita lo hereda sola y el paciente lo recibe al confirmar.",
    },
  ];

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Enlace de videollamada</div>
      <p className="text-xs text-neutral-400 mt-0.5 mb-3 max-w-xl">
        Solo afecta a las citas online del módulo de Citas.
      </p>
      <div className="space-y-2">
        {opciones.map((o) => {
          const activa = (o.id === "automatico") === auto;
          return (
            <label
              key={o.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                activa ? "border-[var(--color-primary,#1B3A2D)] bg-neutral-50/60" : "border-neutral-200 hover:border-neutral-300"
              } ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="meetModo"
                checked={activa}
                disabled={readOnly}
                onChange={() => onChange(o.id)}
                className="mt-0.5 accent-[var(--color-primary,#1B3A2D)]"
              />
              <div>
                <div className="text-sm font-medium text-neutral-800">{o.titulo}</div>
                <div className="text-[11px] text-neutral-500 leading-snug">{o.desc}</div>
              </div>
            </label>
          );
        })}
      </div>
      {/* Lo que HEREDARÍAN las citas online si se pasa a automático. Se enseña
          siempre, no solo en automático: el momento en que hace falta verlo es
          justo ANTES de cambiar el modo. */}
      {salas.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <div className="text-[11px] font-medium text-neutral-500 mb-1.5">
            Salas que se usarían en modo automático
          </div>
          <ul className="space-y-1">
            {salas.map((s) => (
              <li key={s.nombre} className="text-[11px] flex flex-wrap gap-x-2 gap-y-0.5">
                <span className="text-neutral-700">{s.nombre}</span>
                {s.url ? (
                  <span className="text-neutral-400 break-all">{s.url}</span>
                ) : (
                  <span className="text-amber-700">sin enlace</span>
                )}
              </li>
            ))}
          </ul>
          {auto && salas.some((s) => !s.url) && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              Las citas online de los tipos sin enlace se crearán igualmente sin él.
            </p>
          )}
          <p className="text-[10px] text-neutral-400 mt-1.5">
            Nadie comprueba que estos enlaces funcionen: si alguno es de ejemplo, el paciente
            recibirá una sala que no existe. Se cambian en cada tipo de cita.
          </p>
        </div>
      )}

      <p className="text-[10px] text-neutral-400 mt-3">
        El modo automático reutiliza el enlace de sala fija del tipo de cita. Crear salas nuevas en Google
        automáticamente requiere conectar Google Calendar, que todavía no está disponible.
      </p>
    </div>
  );
}

export function AvisosWhatsappCard({ activo, readOnly, configurado, onChange, irAConexiones }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Avisos de cita por WhatsApp</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Además del correo, mandar por WhatsApp la confirmación de la cita, el enlace de la
            videollamada y el recordatorio de la víspera. Sale desde el número del negocio, y nunca
            se escribe a quien tenga marcado que no quiere WhatsApp.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar avisos por WhatsApp" : "Activar avisos por WhatsApp"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {/* El aviso de «falta conectar» decía «abajo», y dejó de ser verdad el
            23/08/2026: al repartir la pantalla en zonas, WhatsApp se fue a
            «Conexiones» y este interruptor se quedó en «Agenda». Va un botón
            que cambia de zona y no un <Link>: navegar a la misma página no
            remonta el componente, así que la pestaña no cambiaría y el enlace
            no haría nada. */}
        {!configurado ? (
          <span className="text-amber-700">
            Falta conectar WhatsApp en{" "}
            <button type="button" onClick={irAConexiones} className="underline hover:no-underline font-medium">
              Conexiones
            </button>{" "}
            (token y número): mientras tanto no sale ningún mensaje.
          </span>
        ) : activo ? (
          <span className="text-emerald-700">Activos: cada aviso de cita va por correo y por WhatsApp.</span>
        ) : (
          <span className="text-neutral-400">Apagados: los avisos van solo por correo.</span>
        )}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Meta cobra por conversación iniciada por el negocio, y si la persona no te ha escrito en las
        últimas 24 h exige una <strong>plantilla aprobada</strong>: esos mensajes los rechaza hasta
        que la tengas dada de alta.
      </p>
    </div>
  );
}
