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
import { repasarContactoDeCita, avisoDeContacto } from "../../../lib/citas/contactoCita.js";
import { CADENCIAS, fechasDeRepeticion } from "../../../lib/citas/recurrencia.js";
import { cobroDelTipo, normalizarCobro, euros } from "../../../lib/citas/dineroDeLaCita.js";
import { inputCls } from "./chips.jsx";

const EMPTY_BOOKING_FORM = {
  eventTypeId: "",
  date: "",
  time: "",
  clientId: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  // Presencial por defecto (Jorge, 28/08/2026): en una consulta se cita en
  // persona salvo excepción, y la excepción se marca con un clic.
  modality: "presencial",
  additionalData: "",
  notes: "",
  patientId: "",
  teamMemberId: "",
  // Repetición (31/08/2026): "" (no se repite) | "semana" | "quincena" | "mes",
  // hasta una fecha inclusive. Materializa citas INDEPENDIENTES, sin serie.
  repetir: "",
  repetirHasta: "",
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
  // Para «Bloqueo» en lo alto del drawer (03/09/2026, Aumenta: «que en el
  // calendario de citas al pulsar pueda elegir cambiar a bloqueo aparte de
  // una cita»): las categorías del centro, si quien mira es dirección y su
  // propia ficha de equipo. Ver `BloqueoRapido`, abajo.
  categoriasBloqueo = [],
  viewerIsAdmin = false,
  miFichaDeEquipo = null,
  // ¿Este centro exige que la cita nazca atada a un dinero? (04/09/2026,
  // Aumenta). Lo decide el servidor; aquí solo cambia si el bloque de cobro se
  // puede dejar en blanco. Ver `lib/citas/dineroDeLaCita.js`.
  exigeCobro = false,
}) {
  const [createForm, setCreateForm] = useState({
    ...EMPTY_BOOKING_FORM,
    date: inicial.date,
    time: inicial.time,
  });
  /*
   * ── CITA O BLOQUEO (03/09/2026) ──────────────────────────────────────────
   * El mismo hueco pulsado sirve para las dos cosas. Arriba del drawer se
   * elige; con «Bloqueo» se cambia el formulario entero por el del tramo
   * bloqueado (mismas fechas), que guarda en /api/citas/bloqueos.
   */
  const [modo, setModo] = useState("cita");
  /*
   * ── EL CORREO AL PACIENTE SE PIDE, NO SALE SOLO (03/09/2026, Aumenta) ────
   * «Revisar que no se envíe automáticamente por correo lo de las citas al
   * paciente, sino que haya que confirmar.» Desde el 07/08 la cita manual
   * mandaba el correo de confirmación siempre; ahora hay una casilla, APAGADA
   * de entrada, y sin marcarla la cita nace callada (`omitirCorreo`).
   */
  const [avisarCorreo, setAvisarCorreo] = useState(false);
  // El bono de quien se acaba de elegir en el alta manual: `{ tono, texto,
  // eventTypeId }`. Ver `buscarBono`.
  const [bonoAviso, setBonoAviso] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const selectedEventType = useMemo(() => {
    return eventTypes.find((e) => e.id === createForm.eventTypeId) ?? null;
  }, [eventTypes, createForm.eventTypeId]);

  /*
   * ── EL DINERO DE LA CITA (04/09/2026, Aumenta por Rodrigo) ────────────────
   *
   * «Para crear una cita tiene que estar asociada a una cuota o a un cobro de
   * texto libre… y nunca se crean citas gratuitas sin quererlo.»
   *
   * `cobro` es lo que se va a mandar: `{ modo, conceptId, texto, importe }`.
   * Empieza puesto con la cuota del TIPO —ese es el punto entero: con 63 tipos
   * y 250 citas al día, elegir el concepto en cada una sería elegir siempre lo
   * mismo— y se puede cambiar a un cobro de texto libre o a «sin coste».
   *
   * `null` mientras no hay tipo elegido, y en los talleres, que no tienen UNA
   * familia a la que cobrar: su dinero va por la inscripción de cada niño.
   */
  const [cobro, setCobro] = useState(null);
  // El catálogo de conceptos, para poder cambiar la cuota. Se pide con
  // `billing`: quien no tenga el módulo recibe 403, la lista queda vacía y solo
  // podrá quedarse con la del tipo, escribir un cobro libre o marcar sin coste.
  const [conceptos, setConceptos] = useState([]);
  useEffect(() => {
    let vivo = true;
    fetch("/api/billing/conceptos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && setConceptos(j?.data?.conceptos ?? []))
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  /*
   * Al cambiar de tipo, el cobro vuelve a lo que diga el tipo nuevo. Es lo que
   * hay que hacer: si estaba puesto «Logopedia 45x1» porque lo traía el tipo
   * anterior, dejarlo al cambiar a «Psicología» apuntaría la cita a la cuota
   * equivocada sin que nadie lo tocara.
   */
  useEffect(() => {
    if (!selectedEventType || selectedEventType.tallerGrupoId) { setCobro(null); return; }
    setCobro(cobroDelTipo(selectedEventType.concepto));
  }, [selectedEventType]);

  /*
   * ── ¿ES UN TALLER? (01/09/2026, Rodrigo) ─────────────────────────────────
   *
   * «Hay que preparar los talleres de tal forma que en las citas se pueda
   * seleccionar los talleres. No como bloqueos sino como un tipo más de cita.»
   *
   * Un taller es un tipo de cita más, pero SIN paciente: van varios, y quiénes
   * son ya está dicho en el grupo. Así que al elegirlo desaparece la mitad de
   * arriba del formulario —familia, paciente, correo y teléfono—, que en un
   * taller no significa nada: no hay UNA familia a la que mandarle nada.
   *
   * El profesional también deja de ser obligatorio: si no se elige, lo lleva
   * quien coordina el grupo (lo resuelve el servidor).
   */
  const esTaller = Boolean(selectedEventType?.tallerGrupoId);
  const hayTalleres = useMemo(() => eventTypes.some((e) => e.tallerGrupoId), [eventTypes]);

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
    // Cambiar de tipo YA NO toca la modalidad (28/08/2026). Antes se limpiaba si
    // el tipo nuevo no la ofrecía, porque el servidor la rechazaba; ahora, en una
    // cita que apunta el propio centro, la modalidad la decide quien la apunta y
    // no el catálogo público. Ver `app/api/citas/bookings/route.js`.
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
      // La modalidad se queda como estaba: ya no depende del tipo de cita.
      setCreateForm((prev) => ({ ...prev, eventTypeId: "" }));
    }
    setBonoAviso(null);
  }

  async function submitCreate() {
    setFormError(null);
    if (!createForm.eventTypeId) { setFormError("Selecciona tipo de cita"); return; }
    if (!createForm.date || !createForm.time) { setFormError("Fecha y hora son obligatorias"); return; }
    // Un taller no tiene cliente: su nombre lo pone el grupo, en el servidor.
    if (!esTaller && !createForm.clientName.trim()) { setFormError("Nombre del cliente obligatorio"); return; }
    // Solo si hay equipo del que elegir: sin módulo `team` el campo ni se pinta.
    // En un taller es opcional: sin elegir a nadie lo lleva quien coordina.
    if (!esTaller && teamMembers.length > 0 && !createForm.teamMemberId) {
      setFormError("Elige el profesional que la atiende");
      return;
    }
    if (!createForm.modality) { setFormError("Selecciona modalidad"); return; }
    /*
     * El dinero de la cita se valida con la MISMA función que el servidor
     * (`normalizarCobro`), no con un `if` paralelo: dos reglas que dicen lo
     * mismo hoy dejan de decirlo el día que alguien toque una. Aquí solo sirve
     * para enseñar el error antes de mandar; el que manda es el 422 de la API.
     */
    if (!esTaller) {
      const { error: errorCobro } = normalizarCobro(cobro ?? {}, {
        concepto: cobro?.modo === "cuota" ? { id: cobro.conceptId, name: cobro.texto, unitPrice: null } : null,
        exigido: exigeCobro,
        porDefecto: null,
      });
      if (errorCobro) { setFormError(errorCobro); return; }
    }

    /*
     * ── SIN CORREO NI TELÉFONO SE PUEDE, PERO NO EN SILENCIO (28/08/2026) ────
     *
     * Antes esto eran dos cortes duros y no dejaban guardar. De los 1.050
     * pacientes activos de Aumenta, 164 no se podían citar por eso: su familia
     * no tiene ninguno de los dos en ningún sitio del CRM, y ese dato no existe.
     *
     * Va aquí, al final y no arriba con los demás, porque no es un error: es una
     * decisión. Preguntarlo antes de saber si el resto del formulario está bien
     * sería hacerla decidir dos veces.
     *
     * La regla y el texto viven en `lib/citas/contactoCita.js`, los mismos que
     * usa el servidor. Estaban escritos cuatro veces y ya divergían.
     */
    // En un taller no hay a quién avisar (son ocho familias), así que este
    // repaso no aplica: preguntarlo sería pedir una decisión sobre nada.
    const aviso = esTaller
      ? null
      : avisoDeContacto(
          repasarContactoDeCita({
            clientEmail: createForm.clientEmail,
            clientPhone: createForm.clientPhone,
          })
        );
    if (aviso && !(await confirmar(aviso))) return;

    // La repetición se calcula ANTES de crear nada: si el «hasta» no da
    // ninguna fecha, mejor decirlo que crear una cita suelta en silencio.
    let repeticion = null;
    if (createForm.repetir) {
      if (!createForm.repetirHasta) { setFormError("Di hasta qué día se repite"); return; }
      repeticion = fechasDeRepeticion(`${createForm.date}T${createForm.time}`, createForm.repetir, createForm.repetirHasta);
      if (repeticion.fechas.length === 0 && repeticion.sinDia === 0) {
        setFormError("Con ese «hasta» no sale ninguna repetición (¿la fecha es anterior a la cita?)");
        return;
      }
    }

    setSaving(true);
    try {
      const scheduledAt = new Date(`${createForm.date}T${createForm.time}`).toISOString();
      // El mismo cuerpo para la primera cita y para sus repeticiones.
      const cuerpoCita = esTaller
        ? {
            // Un taller solo necesita saber CUÁL es y cuándo: el nombre, los
            // asistentes y quién lo imparte salen del grupo (en el servidor).
            eventTypeId: createForm.eventTypeId,
            clientName: selectedEventType?.name ?? "Taller",
            modality: createForm.modality,
            notes: createForm.notes.trim() || null,
            teamMemberId: createForm.teamMemberId || null,
          }
        : {
            eventTypeId: createForm.eventTypeId,
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
             * Lo que cubre la cita. En modo `cuota` NO se manda el importe: lo
             * pone el servidor leyendo el concepto. Y no es un detalle — quien
             * no es dirección recibe el catálogo SIN precios
             * (`lib/citas/dinero.js`), así que mandar lo que ve la pantalla
             * apuntaría 0 € en toda cita creada por el equipo.
             */
            ...(cobro
              ? {
                  cobro:
                    cobro.modo === "cuota"
                      ? { modo: "cuota", conceptId: cobro.conceptId, texto: cobro.texto }
                      : { modo: cobro.modo, texto: cobro.texto, importe: cobro.importe },
                }
              : {}),
          };
      const enviar = (insistir) =>
        fetch("/api/citas/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...cuerpoCita,
            scheduledAt,
            // Sin la casilla marcada, sin correo (03/09/2026).
            ...(avisarCorreo ? {} : { omitirCorreo: true }),
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
      /*
       * …salvo en un TALLER (01/09/2026), donde el correo no es que haya
       * fallado: es que no lo hay. Son ocho familias, cada una con su
       * consentimiento, y avisarlas es otra decisión con su propia plantilla.
       * El servidor lo dice con `emailMotivo: "taller"`; enseñar aquí «no le
       * ha llegado el correo» sería inventarse un problema.
       */
      // …y tampoco si no se pidió el correo (03/09/2026): callada a propósito.
      if (avisarCorreo && j.data && j.data.emailEnviado === false && j.data.emailMotivo !== "taller") {
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

      /*
       * ── LAS REPETICIONES (31/08/2026) ────────────────────────────────────
       * Citas INDEPENDIENTES por el POST de siempre, que ya valida festivos,
       * bloqueos y solapes: la que choca NO se crea y se cuenta al final —
       * aquí no se insiste con permitirFestivo, que doce preguntas seguidas
       * no las contesta nadie. Sin correo (`omitirCorreo`): a la familia le
       * llega solo el de la primera.
       */
      if (repeticion) {
        const chocadas = [];
        let creadas = 0;
        for (const f of repeticion.fechas) {
          try {
            const r = await fetch("/api/citas/bookings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...cuerpoCita, scheduledAt: f.toISOString(), omitirCorreo: true }),
            });
            const jr = await r.json();
            if (jr.ok) creadas += 1;
            else chocadas.push({ fecha: f, motivo: jr.error || "no se pudo crear" });
          } catch {
            chocadas.push({ fecha: f, motivo: "no se pudo crear" });
          }
        }
        const dia = (f) => f.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
        const lineas = chocadas.slice(0, 8).map((c) => `· ${dia(c.fecha)}: ${c.motivo}`);
        if (chocadas.length > 8) lineas.push(`· … y ${chocadas.length - 8} más`);
        if (chocadas.length || repeticion.sinDia) {
          await avisar({
            titulo: "Repetición creada, con huecos",
            texto:
              `Creadas ${creadas + 1} citas (la de hoy y ${creadas} repeticiones).` +
              (chocadas.length ? `\n\nEstas NO se han creado:\n${lineas.join("\n")}` : "") +
              (repeticion.sinDia ? `\n\n${repeticion.sinDia} ${repeticion.sinDia === 1 ? "mes no tiene" : "meses no tienen"} ese día del mes y se ${repeticion.sinDia === 1 ? "salta" : "saltan"}.` : ""),
          });
        }
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

  if (modo === "bloqueo") {
    return (
      <BloqueoRapido
        inicial={inicial}
        categorias={categoriasBloqueo}
        esAdmin={viewerIsAdmin}
        miFicha={miFichaDeEquipo}
        teamMembers={teamMembers}
        avisar={avisar}
        onModo={setModo}
        onClose={onClose}
        onCreated={onCreated}
      />
    );
  }

  return (
        <div
          className="fixed inset-0 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <SelectorModo modo="cita" onModo={setModo} />
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
                ── UN TALLER NO TIENE FAMILIA (01/09/2026, Rodrigo) ───────────
                Van varios pacientes y quiénes son ya está dicho en su grupo, así
                que aquí sobra todo lo de «quién viene». Se enseña de quién es la
                cita y se pasa directamente a cuándo.
              */}
              {esTaller ? (
                <div className="text-xs rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-emerald-800">
                  <strong>{selectedEventType?.name}</strong> — es un taller: la cita se crea con todos los
                  pacientes apuntados a ese grupo y con quien lo imparte. La lista se pasa después, al abrir
                  la cita en la agenda.
                </div>
              ) : (
              <>
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
              </>
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
                    // Los talleres van marcados: es un tipo de cita más, pero se
                    // comporta distinto (no lleva paciente) y quien lo elige
                    // tiene que saberlo antes de pulsarlo, no después.
                    ...eventTypes.map((e) => ({
                      value: e.id,
                      label: e.tallerGrupoId
                        ? `Taller · ${e.name} (${e.duration} min)`
                        : `${e.name} (${e.duration} min)`,
                    })),
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
                {hayTalleres && !esTaller && (
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Los talleres salen aquí marcados como «Taller». Al elegir uno no hace falta paciente:
                    van los apuntados a su grupo.
                  </p>
                )}
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

              {/* Repetición (31/08/2026): citas independientes hasta una fecha,
                  la regla en lib/citas/recurrencia.js. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Repetir</label>
                  <Select
                    value={createForm.repetir}
                    onChange={(v) => updateCreateForm("repetir", v)}
                    className={inputCls}
                    options={[{ value: "", label: "No se repite" }, ...CADENCIAS]}
                  />
                </div>
                {createForm.repetir && (
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hasta el día (incluido)</label>
                    <input
                      type="date"
                      value={createForm.repetirHasta}
                      min={createForm.date || undefined}
                      onChange={(e) => updateCreateForm("repetirHasta", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                )}
              </div>
              {createForm.repetir && (
                <p className="text-[10px] text-neutral-400 -mt-2">
                  Se crean citas sueltas (cada una se mueve o cancela sola). Las que caigan en
                  festivo o bloqueo no se crean y se avisa. El correo a la familia sale solo con la primera.
                </p>
              )}

              {/* En un taller no hay UN contacto: son ocho familias. */}
              {!esTaller && (
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
              )}

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
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Profesional {esTaller ? "" : "*"}
                  </label>
                  <Select
                    value={createForm.teamMemberId}
                    onChange={(v) => updateCreateForm("teamMemberId", v)}
                    options={[
                      {
                        value: "",
                        label: esTaller ? "— Quien coordina el grupo —" : "— Selecciona —",
                        pinned: true,
                      },
                      ...teamMembers.map((m) => ({ value: m.id, label: m.displayName })),
                    ]}
                    placeholder="— Selecciona —"
                    searchable
                  />
                  {esTaller && (
                    <p className="text-[10px] text-neutral-400 mt-1">
                      Es quien figura como responsable de la cita. Los demás que lo imparten salen igual, y
                      el taller aparece en la agenda de todos ellos.
                    </p>
                  )}
                </div>
              )}

              {/*
                ── UN SOLO CHECKBOX, Y PRESENCIAL POR DEFECTO (Jorge, 28/08/2026) ──

                Antes esto eran tantos botones como modalidades declarase el tipo
                de cita, y el servidor rechazaba cualquier otra. Con los 57 tipos
                de Aumenta en «solo online» —un error de datos: sus 12.030 citas
                son presenciales— la pantalla solo podía ofrecer «Online», que es
                justo lo que hizo quejarse a Lau.

                El arreglo de fondo era el dato, y sigue pendiente de que el
                centro nos dé su dirección. Pero la pregunta estaba mal planteada
                igualmente: en una cita que apunta el PROPIO CENTRO, la modalidad
                la sabe quien la apunta. La lista del tipo de cita es el catálogo
                PÚBLICO —lo que una familia puede reservar por la web— y eso
                sigue mandando en el widget, que no se toca.

                Así que aquí queda un interruptor: marcado es presencial, que es
                lo que pasa casi siempre en una consulta; desmarcado, online. La
                modalidad telefónica desaparece del alta manual: no la usa ningún
                cliente real (medido en producción, solo aparece en los datos
                sembrados de las demos) y sigue disponible en el tipo de cita y
                en la reserva pública.
              */}
              <div>
                <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.modality === "presencial"}
                    onChange={(e) =>
                      updateCreateForm("modality", e.target.checked ? "presencial" : "online")
                    }
                  />
                  <span>
                    La cita es <strong className="font-medium">presencial</strong>
                  </span>
                </label>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {createForm.modality === "presencial"
                    ? selectedEventType && !selectedEventType.location
                      ? "Sin dirección en el tipo de cita, la confirmación no dirá dónde es."
                      : "Desmárcala si es una videollamada."
                    : "Será una videollamada."}
                </p>
              </div>

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

              {/*
                * ── EL COBRO DE LA CITA (04/09/2026, Aumenta por Rodrigo) ──────
                *
                * Sale cuando el centro lo exige o cuando el tipo trae cuota; en
                * los demás centros la pantalla no cambia. En un TALLER no sale:
                * el dinero de un taller va por la inscripción de cada niño.
                *
                * Tres modos y no más, los mismos que valida el servidor:
                * la cuota del catálogo, un cobro de texto libre, o sin coste
                * DICIENDO POR QUÉ — que es lo que convierte una cita gratis en
                * una decisión en vez de en un olvido.
                */}
              {!esTaller && (exigeCobro || cobro) && (
                <div className="border border-neutral-200 rounded-xl p-3 bg-neutral-50/60 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="text-[11px] font-medium text-neutral-500">
                      Cobro {exigeCobro && <span className="text-neutral-400">*</span>}
                    </label>
                    <div className="flex gap-1">
                      {[
                        ["cuota", "Cuota"],
                        ["libre", "Cobro suelto"],
                        ["sin_coste", "Sin coste"],
                      ].map(([k, lbl]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() =>
                            setCobro((c) =>
                              c?.modo === k
                                ? c
                                : k === "cuota"
                                  ? cobroDelTipo(selectedEventType?.concepto) ?? { modo: "cuota", conceptId: "", texto: "", importe: 0 }
                                  : { modo: k, conceptId: null, texto: "", importe: 0 }
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${
                            cobro?.modo === k
                              ? "border-transparent text-white"
                              : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300"
                          }`}
                          style={cobro?.modo === k ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {cobro?.modo === "cuota" && (
                    <>
                      {conceptos.length > 0 ? (
                        <Select
                          value={cobro.conceptId ?? ""}
                          onChange={(v) => {
                            const c = conceptos.find((x) => x.id === v) ?? null;
                            setCobro(c ? cobroDelTipo(c) : { modo: "cuota", conceptId: "", texto: "", importe: 0 });
                          }}
                          options={[
                            { value: "", label: "— Elige la cuota —" },
                            ...conceptos.map((c) => ({
                              value: c.id,
                              label: `${c.name}${c.unitPrice != null ? ` · ${Number(c.unitPrice).toFixed(2)} €` : ""}`,
                            })),
                          ]}
                          className={inputCls}
                          searchable
                        />
                      ) : (
                        /* Sin catálogo (no tiene el módulo de facturación): se
                           queda con la que trae el tipo, que es lo normal. */
                        <p className="text-xs text-neutral-600">
                          {cobro.texto || "Este tipo de cita no tiene cuota puesta."}
                          {cobro.importe > 0 && <span className="text-neutral-400"> · {euros(cobro.importe)}</span>}
                        </p>
                      )}
                      {conceptos.length === 0 && !cobro.conceptId && exigeCobro && (
                        <p className="text-[10px] text-amber-700">
                          Ponle la cuota a este tipo en Citas → Tipos, o escribe un cobro suelto.
                        </p>
                      )}
                    </>
                  )}

                  {cobro?.modo === "libre" && (
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <input
                        type="text"
                        maxLength={200}
                        placeholder="Qué se cobra"
                        value={cobro.texto}
                        onChange={(e) => setCobro((c) => ({ ...c, texto: e.target.value }))}
                        className={inputCls}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="€"
                        value={cobro.importe ? String(cobro.importe / 100) : ""}
                        onChange={(e) =>
                          setCobro((c) => ({ ...c, importe: Math.round((Number(e.target.value) || 0) * 100) }))
                        }
                        className={inputCls}
                      />
                    </div>
                  )}

                  {cobro?.modo === "sin_coste" && (
                    <input
                      type="text"
                      maxLength={200}
                      placeholder="Por qué no se cobra (recuperación, reunión, cortesía…)"
                      value={cobro.texto}
                      onChange={(e) => setCobro((c) => ({ ...c, texto: e.target.value }))}
                      className={inputCls}
                    />
                  )}

                  {!cobro && (
                    <p className="text-[11px] text-neutral-500">
                      Elige de qué se cobra esta cita, o márcala como sin coste.
                    </p>
                  )}
                </div>
              )}

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

            <div className="px-5 py-3 border-t border-neutral-100 flex items-center justify-end gap-2 shrink-0">
              {/* La casilla del correo, apagada de entrada (03/09/2026). En un
                  taller no hay a quién avisar y no sale. */}
              {!esTaller && (
                <label
                  className="flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer mr-auto"
                  title="Le llega el correo de confirmación con la fecha, la hora y el enlace para cancelar"
                >
                  <input
                    type="checkbox"
                    checked={avisarCorreo}
                    onChange={(e) => setAvisarCorreo(e.target.checked)}
                    className="accent-[var(--color-primary,#1B3A2D)]"
                  />
                  Avisar al paciente por correo
                </label>
              )}
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

/** Arriba del drawer: qué se crea con el hueco pulsado, una cita o un bloqueo. */
function SelectorModo({ modo, onModo }) {
  const boton = (clave, texto) => (
    <button
      type="button"
      onClick={() => onModo(clave)}
      aria-pressed={modo === clave}
      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
        modo === clave ? "bg-[var(--color-primary,#0F0F0F)] text-white" : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {texto}
    </button>
  );
  return (
    <div className="flex items-center gap-1 rounded-lg border border-neutral-200 p-0.5" aria-label="Qué se crea">
      {boton("cita", "Nueva cita")}
      {boton("bloqueo", "Bloqueo")}
    </div>
  );
}

/** "10:00" + 60 → "11:00"; sin hora, "". */
function sumarMinutos(hhmm, minutos) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  if (!m) return "";
  const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + minutos);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * BloqueoRapido — el mismo drawer, con el formulario de un BLOQUEO dentro
 * (03/09/2026, Aumenta: «que en el calendario de citas al pulsar pueda elegir
 * cambiar a bloqueo aparte de una cita en lo alto del modal»).
 *
 * Es la versión corta del formulario de Citas → Bloqueos, con el hueco
 * pulsado ya puesto y una hora de duración de entrada. Mismas reglas que
 * allí, y las impone el servidor igual: quien no es dirección solo se
 * bloquea a sí mismo (el «Quién» ni se elige), el motivo es opcional, y las
 * citas que ya hubiera dentro no se tocan (se avisa cuántas hay).
 */
function BloqueoRapido({ inicial, categorias, esAdmin, miFicha, teamMembers, avisar, onModo, onClose, onCreated }) {
  const [form, setForm] = useState(() => ({
    teamMemberId: miFicha?.id ?? "",
    categoryKey: "",
    label: "",
    date: inicial.date || "",
    time: inicial.time || "",
    endDate: inicial.date || "",
    endTime: sumarMinutos(inicial.time, 60),
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const pon = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  async function guardar() {
    setErr(null);
    if (!form.date || !form.time) { setErr("Pon la fecha y la hora de inicio"); return; }
    const endDate = form.endDate || form.date;
    const endTime = form.endTime || "23:59";
    if (new Date(`${endDate}T${endTime}`) <= new Date(`${form.date}T${form.time}`)) {
      setErr("El fin tiene que ser posterior al inicio");
      return;
    }
    setSaving(true);
    try {
      // La hora viaja PARTIDA (fecha + hora) y el servidor la lee como hora de
      // Madrid, igual que desde la pantalla de Bloqueos.
      const cuerpo = {
        startDate: form.date,
        startTime: form.time,
        endDate,
        endTime,
        label: form.label.trim(),
        categoryKey: form.categoryKey || null,
      };
      // De quién es solo lo manda dirección; a un no-admin el servidor se lo
      // pone a su nombre haga lo que haga el navegador.
      if (esAdmin) cuerpo.teamMemberId = form.teamMemberId || null;
      const r = await fetch("/api/citas/bloqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se ha podido bloquear el tramo");
      if (j.data?.citasDentro > 0) {
        await avisar({
          titulo: "Bloqueado, con citas dentro",
          texto: `Hay ${j.data.citasDentro} cita(s) ya puestas en ese tramo; no se han tocado.`,
        });
      }
      onCreated();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  const rotulo = "block text-[11px] font-medium text-neutral-500 mb-1";

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <aside className="absolute right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <SelectorModo modo="bloqueo" onModo={onModo} />
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
          {err && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{err}</div>
          )}
          <p className="text-[11px] text-neutral-500">
            Un tramo en el que no se pasa consulta: la agenda deja de ofrecer esos huecos. Las citas que ya
            hubiera dentro no se tocan.
          </p>

          <div>
            <label className={rotulo}>Quién</label>
            {esAdmin ? (
              <select value={form.teamMemberId} onChange={(e) => pon("teamMemberId", e.target.value)} className={inputCls}>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
                <option value="">Todo el centro (cierra a todo el mundo)</option>
              </select>
            ) : (
              <p className={`${inputCls} bg-neutral-50 text-neutral-600`}>{miFicha?.displayName || "Tus ausencias"}</p>
            )}
          </div>

          {categorias.length > 0 && (
            <div>
              <label className={rotulo}>Categoría</label>
              <select value={form.categoryKey} onChange={(e) => pon("categoryKey", e.target.value)} className={inputCls}>
                <option value="">Sin categoría</option>
                {categorias.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={rotulo}>Motivo (opcional)</label>
            <input value={form.label} onChange={(e) => pon("label", e.target.value)} className={inputCls} placeholder="Sin motivo" maxLength={120} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotulo}>Empieza</label>
              <input type="date" value={form.date} onChange={(e) => pon("date", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={rotulo}>Hora</label>
              <input type="time" value={form.time} onChange={(e) => pon("time", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={rotulo}>Termina</label>
              <input type="date" value={form.endDate} min={form.date || undefined} onChange={(e) => pon("endDate", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={rotulo}>Hora</label>
              <input type="time" value={form.endTime} onChange={(e) => pon("endTime", e.target.value)} className={inputCls} />
            </div>
          </div>
          <p className="text-[10px] text-neutral-400">
            Con «Termina» vacío se bloquea hasta el final del día. Para gestionarlos todos, Citas → Bloqueos.
          </p>
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
            onClick={guardar}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Bloquear"}
          </button>
        </div>
      </aside>
    </div>
  );
}
