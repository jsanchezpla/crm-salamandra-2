"use client";

// modules/default/citas/NuevaCitaDrawer.jsx — el alta manual de una cita:
// primero quién (con su bono rellenando tipo y correo), después qué, cuándo y
// con qué profesional. El formulario vive aquí y muere al cerrar; el padre lo
// monta con el hueco pulsado en el calendario (`inicial` = { date, time },
// vacíos si se abre desde el botón) y refresca al crearse (onCreated).

import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import BuscadorPaciente from "../../../components/citas/BuscadorPaciente.jsx";
import SelectorPaciente from "../../../components/citas/SelectorPaciente.jsx";
import { datosAlElegirFicha } from "../../../lib/clients/contactoDeFicha.js";
import { MODALITY_LABELS, inputCls } from "./chips.jsx";

const EMPTY_BOOKING_FORM = {
  eventTypeId: "",
  date: "",
  time: "",
  clientId: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  modality: "",
  additionalData: "",
  notes: "",
  patientId: "",
  teamMemberId: "",
};

export function NuevaCitaDrawer({
  inicial,
  eventTypes,
  teamMembers,
  patients,
  confirmar,
  avisar,
  onClose,
  onCreated,
}) {
  const [createForm, setCreateForm] = useState({
    ...EMPTY_BOOKING_FORM,
    date: inicial.date,
    time: inicial.time,
  });
  // El bono de quien se acaba de elegir en el alta manual: `{ tono, texto,
  // eventTypeId }`. Ver `buscarBono`.
  const [bonoAviso, setBonoAviso] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const selectedEventType = useMemo(() => {
    return eventTypes.find((e) => e.id === createForm.eventTypeId) ?? null;
  }, [eventTypes, createForm.eventTypeId]);

  /*
   * ── SI SOLO HAY UNA MODALIDAD, NO SE PREGUNTA (28/08/2026) ────────────────
   *
   * Lau, de Aumenta: «me pide seleccionar modalidad pero solo sale la modalidad
   * online». Los 57 tipos del centro están en `["online"]`, así que la pantalla
   * pintaba UN radio sin marcar y, si no lo pulsabas, el envío moría con
   * «Selecciona modalidad». Una pregunta con una sola respuesta posible.
   *
   * Se hace en un efecto y no dentro de `updateCreateForm` a propósito: la
   * modalidad se vacía desde TRES sitios (al cambiar de tipo, al romperse el
   * enlace con el bono, y al abrir el cajón), y ponerlo en el reductor obligaba
   * a acordarse en los tres. Aquí se rellena venga el hueco de donde venga.
   *
   * Solo actúa si está vacía y si hay exactamente una: no pisa nunca una
   * elección de la persona, y con dos o más sigue preguntando como siempre.
   *
   * ⚠️ Esto NO arregla el problema de Lau, solo el ruido. Que sus citas puedan
   * ser presenciales es un cambio de datos —los 57 tipos—, no de pantalla:
   * `scripts/marcar-tipos-cita-presenciales.js`.
   */
  useEffect(() => {
    const unica = selectedEventType?.modalities?.length === 1 ? selectedEventType.modalities[0] : null;
    if (!unica) return;
    setCreateForm((prev) => (prev.modality ? prev : { ...prev, modality: unica }));
  }, [selectedEventType]);

  /*
   * ── EL TECHO DE LOS 300 PACIENTES (28/08/2026) ────────────────────────────
   *
   * `patients` venía del padre, que pedía `/api/pacientes` sin más: ese endpoint
   * corta en 300 por diseño y Aumenta tiene 1.174. O sea que 874 pacientes —el
   * 74%— no estaban en el desplegable, y escribir su nombre contestaba «Sin
   * opciones»: exactamente lo mismo que contesta cuando ese paciente no existe.
   *
   * Aquí vivía una tapa parcial: se pedían los pacientes de la familia elegida y
   * se sumaban a los 300. Servía para el camino normal, pero entrar por el
   * desplegable sin familia seguía llegando solo a 300.
   *
   * Ya no hace falta ninguna de las dos cosas: `SelectorPaciente` pregunta al
   * servidor según se escribe, acota por familia cuando hay una elegida, y trae
   * por su id al que venga ya elegido. Lo que antes había que remendar aquí
   * ahora lo sabe la pieza. `patients` se queda SOLO como puerta del módulo
   * («¿este centro tiene pacientes?»), no como lista de la que elegir.
   */

  /**
   * Trae un paciente por su id. Lo necesita la caja de la familia cuando el
   * hijo es único: de ahí solo llega `{id, nombre}`, y para poner su terapeuta
   * hace falta la ficha entera. Antes se buscaba en la lista de 300 — y si el
   * paciente no estaba, la cita nacía sin profesional y sin que nadie lo dijera.
   */
  const traerPaciente = useCallback(async (idPaciente) => {
    try {
      const r = await fetch(`/api/pacientes/${idPaciente}`, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json())?.data ?? null;
    } catch {
      return null;
    }
  }, []);

  /**
   * @param objeto la fila entera cuando el campo la tiene detrás (hoy solo el
   *   paciente). Se pasa en vez de buscarla en una lista descargada, que es
   *   justo lo que no se puede hacer cuando hay más de las que caben.
   */
  function updateCreateForm(field, value, objeto = null) {
    // Al cambiar de tipo de cita (arreglo 2026-07-23): si la modalidad elegida
    // ya no la ofrece el tipo nuevo, se limpia. Antes quedaba una modalidad
    // huérfana (p. ej. 'online') que colaba la validación cliente y el servidor
    // rechazaba con un error confuso.
    if (field === "eventTypeId") {
      const nuevoTipo = eventTypes.find((e) => e.id === value);
      setCreateForm((prev) => {
        const modalidadValida = nuevoTipo?.modalities?.includes(prev.modality);
        return { ...prev, eventTypeId: value, modality: modalidadValida ? prev.modality : "" };
      });
      return;
    }
    // Al elegir paciente, PRIMA su terapeuta asignado como profesional de la cita
    // (Rodrigo: la reserva pública es general y el terapeuta se decide en el CRM,
    // primando el asignado al paciente). Si el paciente no tiene terapeuta, se
    // conserva el profesional que hubiera. El usuario siempre puede cambiarlo.
    //
    /*
     * ── Y ARRASTRA A SU FAMILIA, CON SU CONTACTO (28/08/2026) ───────────────
     *
     * Lau, de Aumenta: «al generar una cita siempre me pide mail y teléfono …
     * no me sale de forma automática, es difícil en pacientes que ya están
     * registrados, me tengo que salir, buscar esa info, anotarla a lápiz y
     * papel y luego hacer la cita».
     *
     * Rodrigo daba por hecho que ya pasaba —«puedes seleccionar un paciente y
     * automáticamente te salen los datos de contacto»— y llevaba razón a
     * medias: el autorrelleno existía desde julio, pero colgaba de elegir la
     * FAMILIA en la caja de arriba. Este desplegable solo ponía el terapeuta, y
     * no podía hacer más: `Patient` no tiene ni correo ni teléfono. Ahora la
     * familia viaja con cada paciente (`app/api/pacientes/route.js`), que es lo
     * que decidió Jorge: «cada paciente está asociado a una familia, así que
     * solo eligiendo el paciente el resto de datos tendrían que salir
     * automáticos».
     *
     * Qué se rellena y qué se respeta lo decide `datosAlElegirFicha`
     * (`lib/clients/contactoDeFicha.js`), la MISMA regla que usa la caja de
     * arriba: al cambiar de familia el contacto se reemplaza entero —aunque
     * venga vacío—, y dentro de la misma familia se respeta lo tecleado a mano
     * en los huecos que la ficha deja.
     */
    if (field === "patientId") {
      // El paciente llega ENTERO desde el selector, que lo acaba de traer del
      // servidor. Antes se buscaba en la lista de 300 que bajaba el padre, así
      // que para 874 de los 1.174 de Aumenta esto no encontraba nada: la cita
      // se creaba sin terapeuta y sin los datos de su familia, en silencio.
      const p = objeto ?? null;
      const terapeuta = p?.mainTherapistId ?? p?.therapistId ?? null;
      const familia = p?.client ?? null;
      setCreateForm((prev) => ({
        ...prev,
        patientId: value,
        teamMemberId: terapeuta ?? prev.teamMemberId,
        ...datosAlElegirFicha(prev, familia),
      }));
      // El bono de esa familia pone el tipo de cita solo, igual que al elegirla
      // en la caja de arriba (13/08/2026, Rodrigo). Antes, llegar por el
      // paciente se lo saltaba.
      //
      // Solo se busca cuando hay familia. Volver a «Sin paciente asignado» no
      // toca el cartel del bono: la familia sigue elegida arriba y su bono
      // sigue siendo verdad.
      if (familia) buscarBono(familia);
      return;
    }
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  }

  /*
   * ── EL BONO PONE EL TIPO DE CITA (13/08/2026, Rodrigo) ────────────────────
   *
   * «Si tiene un bono asignado, cuando se pone el paciente en la cita manual
   * directamente el tipo de cita se pone con el bono, así no hay que ir a
   * buscarlo a la ficha.» Quien tiene un bono viene SIEMPRE a lo mismo, y con
   * 57 tipos de cita en la lista elegir el que no es se paga caro: la cita no
   * descuenta del bono y hay que rehacerla.
   *
   * Solo se pone solo si el campo está vacío. Si ya hay un tipo elegido y el del
   * bono es otro, no se pisa lo que ha escrito una persona: se ofrece.
   */
  function ponerTipoDelBono(eventTypeId) {
    updateCreateForm("eventTypeId", eventTypeId);
  }

  async function buscarBono(cliente) {
    setBonoAviso(null);
    if (!cliente?.id && !cliente?.email) return;
    try {
      const params = new URLSearchParams();
      if (cliente.id) params.set("clientId", cliente.id);
      if (cliente.email) params.set("email", cliente.email);
      const r = await fetch(`/api/citas/packs?${params.toString()}`, { cache: "no-store" });
      const j = await r.json();
      const bonos = j?.ok ? (j.data?.bonos ?? []) : [];
      if (!bonos.length) return;

      // Con varios bonos vivos no se adivina: se enseñan y elige la persona.
      if (bonos.length > 1) {
        setBonoAviso({
          tono: "aviso",
          eventTypeId: null,
          texto: `Tiene ${bonos.length} bonos activos (${bonos
            .map((b) => `«${b.nombre}», le quedan ${b.restantes}`)
            .join(" · ")}). Elige tú el tipo de cita.`,
        });
        return;
      }

      const bono = bonos[0];
      const yaHayOtroTipo = Boolean(createForm.eventTypeId) && createForm.eventTypeId !== bono.eventTypeId;
      if (!yaHayOtroTipo) ponerTipoDelBono(bono.eventTypeId);

      /*
       * ⚠️ El bono va atado al CORREO (ver `lib/citas/packs.js`): la cita se
       * engancha buscando el bono por el correo con el que se crea. Si el de la
       * ficha es otro —hay bonos dados al correo del portal—, la cita se crearía
       * con el tipo correcto y AUN ASÍ no descontaría. Es el fallo mudo de los
       * bonos, y aquí se puede decir a tiempo.
       */
      const correoCita = (cliente.email || createForm.clientEmail || "").trim().toLowerCase();
      const correoBono = (bono.correo || "").trim().toLowerCase();
      const cuenta = `le quedan ${bono.restantes} de ${bono.total}`;

      // Ficha sin correo y bono con él: se pone el del bono. Sin correo la cita
      // ni se puede crear, y ese es justo el que hace que descuente.
      const correoPuesto = Boolean(correoBono) && !correoCita;
      if (correoPuesto) setCreateForm((prev) => ({ ...prev, clientEmail: correoBono }));

      if (correoBono && correoCita && correoBono !== correoCita) {
        setBonoAviso({
          tono: "aviso",
          eventTypeId: bono.eventTypeId,
          ofrecer: yaHayOtroTipo,
          texto: `Su bono «${bono.nombre}» (${cuenta}) está a nombre de ${correoBono} y la cita va a ${correoCita}: así NO descontará del bono. Cambia el correo de la cita si quieres que cuente.`,
        });
        return;
      }

      let texto;
      if (!yaHayOtroTipo && correoPuesto) texto = `Tipo y correo puestos por su bono «${bono.nombre}»: ${cuenta}.`;
      else if (!yaHayOtroTipo) texto = `Tipo puesto por su bono «${bono.nombre}»: ${cuenta}.`;
      else if (correoPuesto) texto = `Correo puesto por su bono «${bono.nombre}»: ${cuenta}. El tipo elegido no es el del bono.`;
      else texto = `Tiene bono de «${bono.nombre}» y ${cuenta}, pero el tipo elegido es otro.`;

      setBonoAviso({
        tono: yaHayOtroTipo ? "aviso" : "bono",
        eventTypeId: bono.eventTypeId,
        ofrecer: yaHayOtroTipo,
        texto,
      });
    } catch {
      // Sin bonos que enseñar la cita se apunta igual: esto ayuda, no manda.
    }
  }

  /** Se rompe el enlace con la ficha → el bono deja de aplicar. */
  function olvidarBono() {
    if (bonoAviso?.eventTypeId && createForm.eventTypeId === bonoAviso.eventTypeId) {
      setCreateForm((prev) => ({ ...prev, eventTypeId: "", modality: "" }));
    }
    setBonoAviso(null);
  }

  async function submitCreate() {
    setFormError(null);
    if (!createForm.eventTypeId) { setFormError("Selecciona tipo de cita"); return; }
    if (!createForm.date || !createForm.time) { setFormError("Fecha y hora son obligatorias"); return; }
    if (!createForm.clientName.trim()) { setFormError("Nombre del cliente obligatorio"); return; }
    if (!createForm.clientEmail.trim()) { setFormError("Email del cliente obligatorio"); return; }
    if (!createForm.clientPhone.trim()) { setFormError("Teléfono del cliente obligatorio"); return; }
    // Solo si hay equipo del que elegir: sin módulo `team` el campo ni se pinta.
    if (teamMembers.length > 0 && !createForm.teamMemberId) {
      setFormError("Elige el profesional que la atiende");
      return;
    }
    if (!createForm.modality) { setFormError("Selecciona modalidad"); return; }

    setSaving(true);
    try {
      const scheduledAt = new Date(`${createForm.date}T${createForm.time}`).toISOString();
      const enviar = (insistir) =>
        fetch("/api/citas/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventTypeId: createForm.eventTypeId,
            scheduledAt,
            clientId: createForm.clientId || null,
            clientName: createForm.clientName.trim(),
            clientEmail: createForm.clientEmail.trim(),
            clientPhone: createForm.clientPhone.trim(),
            modality: createForm.modality,
            additionalData: createForm.additionalData.trim() || null,
            notes: createForm.notes.trim() || null,
            patientId: createForm.patientId || null,
            teamMemberId: createForm.teamMemberId || null,
            /*
             * Las DOS puertas que avisan pero no imponen: el festivo del centro
             * y el tramo de vacaciones (07/08/2026). Antes solo se reenviaba
             * `permitirFestivo`, así que al chocar con unas vacaciones el aviso
             * volvía a salir una y otra vez y la cita no se llegaba a crear.
             */
            ...(insistir ? { permitirFestivo: true, permitirBloqueo: true } : {}),
          }),
        });

      let res = await enviar(false);
      let j = await res.json();
      // 409 = el día está cerrado, o alguien está de vacaciones. No se impone:
      // se pregunta, y si insiste (una urgencia en el puente) se reenvía.
      if (res.status === 409 && !j.ok) {
        const crearIgualmente = await confirmar({
          titulo: "Ese hueco está bloqueado",
          texto: j.error,
          confirmar: "Crearla igualmente",
        });
        if (!crearIgualmente) {
          setSaving(false);
          return;
        }
        res = await enviar(true);
        j = await res.json();
      }
      if (!j.ok) throw new Error(j.error || "Error creando cita");
      /*
       * Si el paciente NO ha recibido el correo, se dice aquí y ahora
       * (07/08/2026, Rodrigo). Antes esta cita no mandaba ningún correo; ahora
       * lo manda, pero callarse cuando falla sería peor que no mandarlo: quien
       * la apunta se iría creyendo que el paciente ya lo sabe.
       *
       * Solo se avisa cuando NO sale. Si sale, no hay nada que contar.
       */
      if (j.data && j.data.emailEnviado === false) {
        const porQue = {
          sin_email: "no tiene correo en su ficha",
          sin_consentimiento: "ha pedido no recibir correos",
          sin_configurar: "este cliente no tiene el correo configurado",
          error: "falló el envío",
        }[j.data.emailMotivo] ?? "no se pudo enviar";
        await avisar({
          titulo: "Cita creada, pero sin avisar",
          texto: `Al paciente NO le ha llegado el correo: ${porQue}.\n\nAvísale tú.`,
        });
      }
      // El padre refresca el calendario y cierra el drawer (que muere con
      // su formulario dentro: no hay nada que vaciar).
      onCreated();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
        <div
          className="fixed inset-0 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Nueva cita manual</h2>
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

            <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              {/*
                PRIMERO QUIÉN, DESPUÉS QUÉ (13/08/2026, Rodrigo: «poner en la
                cita manual primero el paciente y segundo el tipo de cita»). El
                formulario empezaba por el tipo, que es el campo que más se
                falla —Aumenta tiene 57— y el único que la ficha de la persona
                puede rellenar sola: eligiéndola antes, su bono pone el tipo (ver
                `buscarBono`) y su terapeuta pone el profesional.
              */}
              <BuscadorPaciente
                etiqueta={patients.length > 0 ? "Cliente (la familia) *" : "Cliente / paciente *"}
                nombre={createForm.clientName}
                vinculadaA={createForm.clientId}
                onEscribir={(texto) => {
                  olvidarBono();
                  setCreateForm((prev) => ({ ...prev, clientName: texto, clientId: "" }));
                }}
                onElegir={(c) => {
                  /*
                   * Si esta familia ha salido porque coincidía UN paciente suyo
                   * (28/08/2026, Lau), ese paciente es de quien es la cita: se
                   * deja elegido. Recepción teclea el nombre del hijo, así que
                   * pedirle que lo vuelva a elegir abajo sobra.
                   *
                   * Con VARIOS hermanos coincidiendo no se elige por ella: ahí
                   * la pregunta es de verdad, y equivocarse pondría la sesión en
                   * el hermano que no es.
                   */
                  const unico = Array.isArray(c.pacientes) && c.pacientes.length === 1 ? c.pacientes[0] : null;
                  /*
                   * El terapeuta se pide DESPUÉS, por su id (28/08/2026). La
                   * familia trae solo `{id, nombre}` de cada hijo, y antes su
                   * terapeuta se buscaba en la lista de 300: para los 874
                   * pacientes que no cabían, la cita nacía sin profesional y sin
                   * decirlo. Va en dos pasos a propósito — los datos de la
                   * familia se pintan YA y el terapeuta cuando llegue, en vez de
                   * dejar el formulario quieto esperando una consulta.
                   */
                  if (unico) {
                    traerPaciente(unico.id).then((p) => {
                      const terapeuta = p?.mainTherapistId ?? p?.therapistId ?? null;
                      if (terapeuta) {
                        setCreateForm((prev) =>
                          prev.patientId === unico.id && !prev.teamMemberId
                            ? { ...prev, teamMemberId: terapeuta }
                            : prev
                        );
                      }
                    });
                  }
                  setCreateForm((prev) => ({
                    ...prev,
                    /*
                     * El contacto lo decide `datosAlElegirFicha`, no un
                     * `c.email || prev` (28/08/2026). Con ese `||`, elegir una
                     * familia con correo y cambiar después a otra sin correo
                     * dejaba puesto el de la primera: la cita de la segunda se
                     * creaba Y SE ENVIABA a la dirección de la otra familia,
                     * con el nombre del hijo dentro, y el campo se veía relleno
                     * y con buena pinta. Con 330 de las 1.083 fichas de Aumenta
                     * sin correo, esa pareja sale todos los días.
                     */
                    ...datosAlElegirFicha(prev, c),
                    ...(unico ? { patientId: unico.id } : {}),
                  }));
                  buscarBono(c);
                }}
                onDesvincular={() => {
                  olvidarBono();
                  setCreateForm((prev) => ({ ...prev, clientId: "" }));
                }}
              />

              {/*
                «Cliente» arriba y «Paciente» aquí NO son lo mismo, y leídos
                seguidos lo parecían (12/08/2026, Rodrigo). En un centro clínico
                el cliente es la familia que paga y el paciente es el hijo que
                viene a la sesión, así que cada campo dice de quién habla. Donde
                no hay módulo de pacientes esta caja ni aparece, y entonces el
                cliente ES el paciente — por eso el rótulo de arriba cambia.
              */}
              {patients.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Paciente</label>
                  {/*
                    Pregunta al SERVIDOR según se escribe (28/08/2026). Antes se
                    elegía sobre la lista que bajaba el padre, cortada en 300:
                    con los 1.174 de Aumenta, 874 pacientes contestaban «Sin
                    opciones», que es lo mismo que contesta cuando no existen.
                    Con familia elegida se acota a los suyos, que es lo que se
                    quiere ver aquí.
                  */}
                  <SelectorPaciente
                    value={createForm.patientId}
                    familia={createForm.clientId || null}
                    onChange={(v, p) => updateCreateForm("patientId", v, p)}
                    placeholder="Sin paciente asignado"
                    // Poder volver a «ninguno»: la cita de la familia sin
                    // atribuir a un hijo concreto es un caso real.
                    opcionesFijas={[{ value: "", label: "Sin paciente asignado" }]}
                  />
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Quién viene a la sesión. Si la familia tiene varios, elige de quién es la cita.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tipo de cita *</label>
                <Select
                  value={createForm.eventTypeId}
                  onChange={(v) => {
                    // Cambiarlo a mano deja sin sentido el cartel del bono.
                    if (bonoAviso?.eventTypeId && v !== bonoAviso.eventTypeId) setBonoAviso(null);
                    updateCreateForm("eventTypeId", v);
                  }}
                  options={[
                    { value: "", label: "— Selecciona —", pinned: true },
                    ...eventTypes.map((e) => ({ value: e.id, label: `${e.name} (${e.duration} min)` })),
                  ]}
                  className={inputCls}
                  /*
                   * SIEMPRE, no a partir de N tipos (12/08/2026, Rodrigo).
                   * Aumenta tiene 57 y encontrar el que toca bajando por la
                   * lista es el trabajo de verdad. Se probó con el umbral del
                   * filtro del calendario (`> 8`) y se descartó: quien apunta
                   * citas todo el día escribe siempre las primeras letras, y
                   * que la caja aparezca o no según el cliente convierte un
                   * gesto automático en algo que hay que mirar antes.
                   */
                  searchable
                />
                {bonoAviso && (
                  <div
                    className={`mt-1.5 text-[11px] leading-snug rounded-md px-2.5 py-1.5 border ${
                      bonoAviso.tono === "aviso"
                        ? "text-amber-800 bg-amber-50 border-amber-100"
                        : "text-emerald-800 bg-emerald-50 border-emerald-100"
                    }`}
                  >
                    {bonoAviso.texto}
                    {bonoAviso.ofrecer && (
                      <button
                        type="button"
                        onClick={() => ponerTipoDelBono(bonoAviso.eventTypeId)}
                        className="ml-1.5 underline underline-offset-2 font-medium"
                      >
                        Poner el del bono
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={createForm.date}
                    onChange={(e) => updateCreateForm("date", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hora</label>
                  <input
                    type="time"
                    value={createForm.time}
                    onChange={(e) => updateCreateForm("time", e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Email</label>
                  <input
                    type="email"
                    value={createForm.clientEmail}
                    onChange={(e) => updateCreateForm("clientEmail", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Teléfono</label>
                  <input
                    type="tel"
                    value={createForm.clientPhone}
                    onChange={(e) => updateCreateForm("clientPhone", e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/*
                El profesional es OBLIGATORIO desde el 12/08/2026 (Rodrigo). Se
                podía apuntar una cita sin nadie que la atendiera, y esas citas
                acaban en la cola de `/citas/sin-profesional`: 1.827 de las
                12.030 que importó Aumenta vinieron así. Solo se exige si hay
                equipo del que elegir — un tenant sin módulo `team` no ve el
                campo y no puede quedarse bloqueado por él.
              */}
              {teamMembers.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Profesional *</label>
                  <Select
                    value={createForm.teamMemberId}
                    onChange={(v) => updateCreateForm("teamMemberId", v)}
                    options={[
                      { value: "", label: "— Selecciona —", pinned: true },
                      ...teamMembers.map((m) => ({ value: m.id, label: m.displayName })),
                    ]}
                    placeholder="— Selecciona —"
                    searchable
                  />
                </div>
              )}

              {selectedEventType && (
                <div>
                  {/* El asterisco no estaba y el campo SÍ es obligatorio (submitCreate
                      corta con «Selecciona modalidad»): se veía opcional y no lo era. */}
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Modalidad *</label>
                  <div className="flex gap-2 flex-wrap">
                    {selectedEventType.modalities.map((m) => (
                      <label key={m} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                        <input
                          type="radio"
                          name="modality"
                          value={m}
                          checked={createForm.modality === m}
                          onChange={(e) => updateCreateForm("modality", e.target.value)}
                        />
                        {MODALITY_LABELS[m] ?? m}
                      </label>
                    ))}
                  </div>
                  {selectedEventType.modalities.length === 1 && (
                    /*
                     * Con una sola modalidad se preselecciona (arriba, en su
                     * efecto) pero NO se hace en silencio, y el motivo importa:
                     *
                     * Aumenta tiene hoy los 57 tipos en «solo online» y es un
                     * error de datos —sus 12.030 citas son presenciales—. Si el
                     * formulario se limitara a marcar «Online» solo y callarse,
                     * dejaría de pedir el clic que hizo quejarse a Lau y el
                     * fallo se volvería invisible: las citas seguirían naciendo
                     * online y los correos seguirían prometiendo videollamada,
                     * pero ya sin nada que lo delatara.
                     *
                     * Así que se dice en voz alta y se dice DÓNDE se arregla.
                     * Para un centro cuyo tipo es de verdad de una sola
                     * modalidad, es información; para uno con los datos mal, es
                     * el hilo del que tirar.
                     */
                    <p className="mt-1.5 text-[11px] text-neutral-500">
                      Este tipo de cita solo admite{" "}
                      <strong className="font-medium">
                        {MODALITY_LABELS[selectedEventType.modalities[0]] ?? selectedEventType.modalities[0]}
                      </strong>
                      . Para ofrecer otras, edítalo en{" "}
                      <a href="/citas/tipos" className="underline hover:no-underline">
                        Tipos de cita
                      </a>
                      .
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                  {selectedEventType?.additionalDataLabel || "Información adicional"}
                </label>
                <textarea
                  value={createForm.additionalData}
                  onChange={(e) => updateCreateForm("additionalData", e.target.value)}
                  rows={3}
                  className={`${inputCls} min-h-[70px]`}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Notas internas</label>
                <textarea
                  value={createForm.notes}
                  onChange={(e) => updateCreateForm("notes", e.target.value)}
                  rows={2}
                  className={`${inputCls} min-h-[60px]`}
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2 shrink-0">
              <button
                onClick={onClose}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                onClick={submitCreate}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Crear cita"}
              </button>
            </div>
          </aside>
        </div>
  );
}
