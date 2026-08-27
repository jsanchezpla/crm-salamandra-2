"use client";

// modules/config/tarjetas/Reservas.jsx — pestaña «Reserva online» de
// Configuración: qué puede reservar la gente por su cuenta y las cuatro
// puertas (admisión, contrato, identidad y caja) más la página pública.


import { useState } from "react";
import HelpTooltip from "../../../components/ui/HelpTooltip.jsx";
import { PrimaryButton } from "./ui.jsx";
/**
 * El centro decide si la familia puede anular sus citas sola (08/08/2026).
 *
 * La tarjeta explica las DOS cosas que se apagan a la vez —el botón del área
 * privada y el enlace de los correos— porque apagar solo una es el error que se
 * comete: el «Cancela aquí» del correo cancela sin iniciar sesión y no caduca.
 */
/**
 * El centro no da cita por internet (08/08/2026).
 *
 * La tarjeta insiste en que esto NO es esconder el enlace: la agenda respondía
 * a cualquiera que conociera la dirección aunque no estuviera enlazada en
 * ningún sitio, entregando el catálogo entero de tipos de cita.
 */
export function ReservaOnlineCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Las citas se piden solo en el centro</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Cierra la agenda pública: nadie puede pedir cita por internet ni ver el catálogo de
            tipos de cita, aunque conozca la dirección. Quien entre verá un aviso con la marca del
            centro y un enlace a vuestra web. El área privada de las familias sigue funcionando.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Abrir la agenda pública" : "Cerrar la agenda pública"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: la agenda pública está cerrada.</span>
          : <span className="text-neutral-400">Apagado: cualquiera con el enlace puede pedir cita.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        No basta con no enlazar la agenda desde vuestra web: sin esto, la dirección responde
        igual y enseña <strong>todos</strong> vuestros tipos de cita.
      </p>
    </div>
  );
}

export function CancelacionCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Las citas se anulan solo desde el centro</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Para centros que gestionan su agenda por teléfono. Al activarlo, la familia deja de
            tener el botón de anular en su área privada y los correos de cita dejan de llevar el
            enlace de «Cancela aquí». El equipo sigue pudiendo anular con normalidad desde el CRM.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Permitir que la familia anule sus citas" : "Impedir que la familia anule sus citas"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: para cambiar una cita, la familia llama al centro.</span>
          : <span className="text-neutral-400">Apagado: la familia puede anular sus citas ella misma.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Al activarlo dejan de funcionar también los enlaces de cancelar de los correos
        <strong> ya enviados</strong>, que hasta ahora no caducaban nunca.
      </p>
    </div>
  );
}

