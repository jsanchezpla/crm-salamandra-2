"use client";

/**
 * ClientWhatsappSection — la conversación de WhatsApp dentro de la ficha.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * La Cloud API no guarda conversaciones: empuja cada mensaje al webhook y se
 * olvida. Todo lo que se ha dicho por WhatsApp vive en `whatsapp_messages` y
 * hasta ahora no había ninguna pantalla que lo enseñara — o sea, se estaba
 * guardando para nadie.
 *
 * ── ES DE LECTURA, Y ESO ES UNA DECISIÓN ────────────────────────────────────
 * No hay caja para responder, a propósito. Con la coexistencia el número sigue
 * vivo en el móvil de la profesional: ahí contesta ella, gratis y sin ventanas
 * de 24 h. Una caja de respuesta aquí sería una trampa — funcionaría mientras el
 * paciente hubiera escrito hace menos de un día y fallaría el resto del tiempo,
 * que es justo cuando alguien confiaría en ella.
 *
 * Lo que aporta esta pantalla es el REGISTRO: quién dijo qué, cuándo, si el
 * recordatorio llegó y por qué no llegó cuando no llegó. Eso en el móvil no se
 * puede mirar y aquí queda al lado de la historia del paciente.
 *
 * ── SE ESCONDE SOLA ─────────────────────────────────────────────────────────
 * Sin mensajes devuelve `null`, y entonces `PanelPestana` declara la pestaña
 * vacía y desaparece del menú (misma regla que el resto de la ficha: una pestaña
 * vacía confunde más que una larga). Así, en un centro sin WhatsApp o con un
 * paciente al que nunca se ha escrito, no sobra nada en pantalla.
 */

import { useCallback, useEffect, useState } from "react";

const fmtHora = (iso) =>
  new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

const fmtDia = (iso) =>
  new Date(iso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });

const claveDia = (iso) => new Date(iso).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });

/** El acuse de entrega, en palabras. Los "tics" de WhatsApp aquí no se leen. */
const ESTADOS = {
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};

/**
 * `onEstado(hay)` avisa de si hay algo que enseñar. La ficha por defecto no lo
 * necesita —`PanelPestana` lo deduce mirando el DOM— pero la de nutri_laura
 * pinta sus pestañas a mano y no tiene forma de saberlo sin preguntar.
 */
export default function ClientWhatsappSection({ clientId, onEstado }) {
  const [mensajes, setMensajes] = useState(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/clients/${clientId}/whatsapp`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo) return;
        const lista = j?.data?.mensajes ?? [];
        setMensajes(lista);
        setHayMas(!!j?.data?.hayMas);
        onEstado?.(lista.length > 0);
      })
      .catch(() => {
        if (!vivo) return;
        setMensajes([]);
        onEstado?.(false);
      });
    return () => { vivo = false; };
  }, [clientId, onEstado]);

  const cargarAnteriores = useCallback(async () => {
    if (!mensajes?.length) return;
    setCargandoMas(true);
    try {
      const antes = encodeURIComponent(mensajes[0].sentAt);
      const r = await fetch(`/api/clients/${clientId}/whatsapp?antes=${antes}`);
      const j = await r.json().catch(() => null);
      if (j?.ok) {
        setMensajes((prev) => [...(j.data.mensajes ?? []), ...prev]);
        setHayMas(!!j.data.hayMas);
      }
    } finally {
      setCargandoMas(false);
    }
  }, [clientId, mensajes]);

  // Todavía cargando, o nada que enseñar: la pestaña no existe.
  if (!mensajes || mensajes.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-[13px] font-semibold text-gray-700">WhatsApp</span>
        <p className="text-[11px] text-gray-400 mt-1">
          Lo que se ha hablado por WhatsApp con esta persona. Para responder, usa tu WhatsApp de siempre: los mensajes
          que escribas desde el móvil aparecen aquí solos.
        </p>
      </div>

      <div className="p-5 space-y-1 bg-gray-50/60">
        {hayMas && (
          <div className="text-center pb-3">
            <button
              onClick={cargarAnteriores}
              disabled={cargandoMas}
              className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 bg-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {cargandoMas ? "Cargando…" : "Ver mensajes anteriores"}
            </button>
          </div>
        )}

        {mensajes.map((m, i) => {
          const anterior = mensajes[i - 1];
          const nuevoDia = !anterior || claveDia(anterior.sentAt) !== claveDia(m.sentAt);
          return (
            <div key={m.id}>
              {nuevoDia && (
                <div className="flex justify-center my-3">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 bg-white border border-gray-100 rounded-full px-3 py-1">
                    {fmtDia(m.sentAt)}
                  </span>
                </div>
              )}
              <Burbuja mensaje={m} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Burbuja({ mensaje: m }) {
  const saliente = m.direction === "out";
  const fallido = m.status === "failed";

  return (
    <div className={`flex ${saliente ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 border ${
          fallido
            ? "bg-red-50 border-red-200"
            : saliente
              ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/20"
              : "bg-white border-gray-200"
        }`}
      >
        {m.body ? (
          <p className="text-[13px] text-gray-800 whitespace-pre-wrap break-words">{m.body}</p>
        ) : (
          // Los adjuntos no se descargan (haría falta pedírselos a Meta con el
          // token del cliente y guardarlos con su cuota). Se deja constancia de
          // que hubo algo, que es mejor que un hueco sin explicar.
          <p className="text-[13px] text-gray-400 italic">{etiquetaSinTexto(m.type)}</p>
        )}

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[10px] text-gray-400">{fmtHora(m.sentAt)}</span>

          {/* Solo en lo que sale: distinguir lo que mandó el CRM de lo que
              escribió la profesional a mano es media pantalla de valor. */}
          {saliente && m.origin === "api" && (
            <span className="text-[9px] uppercase tracking-wider text-gray-400 border border-gray-200 rounded px-1 py-px">
              CRM
            </span>
          )}

          {saliente && m.status && (
            <span className={`text-[10px] ${fallido ? "text-red-600 font-medium" : "text-gray-400"}`}>
              · {ESTADOS[m.status] ?? m.status}
            </span>
          )}
        </div>

        {/* El motivo del fallo, en las palabras de Meta. Es lo que hay que poder
            enseñar cuando alguien pregunte por qué no le llegó el recordatorio. */}
        {fallido && m.errorMessage && (
          <p className="text-[11px] text-red-600 mt-1 border-t border-red-200 pt-1">{m.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

function etiquetaSinTexto(tipo) {
  switch (tipo) {
    case "image": return "(imagen)";
    case "video": return "(vídeo)";
    case "audio": return "(audio)";
    case "document": return "(documento)";
    case "sticker": return "(sticker)";
    case "location": return "(ubicación)";
    case "contacts": return "(contacto)";
    default: return "(sin texto)";
  }
}
