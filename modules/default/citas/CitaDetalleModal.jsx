"use client";

// modules/default/citas/CitaDetalleModal.jsx — la ficha de una cita: contacto,
// estado del cobro en cristiano, profesional y paciente, enlace de Meet, aviso
// libre al cliente, fecha y hora a mano, notas, propuestas de horario (IA) y
// los botones de completada / falta / cancelar / eliminar.
//
// El estado vive aquí y se estrena con cada cita: el padre lo monta con
// key={booking.id}, así que abrir otra cita remonta el componente (lo que
// antes hacían los resets de handleEventClick). Guardar avisa por onChanged
// (el padre refresca calendario y pendientes), borrar por onDeleted.

import { useEffect, useState } from "react";
import SelectorPaciente from "../../../components/citas/SelectorPaciente.jsx";
import { colaDePreparacion } from "../../../lib/clinica/prepararSesion.js";
import { fichaDeLaCita } from "../../../lib/citas/fichaDeLaCita.js";
import { esRecuperable, rotuloFalta, citasQuePuedenRecuperar } from "../../../lib/citas/recuperacionFalta.js";
import { esPresunta, estadoEfectivo } from "../../../lib/citas/asistencia.js";
import { cuerpoDelResultado, resultadoPorClave } from "../../../lib/citas/resultadoCita.js";
import {
  ModalityChip,
  PagoChip,
  StatusChip,
  cuantoQuedaDeRetencion,
  fmtDateTime,
  inputCls,
  pagoQuedoSinCompletar,
} from "./chips.jsx";

  /*
   * Fecha y hora de una cita, EN HORA DE MADRID, para meterlas en los <input>.
   *
   * No se usa `toISOString().slice(...)`: eso da UTC, y en verano pintaría una
   * cita de las 10:00 como las 08:00. El CRM trabaja en hora de Madrid y la
   * tarjeta tiene que enseñar lo mismo que el calendario.
   */
  function fechaMadrid(iso) {
    const p = new Date(iso);
    if (Number.isNaN(p.getTime())) return "";
    const [d, m, y] = p.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }).split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  function horaMadrid(iso) {
    const p = new Date(iso);
    if (Number.isNaN(p.getTime())) return "";
    return p.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  /** El aviso del cambio de hora, en cristiano. */
  function mensajeDelAviso(aviso) {
    if (!aviso) return null;
    if (aviso.enviado) return { tono: "ok", texto: "Hora cambiada y avisada por correo." };
    const porQue = {
      sin_email: "no tiene correo en su ficha",
      sin_consentimiento: "ha pedido no recibir correos",
      ya_pasada: "la cita ya había pasado",
      sin_configurar: "este cliente no tiene el correo configurado",
      error: "falló el envío",
    }[aviso.motivo] ?? "no se pudo enviar";
    return { tono: "warn", texto: `Hora cambiada, pero SIN avisar: ${porQue}. Díselo tú.` };
  }

export function CitaDetalleModal({
  booking: openBooking,
  conClientes = false,
  vocabulario = undefined,
  teamMembers,
  patients,
  viewerIsAdmin,
  confirmar,
  avisar,
  pedirTexto,
  onClose,
  onChanged,
  onDeleted,
}) {
  // Panel "Proponer 3 horarios (IA)"
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestScope, setSuggestScope] = useState("professional");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestErr, setSuggestErr] = useState(null);
  const [suggestNote, setSuggestNote] = useState(null);
  const [suggestSent, setSuggestSent] = useState(null); // confirmación tras enviar propuesta al centro
  const [saving, setSaving] = useState(false);
  // Buscador de paciente: acotado a la familia de la cita (lo normal) o
  // abierto a todo el centro. Ver la fila «Paciente» más abajo.
  const [pacienteEnTodos, setPacienteEnTodos] = useState(false);
  const [formError, setFormError] = useState(null);
  const [detailNotes, setDetailNotes] = useState(openBooking.notes ?? "");
  // Fecha y hora editables desde la propia tarjeta (07/08/2026, Rodrigo):
  // arrastrar en el calendario está bien para mover media hora, pero no para
  // pasar una cita a otro mes ni para ajustar a las 10:05.
  const [avisoHora, setAvisoHora] = useState(null);
  const [detailFecha, setDetailFecha] = useState(() => fechaMadrid(openBooking.scheduledAt));
  const [detailHora, setDetailHora] = useState(() => horaMadrid(openBooking.scheduledAt));
  const [detailMeet, setDetailMeet] = useState(openBooking.meetUrl ?? "");
  // Aviso efímero tras "Guardar y enviar" (enviado / solo guardado).
  const [meetAviso, setMeetAviso] = useState(null);
  // Aviso libre al cliente (03/08): lo que no encaja en «se cambió tu cita».
  const [avisoAbierto, setAvisoAbierto] = useState(false);
  const [avisoTitulo, setAvisoTitulo] = useState("");
  const [avisoCuerpo, setAvisoCuerpo] = useState("");
  const [enviandoAviso, setEnviandoAviso] = useState(false);
  const [avisoResultado, setAvisoResultado] = useState(null);
  // Recuperación de una falta recuperable (31/08/2026): las citas candidatas
  // a recuperarla (mismo cliente, vivas, posteriores — la regla en
  // lib/citas/recuperacionFalta.js) y, si ya está enlazada, la cita que la
  // recupera para poder decir CUÁNDO.
  const [candidatas, setCandidatas] = useState(null);
  const [recuperadora, setRecuperadora] = useState(null);
  // ¿Esta cita ya tiene registro de sesión? (01/09/2026, Rodrigo). Solo para
  // que el botón diga la verdad —«Seguir con la sesión» en vez de «Preparar
  // sesión»—: quien lo pulsa acaba en el mismo sitio de todas formas, porque
  // la regla «una cita, un registro» la aplica la pantalla de destino. Por eso
  // un fallo aquí no se enseña ni se reintenta: se queda el rótulo de siempre.
  const [sesionDeEstaCita, setSesionDeEstaCita] = useState(null);

  useEffect(() => {
    if (!openBooking.patientId) return;
    let vivo = true;
    fetch(`/api/clinica/sessions?bookingId=${encodeURIComponent(openBooking.id)}&limit=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setSesionDeEstaCita(j?.data?.sessions?.[0] ?? null); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [openBooking.id, openBooking.patientId]);

  useEffect(() => {
    if (!esRecuperable(openBooking)) return;
    let vivo = true;
    if (openBooking.recoveredByBookingId) {
      fetch(`/api/citas/bookings/${openBooking.recoveredByBookingId}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (vivo) setRecuperadora(j.ok ? j.data : null); })
        .catch(() => {});
    } else if (openBooking.clientId) {
      setRecuperadora(null);
      fetch(`/api/citas/bookings?clientId=${openBooking.clientId}&limit=100`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (vivo) setCandidatas(citasQuePuedenRecuperar(j.data?.bookings ?? [], openBooking)); })
        .catch(() => {});
    }
    return () => { vivo = false; };
  }, [openBooking.id, openBooking.status, openBooking.noShowJustified, openBooking.recoveredByBookingId, openBooking.clientId]);

  /*
   * Guardar la fecha y la hora tecleadas.
   *
   * Se manda un ISO CON OFFSET (…+02:00) construido con el desfase real de
   * Madrid en ESA fecha, no una cadena suelta: el servidor va en UTC y una
   * fecha sin zona se guardaría dos horas tarde — que es el fallo que ya se
   * comió las vacaciones el 07/08/2026.
   */
  async function guardarFechaHora() {
    if (!detailFecha || !detailHora) { setFormError("Pon la fecha y la hora"); return; }
    /*
     * El motivo viaja al correo del paciente (07/08/2026, Rodrigo). Sigue
     * siendo OPCIONAL —a veces solo hay que mover una cita y no hay nada que
     * explicar—: se cambia la hora igual con la caja vacía.
     *
     * Lo que sí cambia con el modal (12/08/2026): «Cancelar» ahora CANCELA. Con
     * el `prompt` del navegador, cancelar cambiaba la hora de todas formas, y
     * en una ventana con un botón que pone «Cancelar» eso no lo espera nadie.
     */
    const motivo = await pedirTexto({
      titulo: "Cambiar la hora de la cita",
      texto: "¿Por qué se cambia? Se lo contamos en el correo. Déjalo vacío si no quieres explicar nada.",
      etiqueta: "Motivo (opcional)",
      confirmar: "Cambiar la hora",
      multilinea: true,
    });
    if (motivo === null) return;
    const [y, m, d] = detailFecha.split("-").map(Number);
    const [hh, mm] = detailHora.split(":").map(Number);
    // El offset de Madrid en esa fecha, resuelto por el propio navegador.
    const tanteo = new Date(Date.UTC(y, m - 1, d, hh, mm));
    const enMadrid = new Date(tanteo.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const enUtc = new Date(tanteo.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMin = Math.round((enMadrid - enUtc) / 60000);
    const instante = new Date(tanteo.getTime() - offsetMin * 60000);
    const res = await patchBooking({
      scheduledAt: instante.toISOString(),
      ...(motivo && motivo.trim() ? { motivoCambio: motivo.trim() } : {}),
    });
    // Si salió el correo se dice, y si no, POR QUÉ. Callarse es lo que hace que
    // alguien dé por avisado a un paciente que no lo está.
    setAvisoHora(mensajeDelAviso(res?.avisoCambioHora));
  }

  async function patchBooking(payload) {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/citas/bookings/${openBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error guardando");
      // El padre guarda la cita nueva, refresca el calendario y el globito de
      // pendientes. Se devuelve j.data para que quien llama pueda leer flags
      // como `emailEnviado` del guardado del enlace de videollamada.
      onChanged(j.data);
      return j.data;
    } catch (err) {
      setFormError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function loadSuggestions(scope) {
    if (!openBooking) return;
    setSuggestOpen(true); setSuggestScope(scope); setSuggestLoading(true);
    setSuggestErr(null); setSuggestions([]); setSuggestNote(null); setSuggestSent(null);
    try {
      const r = await fetch(`/api/citas/bookings/${openBooking.id}/suggest-slots`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudieron proponer horarios");
      setSuggestions(j.data.suggestions || []);
      setSuggestNote(j.data.note || null);
    } catch (e) {
      setSuggestErr(e.message);
    } finally {
      setSuggestLoading(false);
    }
  }
  async function applySuggestion(s) {
    const payload = { scheduledAt: s.datetime };
    if (s.teamMemberId) payload.teamMemberId = s.teamMemberId;
    const okp = await patchBooking(payload);
    if (okp) { setSuggestOpen(false); setSuggestions([]); }
  }
  // Terapeuta no-admin: en vez de aplicar, MANDA la propuesta al centro (no es
  // definitivo hasta que el admin la aprueba).
  async function sendSuggestionToAdmin(s) {
    setSaving(true); setSuggestErr(null);
    try {
      const r = await fetch(`/api/citas/bookings/${openBooking.id}/reschedule-request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datetime: s.datetime, teamMemberId: s.teamMemberId || null, reason: s.reason || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo enviar la propuesta");
      setSuggestions([]);
      setSuggestSent("Propuesta enviada al centro. Te avisaremos cuando la confirmen.");
    } catch (e) {
      setSuggestErr(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function markCompleted() { await patchBooking(cuerpoDelResultado("completada")); }
  /**
   * Falta justificada o injustificada: DOS BOTONES (01/09/2026, Rodrigo).
   *
   * Antes había uno solo —«No asistió»— y detrás salía un diálogo preguntando
   * cuál de las dos era. Dos respuestas distintas escondidas tras un botón que
   * no decía ninguna: mirando la ficha no se sabía qué se iba a apuntar, y la
   * diferencia no es cosmética (una se recupera; la otra abre incidencia y
   * avisa a administración).
   *
   * Lo que se manda al servidor lo arma `lib/citas/resultadoCita.js`, que es lo
   * que comparten esta ficha y las citas de la ficha del paciente.
   */
  async function marcarFalta(clave) {
    const resultado = resultadoPorClave(clave);
    const motivo = await pedirTexto({
      ...resultado.motivo,
      tono: clave === "falta_injustificada" ? "peligro" : "normal",
    });
    if (motivo === null) return;
    await patchBooking(cuerpoDelResultado(clave, motivo));
  }
  async function cancelBooking() {
    const reason = await pedirTexto({ ...resultadoPorClave("cancelada").motivo, tono: "peligro" });
    if (reason === null) return;
    await patchBooking(cuerpoDelResultado("cancelada", reason));
  }
  async function saveNotes() { await patchBooking({ notes: detailNotes.trim() || null }); }
  /**
   * Guarda el enlace de videollamada. Con `enviar`, además manda el email al
   * cliente SIEMPRE (aunque el enlace ya estuviera puesto o se esté
   * corrigiendo): es el botón "Guardar y enviar".
   */
  async function saveMeet(enviar = false) {
    const url = detailMeet.trim() || null;
    const res = await patchBooking({ meetUrl: url, ...(enviar ? { enviarEmail: true } : {}) });
    if (enviar) {
      // `emailMotivo` dice POR QUÉ no salió. Antes solo había "enviado" o
      // "guardado", y "guardado" sugería una causa (cita no online, cancelada)
      // que casi nunca era la real.
      setMeetAviso(res?.emailEnviado ? "enviado" : (res?.emailMotivo ?? "guardado"));
      setTimeout(() => setMeetAviso(null), 8000);
    }
  }
  /**
   * Manda el aviso. Se guarda SIEMPRE (queda en el portal del cliente) aunque
   * el correo no salga, así que el resultado distingue las dos cosas: si solo
   * ha quedado publicado, hay que decirlo o ella creerá que le ha escrito.
   */
  async function enviarAviso() {
    if (!openBooking?.clientEmail) return;
    setEnviandoAviso(true);
    setAvisoResultado(null);
    try {
      const r = await fetch("/api/citas/avisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: openBooking.clientEmail,
          clientId: openBooking.clientId ?? null,
          bookingId: openBooking.id,
          nombre: openBooking.clientName ?? null,
          titulo: avisoTitulo.trim(),
          cuerpo: avisoCuerpo.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo mandar el aviso");

      setAvisoAbierto(false);
      setAvisoTitulo("");
      setAvisoCuerpo("");
      setAvisoResultado(
        j.data?.enviadoPorCorreo
          ? { ok: true, texto: "✓ Aviso enviado por email y publicado en su área privada." }
          : {
              ok: false,
              texto:
                j.data?.correo === "sin_consentimiento"
                  ? "Aviso publicado en su área privada. Por email no se le manda: ha pedido no recibir correos."
                  : "Aviso publicado en su área privada, pero NO ha salido por email (falta configurar el correo en Configuración).",
            }
      );
    } catch (err) {
      setAvisoResultado({ ok: false, texto: err.message });
    } finally {
      setEnviandoAviso(false);
    }
  }

  async function assignTeamMember(v) { await patchBooking({ teamMemberId: v || null }); }
  async function assignPatient(v) { await patchBooking({ patientId: v || null }); }
  /**
   * Borrar la cita DE VERDAD (13/08/2026, Rodrigo: «se quedan canceladas pero
   * no desaparecen si le doy a eliminar»).
   *
   * «Eliminar» hacía lo mismo que «Cancelar cita» —la dejaba en gris en el
   * calendario—, así que una cita apuntada en el día equivocado, duplicada o de
   * una prueba se quedaba ahí para siempre. Ahora se va del todo (`?hard=true`).
   *
   * Se avisa de lo que no se ve: que al borrar NO sale ningún correo (cancelar
   * sí lo manda) y que la sesión de un bono vuelve a quedar libre. El error del
   * servidor se enseña con `avisar` y no en `formError`, que solo se pinta en el
   * alta: la negativa por tener dinero de por medio hay que poder leerla.
   */
  async function deleteBooking() {
    const futura = new Date(openBooking.scheduledAt).getTime() > Date.now();
    const letraPequena = [];
    if (futura && openBooking.status !== "cancelled") {
      letraPequena.push("Aún no ha pasado y al borrarla NO se avisa a nadie. Si quieres que se entere, cancélala antes.");
    }
    if (openBooking.sessionNumber > 0) {
      letraPequena.push(`Es la sesión ${openBooking.sessionNumber} de un bono: esa sesión le vuelve a quedar libre.`);
    }
    const seguro = await confirmar({
      titulo: "Borrar la cita",
      texto: ["Desaparece del calendario y del historial. No se puede deshacer.", ...letraPequena].join("\n\n"),
      confirmar: "Borrar",
      tono: "peligro",
    });
    if (!seguro) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/citas/bookings/${openBooking.id}?hard=true`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "No se ha podido borrar la cita");
      }
      onDeleted();
    } catch (err) {
      // Antes del aviso: `avisar` no resuelve hasta que lo cierran, y hasta
      // entonces la tarjeta de la cita se quedaría con todo deshabilitado.
      setSaving(false);
      await avisar({ titulo: "La cita sigue ahí", texto: err.message });
    } finally {
      setSaving(false);
    }
  }

  // Qué ficha se puede abrir desde esta cita, o nada. La regla y su porqué
  // viven en lib/citas/fichaDeLaCita.js, con su prueba.
  const ficha = fichaDeLaCita(openBooking, { conClientes, vocabulario });

  return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-neutral-900 truncate">
                  {openBooking.clientName}
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  {/* El estado con el que se TRATA la cita: una confirmada que
                      ya terminó se da por asistida (lib/citas/asistencia.js).
                      Abajo, junto a los botones, se dice que es una suposición. */}
                  <StatusChip value={estadoEfectivo(openBooking)} />
                  <PagoChip
                    estado={openBooking.paymentStatus}
                    motivoCancelacion={openBooking.cancellationReason}
                    amount={openBooking.amount}
                    caducaEn={openBooking.authorizationExpiresAt}
                  />
                  <ModalityChip value={openBooking.modality} />
                  {openBooking.eventType && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
                      <span className="w-2 h-2 rounded-full" style={{ background: openBooking.eventType.color ?? "#3F6E5B" }} />
                      {openBooking.eventType.name}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-neutral-400 hover:text-neutral-700 p-0.5"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 text-[13px]">
                {/*
                  DE LA CITA A LA FICHA (27/08/2026, Jorge).

                  La pregunta era si aquí había que enseñar un resumen de la
                  última sesión. La respuesta fue que no: basta un botón. Y no
                  cuelga del PACIENTE —como el «Ver ficha» de más abajo, que solo
                  sale con módulo de pacientes y con la cita enlazada a uno— sino
                  del CLIENTE, que es quien la cita trae siempre. En un centro
                  clínico lleva a la familia (bonos, facturas, documentos) y en
                  una consulta de nutrición, a la ficha de la paciente: la misma
                  persona, y hasta hoy la única agenda sin ningún botón.

                  Pestaña nueva a propósito, como los otros dos: el modal lleva
                  cambios sin guardar (el enlace de Meet, las notas) que un salto
                  en la misma pestaña se llevaría por delante.
                */}
                {ficha && (
                  <div className="flex items-center">
                    <span className="w-24 text-neutral-400 shrink-0">{ficha.rotulo}</span>
                    <a
                      href={ficha.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Abre la ficha de ${openBooking.clientName || "esta persona"} en una pestaña nueva`}
                      className="text-[12px] px-2 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-800 transition-colors"
                    >
                      Ver ficha
                    </a>
                  </div>
                )}
                <div className="flex">
                  <span className="w-24 text-neutral-400">Email</span>
                  <a className="text-neutral-800 hover:underline" href={`mailto:${openBooking.clientEmail}`}>
                    {openBooking.clientEmail}
                  </a>
                </div>
                <div className="flex">
                  <span className="w-24 text-neutral-400">Teléfono</span>
                  <a className="text-neutral-800 hover:underline" href={`tel:${openBooking.clientPhone}`}>
                    {openBooking.clientPhone}
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 text-[13px] pt-3 border-t border-neutral-100">
                <div className="flex">
                  <span className="w-24 text-neutral-400">Fecha</span>
                  <span className="text-neutral-800">{fmtDateTime(openBooking.scheduledAt)}</span>
                </div>
                <div className="flex">
                  <span className="w-24 text-neutral-400">Duración</span>
                  <span className="text-neutral-800">{openBooking.duration} min</span>
                </div>
                {/* Qué implica el estado del cobro para lo que ella va a hacer.
                    Enseñar solo la etiqueta obligaría a saberse las reglas de
                    memoria; lo que necesita es la consecuencia. */}
                {openBooking.paymentStatus === "pending" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      Todavía sin pagar. Si no completa el pago, el hueco se libera solo.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "authorizing" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      Está introduciendo su tarjeta ahora mismo. Si lo deja a medias, el hueco se
                      libera solo.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "authorized" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      El importe está <b className="text-neutral-700">reservado</b> en su tarjeta,
                      pero <b className="text-neutral-700">todavía no cobrado</b>. Se le cobrará en
                      cuanto confirmes la cita.
                      {openBooking.authorizationExpiresAt && (
                        <>
                          {" "}
                          La reserva {cuantoQuedaDeRetencion(openBooking.authorizationExpiresAt)?.texto};
                          después habría que pedirle la tarjeta otra vez.
                        </>
                      )}
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "capturing" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">Cobrándose ahora mismo…</span>
                  </div>
                )}
                {openBooking.paymentStatus === "paid" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      Cobrada. Si la cancelas tú, se le devuelve el importe íntegro.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "refunded" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">Importe ya devuelto al paciente.</span>
                  </div>
                )}
                {openBooking.paymentStatus === "void" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      No hay nada reservado en su tarjeta: se liberó o caducó.{" "}
                      <b className="text-neutral-700">No se le ha cobrado nada.</b> Puedes confirmar
                      la cita igualmente y cobrarle en consulta.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "failed" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      {/* Dos historias distintas bajo el mismo 'failed'. El motivo real
                          ya está escrito en la cita; si no lo reconocemos, texto neutro:
                          al banco no se le culpa por defecto. */}
                      {pagoQuedoSinCompletar(openBooking.cancellationReason)
                        ? "No llegó a completar el pago (no es que se lo rechazara el banco), así que "
                        : "El cobro no se completó y "}
                      <b className="text-neutral-700">no se le ha cobrado nada</b>. Puedes
                      reintentarlo, pedirle otra tarjeta o confirmar y cobrar en consulta.
                    </span>
                  </div>
                )}
                {openBooking.modality === "presencial" && openBooking.eventType?.location && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Dirección</span>
                    <span className="text-neutral-800">{openBooking.eventType.location}</span>
                  </div>
                )}
                {openBooking.modality === "phone" && openBooking.eventType?.phoneNumber && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Teléfono</span>
                    <span className="text-neutral-800">{openBooking.eventType.phoneNumber}</span>
                  </div>
                )}
                {teamMembers.length > 0 && (
                  <div className="flex items-center">
                    <span className="w-24 text-neutral-400">Profesional</span>
                    <select
                      value={openBooking.teamMemberId ?? ""}
                      onChange={(e) => assignTeamMember(e.target.value)}
                      disabled={saving}
                      className="flex-1 text-[13px] px-2 py-1 border border-neutral-200 rounded-md bg-white text-neutral-800 disabled:opacity-50"
                    >
                      <option value="">Sin asignar</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>{m.displayName}</option>
                      ))}
                    </select>
                  </div>
                )}
                {patients.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-neutral-400 shrink-0">Paciente</span>
                    {/*
                      UN BUSCADOR, NO UN DESPLEGABLE (01/09/2026, Rodrigo).

                      Aquí se elegía sobre `patients`, la lista que el padre se
                      baja de `/api/pacientes` — y ese endpoint corta en 300.
                      Con los 1.174 pacientes de Aumenta, 874 NO estaban en el
                      desplegable: no salir se lee exactamente igual que no
                      existir, así que la cita se quedaba sin paciente o se le
                      colgaba el que sí aparecía. Es el mismo agujero que se
                      tapó en el alta de citas (28/08) y en las incidencias del
                      equipo (31/08); esta ficha se había quedado atrás.

                      Ahora se pregunta al SERVIDOR según se escribe, o sea que
                      llega a todos. `patients` se queda solo de PUERTA: si el
                      centro no lleva pacientes, la fila ni se pinta.
                    */}
                    <div className="flex-1 min-w-[11rem]">
                      <SelectorPaciente
                        /*
                          La `key` no es adorno: el selector guarda la función
                          de buscar en una ref y solo repregunta cuando cambia
                          lo TECLEADO, así que al darle al interruptor la lista
                          se quedaba con los resultados del ámbito anterior —
                          decía «solo esta familia» enseñando los 1.174 del
                          centro. Cambiar la key lo remonta y vuelve a
                          preguntar con el ámbito nuevo.
                        */
                        key={pacienteEnTodos ? "todos" : "familia"}
                        value={openBooking.patientId ?? ""}
                        familia={pacienteEnTodos ? null : openBooking.clientId || null}
                        onChange={(v) => assignPatient(v)}
                        disabled={saving}
                        aria-label="Paciente de la cita"
                        placeholder="Sin asignar"
                        // Poder volver a «ninguno»: una cita de la familia sin
                        // atribuir a un hijo concreto es un caso real.
                        opcionesFijas={[{ value: "", label: "Sin asignar" }]}
                        className="text-[13px] px-2 py-1 border border-neutral-200 rounded-md bg-white text-neutral-800"
                      />
                    </div>
                    {/*
                      LA SALIDA DEL ACOTADO. Con la familia puesta se enseñan
                      SUS hijos, que es lo que se busca casi siempre y ahorra
                      teclear. Pero acotar sin salida crea un callejón: si esa
                      ficha no tiene pacientes colgados, o la cita se enlazó a
                      la familia equivocada, no habría forma de asignar a nadie
                      —y eso sería peor que el desplegable que quitamos—. De ahí
                      el interruptor.
                    */}
                    {openBooking.clientId && (
                      <button
                        type="button"
                        onClick={() => setPacienteEnTodos((v) => !v)}
                        title={
                          pacienteEnTodos
                            ? "Volver a enseñar solo los pacientes de esta familia"
                            : "Buscar entre todos los pacientes del centro, no solo los de esta familia"
                        }
                        className="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
                      >
                        {pacienteEnTodos ? "solo esta familia" : "buscar en todos"}
                      </button>
                    )}
                    {/*
                      DE LA CITA A LO CLÍNICO (26/08/2026, Jorge y Aumenta).

                      Este modal enseñaba todo lo de la cita —quién viene, la
                      hora, el cobro, las notas— y ni una línea de lo clínico.
                      Para escribir la sesión del día había que cerrarlo, cruzar
                      el menú, teclear el nombre del paciente y abrir su ficha:
                      siete clics y una búsqueda a mano, por sesión.

                      La cita ya trae el paciente cargado, así que los dos
                      enlaces son pintar un dato que ya viaja. Abren en pestaña
                      nueva a propósito: quien mira la agenda no quiere perderla,
                      y el modal lleva cambios sin guardar (el enlace de Meet,
                      las notas) que un salto en la misma pestaña se llevaría.

                      «Preparar sesión» lleva la FECHA de la cita, no solo el
                      paciente: preparar la del jueves y que la sesión nazca con
                      la fecha de hoy sería apuntarla en el sitio equivocado, y
                      nadie lo miraría al corregirlo.

                      Y desde el 01/09/2026 lleva también la CITA (Rodrigo):
                      «si salgo y entro no me tiene que generar una sesión
                      nueva, tiene que seguir editando la misma hasta que le dé
                      a finalizar». Sin ese id, cada vuelta abría un formulario
                      en blanco y guardarlo creaba otra sesión del mismo día.
                    */}
                    {openBooking.patientId && (
                      <>
                        <a
                          href={`/pacientes/${openBooking.patientId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abre la ficha del paciente en una pestaña nueva"
                          className="shrink-0 text-[12px] px-2 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-800 transition-colors"
                        >
                          Ver ficha
                        </a>
                        <a
                          href={`/pacientes/${openBooking.patientId}/sesiones/nueva${colaDePreparacion(openBooking.scheduledAt, { bookingId: openBooking.id })}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={
                            sesionDeEstaCita
                              ? "Sigue con el registro que ya empezaste para esta cita. No se crea uno nuevo."
                              : "Escribe la preparación de esta sesión antes de darla. Se guarda como borrador con el día y la hora de la cita."
                          }
                          className="shrink-0 text-[12px] px-2 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-800 transition-colors"
                        >
                          {sesionDeEstaCita ? "Seguir con la sesión" : "Preparar sesión"}
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Enlace Meet editable — solo citas online */}
              {openBooking.modality === "online" && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Enlace de videollamada (Meet)</div>
                  <input
                    type="url"
                    value={detailMeet}
                    onChange={(e) => setDetailMeet(e.target.value)}
                    placeholder="Pega aquí el link de Google Meet cuando lo tengas"
                    className={inputCls}
                  />
                  <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                    <span
                      className={`text-[11px] ${
                        meetAviso && meetAviso !== "enviado" ? "text-amber-700" : "text-neutral-400"
                      }`}
                    >
                      {meetAviso === "enviado"
                        ? "✓ Enlace enviado por email al cliente."
                        : meetAviso === "sin_configurar"
                          ? "Enlace guardado, pero NO se ha enviado: falta configurar el correo en Configuración → Correo. Mándaselo tú mientras tanto."
                          : meetAviso === "sin_consentimiento"
                            ? "Enlace guardado. No se envía porque este cliente ha pedido no recibir avisos por email."
                            : meetAviso === "error"
                              ? "Enlace guardado, pero el envío del email ha fallado. Mándaselo tú y avisa a soporte."
                              : meetAviso === "guardado"
                                ? "Enlace guardado (no se envió: revisa que la cita sea online y no esté cancelada)."
                                : "«Guardar y enviar» manda el enlace por email, aunque ya lo hubieras guardado antes."}
                    </span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => saveMeet(false)}
                        disabled={saving || detailMeet.trim() === (openBooking.meetUrl ?? "")}
                        className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => saveMeet(true)}
                        disabled={saving || !detailMeet.trim()}
                        className="text-[11px] px-2.5 py-1 rounded font-semibold text-white disabled:opacity-50"
                        style={{ background: "var(--color-primary, #1B3A2D)" }}
                      >
                        Guardar y enviar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Avisar al cliente ────────────────────────────────────────
                  Para todo lo que no es un cambio de la cita: «tráete los
                  análisis», «cierro en agosto», «te llamo mañana». Sale por
                  correo Y queda publicado en su área privada, que es donde
                  puede volver a mirarlo en enero. */}
              {openBooking.clientEmail && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[11px] uppercase tracking-wider text-neutral-400">
                      Avisar al cliente
                    </div>
                    {!avisoAbierto && (
                      <button
                        onClick={() => { setAvisoAbierto(true); setAvisoResultado(null); }}
                        className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                      >
                        Escribir un aviso
                      </button>
                    )}
                  </div>

                  {avisoResultado && (
                    <div
                      className={`mt-2 text-[11px] ${
                        avisoResultado.ok ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {avisoResultado.texto}
                    </div>
                  )}

                  {avisoAbierto && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={avisoTitulo}
                        onChange={(e) => setAvisoTitulo(e.target.value)}
                        placeholder="Asunto (p. ej. «Trae los análisis a la próxima»)"
                        maxLength={160}
                        className={inputCls}
                      />
                      <textarea
                        value={avisoCuerpo}
                        onChange={(e) => setAvisoCuerpo(e.target.value)}
                        placeholder="Lo que quieras contarle. Lo verá en su área privada y le llegará por email."
                        maxLength={4000}
                        className={`${inputCls} min-h-[80px]`}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => { setAvisoAbierto(false); setAvisoTitulo(""); setAvisoCuerpo(""); }}
                          className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={enviarAviso}
                          disabled={enviandoAviso || !avisoTitulo.trim() || !avisoCuerpo.trim()}
                          className="text-[11px] px-2.5 py-1 rounded font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--color-primary, #1B3A2D)" }}
                        >
                          {enviandoAviso ? "Enviando…" : "Enviar aviso"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {openBooking.additionalData && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">
                    {openBooking.eventType?.additionalDataLabel || "Información adicional"}
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-md px-3 py-2 text-[13px] text-neutral-700 whitespace-pre-wrap">
                    {openBooking.additionalData}
                  </div>
                </div>
              )}

              {/* Respuestas del formulario del tipo de cita (04/08/2026). Se
                  enseña el ENUNCIADO guardado con la respuesta, no el de la
                  pregunta actual: si la profesional reformuló la pregunta
                  después, lo que se leyó ese día fue lo otro. */}
              {Array.isArray(openBooking.formAnswers?.respuestas) &&
                openBooking.formAnswers.respuestas.length > 0 && (
                  <div className="pt-3 border-t border-neutral-100">
                    <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1.5">
                      Antes de la cita
                    </div>
                    <div className="space-y-2">
                      {openBooking.formAnswers.respuestas.map((r) => (
                        <div key={r.id}>
                          <div className="text-[11px] text-neutral-500">{r.label}</div>
                          <div className="text-[13px] text-neutral-800 whitespace-pre-wrap">
                            {r.valor === "" || r.valor == null ? "—" : String(r.valor)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Bono de sesiones: por dónde va esta persona. */}
              {openBooking.sessionNumber > 0 && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Bono</div>
                  <div className="text-[13px] text-neutral-800">
                    Sesión {openBooking.sessionNumber}
                    {Number(openBooking.eventType?.sessionsCount) > 1
                      ? ` de ${openBooking.eventType.sessionsCount}`
                      : ""}
                  </div>
                </div>
              )}

              {/*
                Fecha y hora a mano (07/08/2026, Rodrigo): «me gustaría poder
                editar la hora exacta y fecha de una cita en su card, no solo
                poder moverlas físicamente en el calendario».

                Arrastrar sirve para correr media hora dentro de la semana que
                se está viendo; para pasarla a otro mes hay que ir buscándola, y
                para dejarla a las 10:05 no hay forma. Es el mismo guardado que
                el arrastre, así que respeta igual los solapes y los bloqueos.
              */}
              <div className="pt-3 border-t border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1.5">Fecha y hora</div>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    type="date"
                    value={detailFecha}
                    onChange={(e) => setDetailFecha(e.target.value)}
                    className={`${inputCls} flex-1 min-w-[9rem]`}
                  />
                  <input
                    type="time"
                    value={detailHora}
                    onChange={(e) => setDetailHora(e.target.value)}
                    className={`${inputCls} w-28`}
                  />
                  <button
                    onClick={guardarFechaHora}
                    disabled={
                      saving ||
                      (detailFecha === fechaMadrid(openBooking.scheduledAt) &&
                        detailHora === horaMadrid(openBooking.scheduledAt))
                    }
                    className="text-[11px] px-2.5 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 shrink-0"
                  >
                    {saving ? "Guardando…" : "Cambiar hora"}
                  </button>
                </div>
                <p className="text-[10px] text-neutral-400 mt-1">Hora de Madrid, como en el calendario.</p>
                {avisoHora && (
                  <p className={`text-[11px] mt-1 ${avisoHora.tono === "ok" ? "text-emerald-700" : "text-amber-700"}`}>
                    {avisoHora.texto}
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Notas internas</div>
                <textarea
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder="Notas internas (no visibles para el cliente)"
                  className={`${inputCls} min-h-[70px]`}
                />
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={saveNotes}
                    disabled={saving || detailNotes.trim() === (openBooking.notes ?? "")}
                    className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Guardar notas
                  </button>
                </div>
              </div>
            </div>

            {suggestOpen && (
              <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/60">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">🦎 Proponer horarios (IA)</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => loadSuggestions("professional")} disabled={!openBooking.teamMemberId} title={!openBooking.teamMemberId ? "La cita no tiene profesional" : ""}
                      className={`text-[11px] px-2 py-0.5 rounded-full border disabled:opacity-40 ${suggestScope === "professional" ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-white"}`}
                      style={suggestScope === "professional" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Este profesional</button>
                    {viewerIsAdmin && (
                      <button onClick={() => loadSuggestions("company")}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${suggestScope === "company" ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-white"}`}
                        style={suggestScope === "company" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Todo el centro</button>
                    )}
                    <button onClick={() => setSuggestOpen(false)} className="text-neutral-400 hover:text-neutral-700 px-1" aria-label="Cerrar">✕</button>
                  </div>
                </div>
                {!viewerIsAdmin && (
                  <p className="text-[11px] text-neutral-400 mb-2">Elige un horario y se lo mandas al centro para que lo confirme.</p>
                )}
                {suggestLoading ? (
                  <p className="text-[12px] text-neutral-400 py-2">Buscando huecos…</p>
                ) : suggestErr ? (
                  <p className="text-[12px] text-rose-600 py-2">{suggestErr}</p>
                ) : suggestSent ? (
                  <p className="text-[12px] text-emerald-600 py-2">✓ {suggestSent}</p>
                ) : suggestions.length === 0 ? (
                  <p className="text-[12px] text-neutral-400 py-2">{suggestNote || "Sin huecos que proponer."}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {suggestions.map((s, i) => (
                      <div key={i} className="bg-white border border-neutral-200 rounded-lg p-2.5 flex flex-col">
                        <div className="text-[12px] font-medium text-neutral-800 capitalize">{s.label}</div>
                        {s.teamMemberName && <div className="text-[11px] text-neutral-500">{s.teamMemberName}</div>}
                        <div className="text-[10px] text-neutral-400 mt-1 flex-1 leading-snug">{s.reason}</div>
                        {viewerIsAdmin ? (
                          <button onClick={() => applySuggestion(s)} disabled={saving} className="mt-2 text-[11px] font-medium px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>Elegir esta</button>
                        ) : (
                          <button onClick={() => sendSuggestionToAdmin(s)} disabled={saving} className="mt-2 text-[11px] font-medium px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>Enviar al centro</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="px-5 py-3 border-t border-neutral-100 flex flex-wrap gap-2 justify-between">
              <div className="flex flex-wrap gap-2">
                {/*
                 * Una cita confirmada que ya terminó SE DA POR ASISTIDA
                 * (01/09/2026, Rodrigo). Aquí se dice con todas las letras que
                 * es una suposición del programa y no algo que comprobara
                 * nadie: si se pintara un «Completada» a secas, «No asistió»
                 * parecería un cambio de opinión en vez de la corrección que
                 * es. El botón verde sigue estando, ahora para dar el visto
                 * bueno de verdad.
                 */}
                {esPresunta(openBooking) ? (
                  <>
                    <span className="text-[12px] px-2.5 py-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                      Se da por asistida
                    </span>
                    <button
                      onClick={markCompleted}
                      disabled={saving}
                      className="text-[12px] px-3 py-1.5 rounded-md border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      Confirmar asistencia
                    </button>
                  </>
                ) : (
                  openBooking.status !== "completed" && (
                    <button
                      onClick={markCompleted}
                      disabled={saving}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Marcar completada
                    </button>
                  )
                )}
                {openBooking.status === "no_show" && (
                  <span className={`text-[12px] px-2.5 py-1.5 rounded-md ${openBooking.noShowJustified ? "bg-neutral-100 text-neutral-600" : "bg-red-50 text-red-700"}`}>
                    {rotuloFalta(openBooking)}
                    {openBooking.noShowReason ? ` · ${openBooking.noShowReason}` : ""}
                  </span>
                )}
                {/*
                 * Las dos faltas, cada una con su botón (01/09/2026, Rodrigo):
                 * «así queda claro cuándo han venido y cuándo no». Antes era un
                 * «No asistió» que abría un diálogo para elegir cuál de las dos
                 * era; la diferencia se decide igual, pero ahora se ve.
                 */}
                {openBooking.status !== "no_show" && (
                  <>
                    <button
                      onClick={() => marcarFalta("falta_justificada")}
                      disabled={saving}
                      title={resultadoPorClave("falta_justificada").ayuda}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      Falta justificada
                    </button>
                    <button
                      onClick={() => marcarFalta("falta_injustificada")}
                      disabled={saving}
                      title={resultadoPorClave("falta_injustificada").ayuda}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      Falta injustificada
                    </button>
                  </>
                )}
                {openBooking.status !== "cancelled" && (
                  <button
                    onClick={cancelBooking}
                    disabled={saving}
                    className="text-[12px] px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    Cancelar cita
                  </button>
                )}
                <button
                  onClick={() => loadSuggestions(openBooking.teamMemberId ? "professional" : "company")}
                  disabled={saving || suggestLoading}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  title="La IA propone 3 huecos para reprogramar esta cita"
                >
                  🦎 Proponer 3 horarios
                </button>
              </div>
              <button
                onClick={deleteBooking}
                disabled={saving}
                title="La quita del calendario y del historial. No se puede deshacer y no se avisa a nadie."
                className="text-[12px] px-3 py-1.5 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>

            {/* Recuperación de la falta (31/08/2026): una recuperable puede
                quedar enlazada a la cita que la recupera. */}
            {esRecuperable(openBooking) && (
              <div className="mt-3 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2.5 text-xs space-y-1.5">
                {openBooking.recoveredByBookingId ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-emerald-700">
                      ✓ Recuperada con la cita{recuperadora ? ` del ${fmtDateTime(recuperadora.scheduledAt)}` : ""}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => patchBooking({ recoveredByBookingId: null })}
                      className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
                    >
                      Quitar enlace
                    </button>
                  </div>
                ) : !openBooking.clientId ? (
                  <span className="text-neutral-400">
                    Sin ficha enlazada no se puede apuntar con qué cita se recupera.
                  </span>
                ) : candidatas === null ? (
                  <span className="text-neutral-400">Buscando citas que puedan recuperarla…</span>
                ) : candidatas.length === 0 ? (
                  <span className="text-neutral-500">
                    Pendiente de recuperar: este cliente no tiene citas posteriores. Crea la cita
                    de recuperación y enlázala desde aquí.
                  </span>
                ) : (
                  <label className="flex items-center gap-2">
                    <span className="text-neutral-500 shrink-0">Recuperada con…</span>
                    <select
                      disabled={saving}
                      defaultValue=""
                      onChange={(e) => e.target.value && patchBooking({ recoveredByBookingId: e.target.value })}
                      className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                    >
                      <option value="">Elegir la cita que la recupera…</option>
                      {candidatas.map((c) => (
                        <option key={c.id} value={c.id}>{fmtDateTime(c.scheduledAt)}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
  );
}