export function PuertaAdmisionCard({ activo, url, readOnly, onChange, onGuardarUrl }) {
  // El borrador arranca del valor guardado. Cuando ese valor cambia, la
  // tarjeta se vuelve a montar (`key` en quien la pinta) en vez de
  // resincronizarse con un efecto.
  const [borrador, setBorrador] = useState(url ?? "");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Formulario obligatorio para pedir cita</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Solo pueden reservar las personas cuya solicitud del formulario esté aceptada en la
            bandeja. Al resto se les enseña el aviso con el enlace al formulario, no un error.
            Afecta a todos los tipos de cita y a todo el mundo, también a quien ya era paciente.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Quitar el formulario obligatorio" : "Exigir formulario para reservar"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo && !(url ?? "").trim() ? (
          <span className="text-amber-700">
            Falta la dirección del formulario: sin ella el aviso no lleva a ningún sitio.
          </span>
        ) : activo ? (
          <span className="text-emerald-700">Activa: sin solicitud aceptada no se puede reservar.</span>
        ) : (
          <span className="text-neutral-400">Apagada: cualquiera con el enlace de la agenda puede reservar.</span>
        )}
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-neutral-500 mb-1">
          Dirección del formulario (en tu web)
        </label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            inputMode="url"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="https://tuweb.com/primer-contacto"
            className="flex-1 min-w-[220px] text-sm border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50"
          />
          {!readOnly && (
            <PrimaryButton onClick={() => onGuardarUrl(borrador.trim())}>Guardar</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Puerta de admisión: solo reserva quien ha pasado por el formulario y ha sido
 * aceptado en la bandeja. El enlace es obligatorio en la práctica —sin él, a
 * quien no ha pasado se le dice que le falta algo pero no a dónde ir—, así que
 * la tarjeta avisa en ámbar cuando está encendida y vacía.
 */
/**
 * Puerta de CONTRATOS (04/08/2026). Hermana de la de admisión, pero mira otra
 * cosa: aquella pregunta «¿te admito?» y esta «¿has firmado?». Sin URL que
 * configurar — el sitio donde se firma es el área privada, que ya se sabe.
 */
export function PuertaContratoCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Contratos firmados para pedir cita</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Solo puede reservar quien tenga firmados los documentos del centro. Al resto se les
            enseña el aviso con el enlace a su área privada, no un error.{" "}
            <strong className="text-neutral-500">La valoración inicial se salta esta puerta</strong>{" "}
            —es la primera visita y todavía no hay nada que firmar—, y quien firmó en papel cuenta
            como firmado.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Quitar los contratos obligatorios" : "Exigir contratos firmados para reservar"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo ? (
          <span className="text-emerald-700">
            Activa: sin los documentos firmados solo se puede pedir la valoración inicial.
          </span>
        ) : (
          <span className="text-neutral-400">
            Apagada: se puede reservar y dejar la tarjeta sin haber firmado nada.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Puerta de identidad (05/08/2026): sin cuenta en la web no se reserva.
 *
 * Es la más básica de las cuatro y la única que hasta hoy era MENTIRA: el
 * widget enseñaba un cartel de «inicia sesión» que se saltaba escribiendo
 * `?wpa=1` en la URL, y el servidor no comprobaba nada.
 */
export function PuertaIdentidadCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
            Pedir cita solo con cuenta
            {/* La ayuda del CONJUNTO va aquí, en la primera de las cuatro: cada
                tarjeta se explica sola, pero nadie dice cómo se relacionan ni
                en qué orden actúan, que es lo que de verdad despista. */}
            <HelpTooltip title="Las cuatro puertas de la agenda" placement="bottom">
              Hay cuatro filtros para reservar y se pueden encender por separado. Actúan en este
              orden: <strong className="text-white">1) tener cuenta</strong> (esta),
              {" "}2) estar admitido por el formulario, 3) tener el contrato firmado y 4) pagar.
              {" "}
              Todas vienen APAGADAS. Enciende de una en una y comprueba que se puede reservar
              después de cada una: encender varias de golpe deja gente fuera y no se sabe cuál fue.
            </HelpTooltip>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Para reservar hay que haber iniciado sesión en tu web. Sin esto, cualquiera con el
            enlace de tu agenda pide hora, y esa cita entra <strong className="text-neutral-500">sin
            paciente detrás</strong>: no hay ficha a la que enlazarla y hay que adivinar de quién es.{" "}
            <strong className="text-neutral-500">La valoración inicial tampoco se libra</strong> — se
            salta los contratos, que es otra cosa, pero cuenta tiene que tener.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Permitir reservar sin cuenta" : "Exigir cuenta para reservar"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo ? (
          <span className="text-emerald-700">
            Activa: quien no haya iniciado sesión en tu web no puede reservar.
          </span>
        ) : (
          <span className="text-neutral-400">
            Apagada: cualquiera con el enlace del widget puede reservar sin identificarse.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Puerta de caja (05/08/2026): desde la agenda pública solo se reserva lo que
 * se cobra. Apagada por defecto — hay centros cuyos tipos de cita no tienen
 * precio porque cobran cuotas por fuera, y encenderla para todos los dejaría
 * sin poder reservar nada.
 */
export function PuertaCajaCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Reservar online solo pagando</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Desde la agenda pública solo se puede reservar lo que pasa por caja: o lo cobra la
            pasarela en ese momento, o ya lo pagó un bono.{" "}
            <strong className="text-neutral-500">Las citas gratuitas las creas tú a mano</strong>{" "}
            desde tu agenda. Enciéndelo si cobras por fuera (transferencia, Bizum) y no quieres que
            nadie se cuele reservando una cita sin pagar.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Permitir reservar citas sin pago" : "Exigir pago para reservar online"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo ? (
          <span className="text-emerald-700">
            Activa: una cita sin precio y sin bono no se puede reservar desde la web.
          </span>
        ) : (
          <span className="text-neutral-400">
            Apagada: se puede reservar cualquier tipo de cita, tenga precio o no.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * PaginaReservasCard — dónde vive la agenda dentro de la web del cliente
 * (06/08/2026, Rodrigo).
 *
 * Sin esto, el botón de «copiar enlace» de cada tipo de cita daba la dirección
 * del CRM. Ese enlace, abierto desde un WhatsApp, cae fuera de la web del centro
 * —donde no hay sesión— y lo único que puede enseñar es «inicia sesión para
 * reservar». Con la página puesta, el enlace que se copia es el de SU web.
 */
export function PaginaReservasCard({ url, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(url ?? "");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Página de reservas de tu web</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        La página donde tienes puesta la agenda. Se usa para los enlaces de cita única que copias
        en Tipos de cita: así quien los abra entra por tu web, con su sesión, en vez de encontrarse
        una pantalla pidiéndole que inicie sesión.
      </p>

      <div className="mt-1 text-[11px] font-medium">
        {(url ?? "").trim() ? (
          <span className="text-emerald-700">Puesta: los enlaces de cita apuntan a tu web.</span>
        ) : (
          <span className="text-neutral-400">Sin poner: los enlaces apuntan al CRM y pedirán iniciar sesión.</span>
        )}
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-neutral-500 mb-1">Dirección de la página de reservas</label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            inputMode="url"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="https://tuweb.com/citas"
            className="flex-1 min-w-[220px] text-sm border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50"
          />
          {!readOnly && (
            <PrimaryButton onClick={() => onGuardar(borrador.trim())}>Guardar</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}
