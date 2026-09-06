"use client";

/**
 * components/clinica/RegistroSesionEditor.jsx — LA pantalla donde se escribe el
 * registro de una sesión. La misma para estrenarlo y para seguir con él:
 *
 *   · `/pacientes/[id]/sesiones/nueva`        → uno nuevo (con `?cita=` si se
 *                                                llega desde el modal de la cita)
 *   · `/pacientes/[id]/sesiones/[sesionId]`   → seguir con el que ya existe
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO UNA PÁGINA (01/09/2026, Rodrigo) ─────────
 * «Quiero poder editar a posteriori el propio registro de sesión»: hasta hoy,
 * una vez guardado, del cajón de la ficha solo se podían retocar la preparación,
 * la devolución de la familia y las notas internas — el informe de la sesión, que
 * es el cuerpo, no se tocaba desde ninguna parte. Ahora se edita AQUÍ, en la
 * misma pantalla en la que se escribió, con sus apartados, su plantilla y su
 * material. Dos rutas finísimas lo montan; el formulario vive en un solo sitio
 * para que escribir y editar no se separen a la primera.
 *
 * ── «Nuevo registro» (26/08/2026, Rodrigo: «en lugar de Subir audio, Nuevo
 * registro; que se pueda hacer todo el registro en texto, y el audio dentro y
 * opcional»).
 *
 * Hasta hoy el camino principal era el audio: la página abría con la zona de
 * soltar el fichero y el formulario solo aparecía DESPUÉS de que la IA lo
 * estructurara (o como preparación-borrador). Ahora es al revés:
 *
 *   - La página abre con el REGISTRO COMPLETO en texto, las tres partes del
 *     sprint 2026-07: 1·Preparación (con adjuntos), 2·Informe (objetivos,
 *     actividades, desempeño, observaciones) y 3·Devolución de la familia.
 *   - El audio es un bloque OPCIONAL dentro: si se sube y procesa, la IA
 *     propone el registro entero y ella elige apartado por apartado.
 *
 * «Preparar la sesión» (borrador antes de darla, 26/08 por la mañana) sigue
 * igual: se llega con ?preparar=1 desde el modal de la cita o con su enlace de
 * abajo.
 *
 * ── EL BORRADOR NO SE PODÍA GUARDAR DESDE EL REGISTRO (01/09/2026, Rodrigo) ─
 * «Guardar la preparación no funciona: no se guarda nada como borrador.» Las
 * dos pantallas de esta página escribían la preparación en estados DISTINTOS
 * —el registro en `form.prepText`, la de preparar en un `prepSolo` suyo—, así
 * que el enlace «Guárdala solo como preparación» te llevaba a un recuadro
 * vacío con el botón apagado: lo escrito se quedaba atrás y no había forma de
 * guardarlo. Ahora la preparación es UNA (`form.prepText`), como ya lo eran el
 * día y los adjuntos, y el texto cruza en los dos sentidos. Y como del
 * registro completo solo viaja la preparación, la pantalla avisa si hay algo
 * más escrito en vez de tirarlo callando.
 *
 * ── EL AUDIO YA RELLENA EL REGISTRO ENTERO (01/09/2026, Rodrigo) ───────────
 * Hasta hoy «Procesar con IA» solo tocaba SIETE apartados —los de fábrica del
 * punto 2— y solo si estaban vacíos. Quedaban siempre en blanco la preparación,
 * la devolución de la familia, las notas internas y los apartados propios de la
 * plantilla del centro, aunque estuvieran dictados en el audio.
 *
 * Ahora la pantalla manda al servidor SUS apartados (los de la plantilla
 * elegida más los sueltos que se hayan añadido aquí) y lo ya tecleado, y lo que
 * vuelve se enseña en `PropuestaIA`: lo tuyo al lado de lo propuesto, con
 * mantener / añadir al final / sustituir. Nada entra solo — que era la otra
 * mitad del encargo: antes, lo que la IA proponía para un apartado ya escrito
 * se tiraba sin que nadie lo viera.
 *
 * ── Y NO HACE FALTA AUDIO (01/09/2026, Rodrigo, el mismo día) ─────────────
 * «También debe poder coger texto libre, no solo la transcripción del audio.
 * Por si apuntan todo en un bloc de notas y lo pasan ahí.» La tarjeta del audio
 * pasa a ser la del MATERIAL: la zona de soltar el fichero y, debajo, un
 * recuadro donde pegar lo apuntado. Un botón para las dos, y si se dan las dos
 * se usan las dos. Sin audio no se sube nada ni se llama a Whisper — ni se
 * pintan sus pasos, ni hace falta clave de OpenAI.
 *
 * ── LOS APARTADOS DEL PUNTO 2 SALEN DE UNA PLANTILLA (29/08/2026) ──────────
 * El «Informe de la sesión» tenía siete campos escritos a mano aquí dentro.
 * Ahora los da `lib/clinica/plantillas.js` —la plantilla de registro del centro
 * o los siete de fábrica—, se pintan con `ApartadosEditor` (el mismo del cajón
 * del informe) y se pueden añadir apartados sueltos para ESTA sesión, que se
 * aplican aquí y no se guardan en ninguna plantilla. Los puntos 1 y 3
 * —preparación y devolución de la familia— siguen fuera: no son apartados del
 * informe de la sesión, son el envoltorio del registro.
 *
 * ── UNA CITA, UN REGISTRO (01/09/2026, Rodrigo) ────────────────────────────
 * «Si estoy editando la sesión de una cita y salgo y entro, no me tiene que
 * generar una sesión nueva: tiene que seguir editando la misma hasta que le dé
 * a finalizar.» Y las generaba: el enlace del modal llevaba paciente y fecha, y
 * nada que dijera de qué CITA era la sesión, así que cada vuelta abría un
 * formulario en blanco y guardarlo creaba otra sesión del mismo día — la
 * primera se quedaba en la ficha, con la preparación dentro, y había que ir a
 * buscarla por la pestaña de sesiones.
 *
 * Ahora, al llegar con `?cita=<id>`, esta pantalla PREGUNTA antes de pintar
 * nada: si esa cita ya tiene registro, salta al suyo (`sesionDeLaCita`, en
 * lib/clinica/prepararSesion.js). Y las sesiones preparadas antes de que
 * existiera `bookingId` se adoptan por paciente + hora exacta la primera vez,
 * para que las que hoy se duplican dejen de hacerlo.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useZonaSoltar, { useEvitarSoltarFuera } from "@/components/ui/useZonaSoltar.js";
import useGrabadora from "@/components/clinica/useGrabadora.js";
import useAudios from "@/components/clinica/useAudios.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import {
  fechaDePreparacion,
  paraInputLocal,
  payloadDePreparacion,
  plantillaDePreparacion,
  pidePreparar,
  profesionalDePreparacion,
  proximasSesionesPendientes,
  sesionDeLaCita,
} from "@/lib/clinica/prepararSesion.js";
import ApartadosEditor from "@/components/clinica/ApartadosEditor.jsx";
import MaterialIA, { ACEPTA_AUDIO } from "@/components/clinica/MaterialIA.jsx";
import PropuestaIA from "@/components/clinica/PropuestaIA.jsx";
import {
  aFormulario,
  apartadosConPlantillas,
  CLAVE_PLANTILLA,
  MAX_APARTADOS,
  PLANTILLA_BASE,
  desdeFormulario,
  repartirValoresDeSesion,
  valoresDeSesion,
} from "@/lib/clinica/plantillas.js";
import { cabenNuevos } from "@/lib/clinica/apartadosPropuestos.js";
import { bloquesDelRegistro, esEnvoltorio } from "@/lib/clinica/registroCompleto.js";
import { MAX_AUDIOS } from "@/lib/clinica/audios.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

const STATE = { FORM: "form", PROCESSING: "processing", PREPARING: "preparing" };

// Lo que admite cada campo de fichero. El del audio vive con la tarjeta que lo
// pinta (`MaterialIA`), que es quien monta el input; aquí se lee para la zona
// de soltar, que filtra lo que llega arrastrado (el navegador no lo filtra).
const ACEPTA_PREP = "image/*,audio/*,application/pdf";
const MAX_PREP = 10;

// Los pasos que se pintan mientras la petición está en vuelo. Los dos primeros
// solo cuando hay audio de verdad: sin él no se sube nada ni se llama a Whisper,
// y enseñarlos sería contar un trabajo que no se está haciendo.
const PASOS_AUDIO = ["Subiendo audio…", "Transcribiendo con Whisper…"];
const PASOS_IA = [
  "Identificando objetivos trabajados…",
  "Repartiendo por los apartados del registro…",
  "Preparación, devolución y notas internas…",
];
// `queEntra`: "audio" (hay que transcribirlo), "transcripcion" (ya se
// transcribió y se reaprovecha) o "notas". Los dos pasos de Whisper solo se
// pintan en el primer caso: enseñarlos cuando no se está subiendo ni
// transcribiendo nada es contar un trabajo que no se está haciendo —y era justo
// lo que hacía creer que el audio se estaba procesando otra vez—.
const pasosDelProceso = (queEntra) =>
  queEntra === "audio"
    ? [...PASOS_AUDIO, ...PASOS_IA]
    : [queEntra === "transcripcion" ? "Releyendo la transcripción…" : "Leyendo tus notas…", ...PASOS_IA];

// Lo que NO es un apartado de plantilla: los puntos 1 y 3 del registro. Los del
// punto 2 se añaden a este mismo objeto según los pida la plantilla, con la
// clave del apartado; por eso aquí solo están estos dos.
const FORM_VACIO = {
  prepText: "",
  parentFeedback: "",
  internalNotes: "",
};

// Cómo entra en el registro lo que devuelve la IA del audio, por si el apartado
// no está en la plantilla del centro y hay que crearlo al vuelo: un botón que
// trae contenido no puede escribirlo en un sitio que no se ve.
const NOMBRES_AUDIO = {
  objectives: "Objetivos trabajados",
  activities: "Actividades realizadas",
  performance: "Desempeño",
  familyComments: "Comentarios familiares",
  nextSessionNotes: "Próximas sesiones",
  homeworkTasks: "Tareas para casa",
  incidents: "Incidencias",
};
const TIPO_AUDIO = { objectives: "lista" };

const fmtDiaCorto = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
};

/**
 * El cartelito de que la preparación no la ha escrito ella: viene de lo que
 * dejó apuntado en «Próximas sesiones» de la sesión anterior.
 *
 * Se dice, y no se cuela en silencio, por lo de siempre en lo clínico: un texto
 * que aparece solo en un recuadro y acaba guardado en una nota firmada tiene
 * que llevar escrito de dónde salió. Desaparece en cuanto se vacía el recuadro.
 */
function AvisoPrepHeredada({ de }) {
  if (!de) return null;
  return (
    <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-relaxed">
      Viene de <strong>«Próximas sesiones»</strong> de la sesión del {fmtDiaCorto(de)}. Edítalo o bórralo:
      no se guarda hasta que guardes el registro.
    </p>
  );
}

/**
 * Quién dio la sesión (01/09/2026, Rodrigo). Un desplegable con el equipo, y el
 * nombre a secas si no hay lista que desplegar —el centro puede no tener el
 * módulo de equipo, y entonces esto se comporta como se comportaba ayer—.
 *
 * Sale en las dos cabeceras de esta pantalla (el registro y la preparación)
 * porque la firma se decide igual en las dos: quien prepara una sesión no es
 * siempre quien la da.
 */
function FirmaDeLaSesion({ equipo, valor, onCambio, nombre }) {
  if (!equipo.length) return <p className="text-xs text-neutral-500 mt-1">{nombre}</p>;
  return (
    <label className="block mt-1">
      <span className="sr-only">Profesional que da la sesión</span>
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="text-xs text-neutral-600 bg-transparent border border-neutral-200 rounded-lg px-2 py-1 focus:outline-none focus:border-neutral-400 max-w-full"
      >
        {/* Sin firma solo mientras no se elige: el alta la exige. */}
        {!valor && <option value="">Sin profesional</option>}
        {equipo.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
            {m.status === "inactive" ? " (ya no está)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);

/**
 * @param {string} patientId  el paciente de la ficha
 * @param {string|null} sessionId  la sesión que se está editando; null = nueva
 */
export default function RegistroSesionEditor({ patientId, sessionId = null }) {
  const router = useRouter();
  const id = patientId;
  const query = useSearchParams();
  // La cita de la que se viene, si se viene de una. Se guarda con la sesión
  // (`bookingId`) para que volver a esta cita traiga ESTE registro y no uno
  // nuevo. Editando una sesión que ya existe no pinta nada: la suya ya la lleva.
  const cita = sessionId ? null : (query.get("cita") ?? "").trim();
  // Se leen como CADENAS y no se usa `query` en los efectos de abajo: un objeto
  // de búsqueda que cambiara de identidad entre renders volvería a lanzar el
  // efecto en cada uno, y ese efecto pide sesiones y hace `router.replace`.
  const fechaDeLaUrl = query.get("fecha");
  const abrirPreparacion = pidePreparar(query.get("preparar"));
  // El profesional QUE DA ESA CITA (01/09/2026). Solo estrenando registro: una
  // sesión que ya existe lleva su firma dentro y no se toca desde una URL.
  const profDeLaCita = sessionId ? "" : profesionalDePreparacion(query.get("prof"));
  // Con qué plantilla se abre un registro NUEVO (02/09/2026): la cita de
  // valoración inicial pide la de la entrevista. Solo estrenando: una sesión
  // que ya existe se abre con SU foto.
  const plantillaPedida = sessionId ? "" : plantillaDePreparacion(query.get("plantilla"));

  const [patient, setPatient] = useState(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  // ── QUIÉN DIO LA SESIÓN (01/09/2026, Rodrigo) ─────────────────────────────
  // «Se ha apuntado un registro a nombre de un terapeuta cuando el registro lo
  // había hecho otro terapeuta y no podemos cambiarlo.» Y no se podía desde
  // ninguna pantalla: esta enseñaba el terapeuta PRINCIPAL DEL PACIENTE —no el
  // de la sesión— y el alta firmaba con él, así que una sesión que cubre una
  // compañera nacía mal firmada y ahí se quedaba. Ahora se elige, y lo elegido
  // es lo que se guarda: al estrenar y al corregir una ya escrita.
  const [terapeutaId, setTerapeutaId] = useState("");
  const [equipo, setEquipo] = useState([]);
  // De qué sesión viene la preparación que se ha escrito sola (01/09/2026).
  // `null` cuando la ha escrito ella, que es el caso normal.
  const [prepHeredadaDe, setPrepHeredadaDe] = useState(null);
  // Se hereda UNA vez por visita: sin esto, borrar el texto heredado lo volvería
  // a traer al siguiente render y no habría manera de quitárselo de encima.
  const yaHeredado = useRef(false);
  // La sesión que se está editando, ya cargada. `null` mientras se estrena una.
  const [sesion, setSesion] = useState(null);
  // «Cargando» de VERDAD: mientras esto esté puesto no se pinta el formulario.
  // Es lo que evita que, llegando desde una cita que ya tiene registro, se vea
  // medio segundo un formulario en blanco y alguien se ponga a escribir en él.
  const [resolviendo, setResolviendo] = useState(!!sessionId || !!cita);
  const [noEncontrada, setNoEncontrada] = useState(false);
  // Quien llega desde una cita («Preparar sesión») entra DIRECTO al formulario
  // de preparación: el enlace ya dijo a qué venía. Va en el estado inicial y no
  // en un efecto, para que volver al registro a mano no se deshaga solo.
  const [state, setState] = useState(() => (abrirPreparacion ? STATE.PREPARING : STATE.FORM));
  // La fecha de la cita, si viene; si no, ahora. Se acota en `fechaDePreparacion`
  // porque llega por la barra de direcciones. La comparten el registro y la
  // preparación: es «cuándo es (o fue) la sesión».
  const [fecha, setFecha] = useState(() => paraInputLocal(fechaDePreparacion(fechaDeLaUrl) ?? new Date()));
  // ⚠️ La preparación vive en UN solo sitio: `form.prepText`. Las dos pantallas
  // —el registro completo y «Preparar la sesión»— escriben en él. Hasta el
  // 01/09/2026 la de preparación tenía su propio estado (`prepSolo`) y el texto
  // NO cruzaba: se escribía la preparación en el registro, se pulsaba «Guárdala
  // solo como preparación» y aparecía el recuadro VACÍO con el botón apagado.
  // Desde fuera eso es «guardar la preparación no funciona, no se guarda nada
  // como borrador» — y era cierto: no había manera de guardarla desde ahí. El
  // día y los adjuntos ya se compartían; el texto era el único que se caía.
  const [form, setForm] = useState(FORM_VACIO);
  // Los apartados del punto 2. Arrancan con los de fábrica para que la pantalla
  // se pinte entera antes de que conteste /api/clinica/plantillas; en cuanto
  // llega la plantilla del centro se sustituyen (el formulario está vacío
  // todavía, así que no se pierde nada escrito).
  const [apartados, setApartados] = useState(() => PLANTILLA_BASE.registro.apartados.map((a) => ({ ...a })));
  const [plantillas, setPlantillas] = useState([]);
  const [plantillaKey, setPlantillaKey] = useState("");
  // El interruptor que faltaba: dejar el audio FUERA de esta pasada sin tener
  // que quitarlo (y perder su transcripción) para poder usar la IA solo con lo
  // que se acaba de escribir.
  const [usarAudio, setUsarAudio] = useState(true);
  // Lo apuntado a mano (01/09/2026, Rodrigo): la otra puerta al mismo botón.
  // No se borra al quitar el audio — son dos cosas independientes que se pueden
  // dar por separado o juntas.
  const [notas, setNotas] = useState("");
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState(null); // { transcription, propuesta, structured, audioDurationSec, demo }
  // La propuesta se guarda aparte del `result` porque se puede volver a abrir
  // después de aplicarla (o de cerrarla sin aplicar): el panel es una decisión,
  // no un paso del que no se vuelve.
  const [propuesta, setPropuesta] = useState(null);
  // Los apartados que la IA propone CREAR porque lo dictado no cabía en ninguno
  // de los de esta sesión (04/09/2026). Aparte de la propuesta: no son el valor
  // de un apartado, son apartados que habría que añadir.
  const [nuevosIA, setNuevosIA] = useState([]);
  const [verPropuesta, setVerPropuesta] = useState(false);
  const [avisoAudio, setAvisoAudio] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  // ── LOS AUDIOS, EN PLURAL (04/09/2026, Rodrigo) ──────────────────────────
  // «Queremos subir más de un audio antes de ponerlo a transcribir.» La lista,
  // el estado de cada uno y lo que Whisper sacó de él viven en `useAudios`. Lo
  // transcrito se guarda AHÍ y no dentro de `result` —que es la foto de la
  // ÚLTIMA pasada—: una pasada solo de notas no trae transcripción y sin esto
  // se perdería, obligando a subir los audios otra vez y a pagarlos
  // (01/09/2026: un audio se transcribe UNA sola vez).
  const audios = useAudios({ onError: setErrorMsg, onAviso: setAvisoAudio });
  // Adjuntos de la PREPARACIÓN (punto 4 del sprint). Se quedan en memoria hasta
  // que la sesión existe: el endpoint de adjuntos necesita su id.
  const [prepFiles, setPrepFiles] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    fetch(`/api/pacientes/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setPatient(j.data))
      .catch(() => {})
      .finally(() => setLoadingPatient(false));
  }, [id]);

  /**
   * El equipo, para poder decir quién dio la sesión.
   *
   * `status=all` a propósito: hay que poder firmar a nombre de alguien que ya
   * no está en el centro. De las 22.045 sesiones importadas de Aumenta, 4.045
   * las escribió gente que se fue, y corregir una firma HACIA una de esas
   * personas es justo uno de los casos que hay que poder arreglar.
   *
   * Resiliente, como en la ficha del paciente: si el centro no tiene el módulo
   * de equipo esto da 403, la lista se queda vacía y la pantalla enseña el
   * nombre de siempre sin desplegable.
   */
  useEffect(() => {
    fetch(`/api/team?status=all&limit=200`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEquipo(j?.data?.members ?? []))
      .catch(() => {});
  }, []);

  /**
   * ── CON QUIÉN NACE FIRMADO UN REGISTRO QUE SE ESTRENA ────────────────────
   *
   * 1. El PROFESIONAL DE LA CITA desde la que se prepara, si se viene de una.
   * 2. Y si esa cita no tiene a nadie (o no se viene de ninguna), el terapeuta
   *    de referencia del paciente — que es lo de siempre, y lo que sigue
   *    pasando al escribir desde su ficha.
   *
   * El orden lo pidió Rodrigo el 01/09/2026: «si Isabel Vara es la terapeuta de
   * un paciente pero la cita desde la que se prepara la sesión está asignada a
   * Silvia Hernández, el registro debe estar a cargo de Silvia Hernández».
   * Antes ganaba SIEMPRE el del paciente, así que una compañera que cubre, un
   * cambio de turno o una segunda especialidad se registraban a nombre de quien
   * no dio la sesión — y quien lo notaba tenía que corregir la firma a mano.
   *
   * Sigue siendo solo el arranque: el desplegable manda, y por eso el guardia
   * es `terapeutaId` (lo ya elegido no se pisa nunca) y `sessionId` (una sesión
   * que ya existe lleva su firma dentro).
   *
   * El id de la cita llega por la barra de direcciones, así que no basta con
   * que tenga forma de id: tiene que estar en el EQUIPO del centro, como exige
   * el PATCH de la sesión. Y mientras la lista no ha contestado no se decide
   * nada — adelantar aquí el terapeuta del paciente dejaría la firma
   * equivocada, y el propio guardia de arriba impediría corregirla después.
   */
  useEffect(() => {
    if (sessionId || terapeutaId) return;
    if (profDeLaCita) {
      if (!equipo.length) return;
      if (equipo.some((m) => m.id === profDeLaCita)) {
        setTerapeutaId(profDeLaCita);
        return;
      }
    }
    if (patient?.mainTherapistId) setTerapeutaId(patient.mainTherapistId);
  }, [sessionId, terapeutaId, profDeLaCita, equipo, patient?.mainTherapistId]);

  /**
   * Las plantillas del centro y, si se está editando, LA SESIÓN — en el mismo
   * efecto y con un solo `await` de los dos.
   *
   * Van juntas a propósito: la lista de apartados de una sesión ya escrita sale
   * de `apartadosConPlantillas(contentSections, plantillas)`, que necesita las
   * dos cosas a la vez. Con dos efectos sueltos, el que llegara segundo pisaría
   * al primero —los apartados de la plantilla del centro sobre los de la
   * sesión, o al revés— y quedaría a suerte de la red qué se ve. Eso, en un
   * registro clínico, es perder texto escrito.
   */
  useEffect(() => {
    let vivo = true;
    (async () => {
      const plantillasDelCentro = await fetch("/api/clinica/plantillas", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.data?.registro ?? [])
        .catch(() => []);
      if (!vivo) return;
      if (plantillasDelCentro.length) setPlantillas(plantillasDelCentro);

      // ── Estrenando registro: los apartados son los del centro ────────────
      if (!sessionId) {
        if (plantillasDelCentro.length) {
          const elegida = plantillasDelCentro.find((p) => p.key === plantillaPedida) ?? plantillasDelCentro[0];
          setPlantillaKey(elegida.key);
          setApartados(elegida.apartados.map((a) => ({ ...a })));
        }
        return;
      }

      // ── Siguiendo con uno que ya existe ─────────────────────────────────
      const s = await fetch(`/api/clinica/sessions/${sessionId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j?.ok ? j.data : null))
        .catch(() => null);
      if (!vivo) return;
      if (!s) {
        setNoEncontrada(true);
        setResolviendo(false);
        return;
      }
      volcarSesion(s, plantillasDelCentro);
      setResolviendo(false);
    })();
    return () => {
      vivo = false;
    };
  }, [id, sessionId]);

  /**
   * La sesión guardada → el formulario. Los apartados salen de la FOTO que
   * guardó ella (`apartadosConPlantillas`), no de la plantilla de hoy: si el
   * centro cambió la plantilla después, sus títulos y su texto siguen siendo
   * los suyos, y editarla no se lleva por delante lo que no cabe en la nueva.
   */
  function volcarSesion(s, plantillasDelCentro) {
    const suyos = apartadosConPlantillas(s.contentSections, plantillasDelCentro);
    const lista = suyos.length ? suyos : PLANTILLA_BASE.registro.apartados.map((a) => ({ ...a }));
    setSesion(s);
    setTerapeutaId(s.therapistId ?? "");
    setApartados(lista);
    setPlantillaKey(s.contentSections?.[CLAVE_PLANTILLA] ?? plantillasDelCentro?.[0]?.key ?? "");
    setFecha(paraInputLocal(s.sessionDate));
    setForm({
      prepText: s.prepText ?? "",
      parentFeedback: s.parentFeedback ?? "",
      internalNotes: s.internalNotes ?? "",
      ...aFormulario(valoresDeSesion(s), lista),
    });
  }

  /**
   * ── «PRÓXIMAS SESIONES» ES LA PREPARACIÓN DE LA SIGUIENTE (01/09/2026) ───
   *
   * Rodrigo: «todo lo que sea Próximas sesiones se tiene que registrar
   * automáticamente como borrador para la siguiente preparación». Al abrir un
   * registro cuya preparación está VACÍA se busca lo que la profesional dejó
   * apuntado en la sesión anterior de ese paciente y se escribe aquí, con un
   * cartel que dice de dónde sale.
   *
   * Solo si está vacía, y esa es la regla que no se toca: lo escrito a mano
   * nunca se pisa. Y no se guarda nada por su cuenta — esto es una propuesta en
   * pantalla hasta que alguien le dé a guardar (ver `proximasSesionesPendientes`).
   *
   * Espera a que termine de resolverse la sesión: si se adelantara, escribiría
   * en un formulario que `volcarSesion` va a sobrescribir medio segundo después.
   */
  useEffect(() => {
    if (yaHeredado.current || resolviendo || loadingPatient || !patient) return;
    yaHeredado.current = true;
    // Con preparación escrita no hay nada que heredar: ni se pregunta.
    if (String(form.prepText ?? "").trim()) return;
    let vivo = true;
    (async () => {
      const suyas = await fetch(`/api/clinica/sessions?patientId=${encodeURIComponent(id)}&limit=100`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.data?.sessions ?? [])
        .catch(() => []);
      if (!vivo) return;
      const previa = proximasSesionesPendientes(suyas, {
        antesDe: cuandoEsLaSesion(),
        excluirId: sessionId,
      });
      if (!previa) return;
      // Se vuelve a mirar sobre el estado de AHORA: entre la petición y esto ha
      // podido ponerse a escribir, y lo suyo manda siempre.
      setForm((f) => {
        if (String(f.prepText ?? "").trim()) return f;
        setPrepHeredadaDe(previa.sesion.sessionDate);
        return { ...f, prepText: previa.texto };
      });
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolviendo, loadingPatient, patient, id, sessionId]);

  /**
   * ── LA REGLA: UNA CITA, UN REGISTRO (01/09/2026, Rodrigo) ────────────────
   *
   * Llegando desde el modal de una cita, antes de pintar nada se pregunta si
   * esa cita ya tiene registro. Si lo tiene, se salta al suyo y se sigue por
   * donde se dejó; si no, se sigue aquí y el alta lo guardará con su cita.
   *
   * El `router.replace` (y no `push`) es a propósito: la URL de destino es la
   * verdadera, y con `push` el botón «atrás» del navegador devolvería a este
   * mismo enlace, que volvería a redirigir. Un callejón.
   *
   * La ADOPCIÓN —ponerle la cita a una sesión que se preparó cuando no había
   * dónde guardarla— se hace aquí y no en el servidor porque es lo que hace
   * que las que HOY se duplican dejen de duplicarse: se arreglan solas la
   * primera vez que alguien vuelve a su cita. Si el parche falla no se para
   * nada: se sigue a esa sesión igual, y el intento se repetirá mañana.
   */
  useEffect(() => {
    if (sessionId || !cita) return;
    let vivo = true;
    (async () => {
      const suyas = await fetch(`/api/clinica/sessions?bookingId=${encodeURIComponent(cita)}&limit=5`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.data?.sessions ?? [])
        .catch(() => []);
      let hallada = sesionDeLaCita(suyas, { bookingId: cita });

      // Nada apuntado a esta cita: puede ser una de las preparadas antes de que
      // `bookingId` existiera. Se busca entre las del paciente por hora exacta.
      if (!hallada) {
        const delPaciente = await fetch(`/api/clinica/sessions?patientId=${encodeURIComponent(id)}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => j?.data?.sessions ?? [])
          .catch(() => []);
        hallada = sesionDeLaCita(delPaciente, { bookingId: cita, scheduledAt: fechaDeLaUrl });
        if (hallada?.via === "fecha") {
          await fetch(`/api/clinica/sessions/${hallada.sesion.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId: cita }),
          }).catch(() => {});
        }
      }
      if (!vivo) return;
      if (!hallada) {
        setResolviendo(false);
        return;
      }
      // La preparación abierta se conserva al saltar: quien pulsó «Preparar
      // sesión» venía a eso, exista ya el registro o no.
      const cola = abrirPreparacion ? "?preparar=1" : "";
      router.replace(`/pacientes/${id}/sesiones/${hallada.sesion.id}${cola}`);
    })();
    return () => {
      vivo = false;
    };
  }, [id, cita, sessionId, fechaDeLaUrl, abrirPreparacion, router]);

  /**
   * Cambiar de plantilla rehace la lista de apartados. Lo escrito no se pierde:
   * los que compartan clave conservan su texto y el resto sigue en `form` por si
   * se vuelve atrás — al registro solo va lo que esté en la lista al guardar.
   */
  function elegirPlantilla(key) {
    const p = plantillas.find((x) => x.key === key);
    if (!p) return;
    setPlantillaKey(key);
    setApartados(p.apartados.map((a) => ({ ...a })));
  }

  /**
   * Mete contenido en el registro y, si un apartado no está en la plantilla de
   * esta sesión, lo AÑADE al final en vez de escribir en un sitio invisible.
   *
   * `creados` son los apartados que la IA se propuso ella y que la profesional
   * ha aceptado (04/09/2026): vienen con su título y su tipo, así que se añaden
   * tal cual en vez de caer en el respaldo de abajo, que solo sabe los nombres
   * de los siete de fábrica.
   */
  function ponerContenido(nuevos, creados = []) {
    setForm((f) => ({ ...f, ...nuevos }));
    setApartados((prev) => {
      const porClave = new Map(
        (Array.isArray(creados) ? creados : []).filter((n) => n?.key && n?.label).map((n) => [n.key, n])
      );
      // Los tres del envoltorio —preparación, devolución y notas internas— NO
      // son apartados de plantilla: tienen su propia tarjeta y su columna. Si
      // se colaran aquí saldrían DOS veces en la pantalla y, peor, se guardarían
      // también dentro de `contentSections`.
      const faltan = Object.keys(nuevos).filter((k) => !esEnvoltorio(k) && !prev.some((a) => a.key === k));
      if (!faltan.length) return prev;
      return [
        ...prev,
        ...faltan.map((k) => {
          const creado = porClave.get(k);
          if (creado) return { key: k, label: creado.label, tipo: creado.tipo ?? "texto" };
          return { key: k, label: NOMBRES_AUDIO[k] ?? k, tipo: TIPO_AUDIO[k] ?? "texto" };
        }),
      ];
    });
  }

  // ¿Qué material entra en la PRÓXIMA pasada? De aquí salen los pasos que se
  // pintan, el rótulo del botón y lo que se manda al servidor: los tres tienen
  // que contar lo mismo o la pantalla vuelve a mentir.
  const conAudio = audios.lista.length > 0 && usarAudio;
  const queEntra = conAudio ? (audios.hayPendientes ? "audio" : "transcripcion") : "notas";
  const pasos = pasosDelProceso(queEntra);

  // Animación de los pasos mientras la petición está en vuelo.
  useEffect(() => {
    if (state !== STATE.PROCESSING) return;
    setProcessingStep(0);
    const t = setInterval(() => setProcessingStep((s) => Math.min(s + 1, pasos.length - 1)), 700);
    return () => clearInterval(t);
  }, [state, pasos.length]);

  /**
   * Los bloques de ESTE registro, en el orden de la pantalla: preparación · los
   * apartados de la plantilla elegida (con los sueltos añadidos aquí) ·
   * devolución de la familia · notas internas. Es la misma función que usa el
   * servidor para montar el prompt, así que lo que vuelve cae exactamente en los
   * apartados que se están viendo.
   */
  const bloques = bloquesDelRegistro(apartados);

  /**
   * Manda el MATERIAL —el audio, las notas escritas, o los dos— y PROPONE el
   * registro entero. No escribe nada: lo que vuelve se enseña en el panel y ella
   * decide apartado por apartado (01/09/2026, Rodrigo).
   */
  async function procesarConIA() {
    const texto = notas.trim();
    if (!conAudio && !texto) return;
    setErrorMsg(null);
    setAvisoAudio(null);
    // Lo que falte por transcribir se transcribe AHORA y aparte, para que el
    // texto quede guardado en la lista pase lo que pase después con Claude. Lo
    // normal es que no falte nada: la profesional le ha dado a «Transcribir»
    // mientras escribía y aquí solo se espera el reparto.
    let transcrito = audios.texto;
    if (conAudio && audios.hayPendientes) {
      setState(STATE.PROCESSING);
      transcrito = await audios.transcribir();
      if (!transcrito && !texto) {
        setState(STATE.FORM);
        return;
      }
    }
    setState(STATE.PROCESSING);
    try {
      const fd = new FormData();
      // Los audios ya no suben aquí: viaja su texto. Ni se paga Whisper dos
      // veces ni se espera dos veces por lo mismo, y la pasada deja de ser
      // «volver a intentar el audio» para ser lo que es — una propuesta nueva
      // con el material que hay ahora.
      if (conAudio && transcrito) fd.append("transcripcion", transcrito);
      if (texto) fd.append("texto", texto);
      // Los apartados del centro y lo ya tecleado viajan con el material: sin
      // ellos el servidor no sabría qué apartados tiene esta sesión y volvería a
      // proponer los siete de fábrica.
      fd.append("apartados", JSON.stringify(apartados));
      fd.append("escrito", JSON.stringify(form));
      // De quién es la sesión: el servidor lee de su ficha la edad y las áreas
      // para que la propuesta hable el idioma de ESTE paciente. El nombre no
      // sale del CRM (lib/clinica/estiloClinico.js).
      fd.append("patientId", id);
      const r = await fetch("/api/clinica/sessions/transcribe", { method: "POST", body: fd });
      const j = await leerRespuestaApi(r);
      if (!r.ok) throw new Error(j.error || "No se pudo procesar");
      // La duración la mide Whisper al transcribir, así que aquí el servidor no
      // la manda: se toma la que sabe la lista de audios AHORA (`duracionAhora`,
      // no `duracion`: si se transcribió en este mismo clic, `duracion` aún es
      // la del render anterior y decía 0) o el registro se guardaría como si
      // nunca hubiera habido audio.
      setResult({
        ...j.data,
        transcription: j.data.transcription || transcrito,
        audioDurationSec: j.data.audioDurationSec ?? (conAudio ? audios.duracionAhora() : null),
      });
      const p = j.data.propuesta ?? {};
      const cuantos = Object.values(p).filter((v) => String(v ?? "").trim()).length;
      // Los apartados que no existían: los que quepan, que el registro no puede
      // pasar de MAX_APARTADOS y quedarse a medias al guardar.
      const { entran, fuera } = cabenNuevos(j.data.nuevos ?? [], apartados.length, MAX_APARTADOS);
      setPropuesta(p);
      setNuevosIA(entran);
      // Con propuesta se abre el panel directamente: es a lo que ha venido.
      setVerPropuesta(cuantos > 0 || entran.length > 0);
      const cuantosAudios = audios.lista.length;
      const elAudio = cuantosAudios > 1 ? `Los ${cuantosAudios} audios` : "El audio";
      const deDonde = conAudio && texto ? `${elAudio} y tus notas` : conAudio ? elAudio : "Tus notas";
      const conNuevos = entran.length
        ? ` Y propone ${entran.length} apartado${entran.length === 1 ? "" : "s"} nuevo${entran.length === 1 ? "" : "s"} para lo que no cabía en los tuyos.`
        : fuera > 0
          ? ` (La IA proponía apartados nuevos, pero este registro ya tiene ${MAX_APARTADOS}: no caben.)`
          : "";
      setAvisoAudio(
        j.data.avisoIA ??
          (cuantos > 0
            ? `${deDonde}: la IA propone ${cuantos} apartado(s). Revísalos y elige cuáles entran.${conNuevos}`
            : entran.length > 0
              ? `${deDonde}: la IA no ha sabido repartirlo por tus apartados, pero propone ${entran.length} nuevo${entran.length === 1 ? "" : "s"}.`
              : `${deDonde}, pero la IA no ha sacado nada que repartir.`)
      );
      setState(STATE.FORM);
    } catch (e) {
      setErrorMsg(e.message);
      setState(STATE.FORM);
    }
  }

  // Quitar los audios NO borra las notas escritas: son dos fuentes distintas y
  // quien tenga las dos puede querer deshacerse solo de una.
  function quitarAudio() {
    audios.limpiar();
    setUsarAudio(true);
    setResult(null);
    setPropuesta(null);
    setNuevosIA([]);
    setVerPropuesta(false);
    setAvisoAudio(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Uno menos, con su transcripción. Los demás siguen donde estaban. */
  function quitarUnAudio(idAudio) {
    audios.quitar(idAudio);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Los audios se SUMAN: un audio nuevo no pisa al anterior (04/09/2026). */
  function ponerAudio(...ficheros) {
    audios.añadir(ficheros.flat());
    setUsarAudio(true);
    setErrorMsg(null);
  }

  /**
   * Transcribir SIN pasar por la IA (04/09/2026, Rodrigo). Es lo que permite
   * mandar los audios en cuanto están y seguir escribiendo mientras: la espera
   * de Whisper deja de estar delante del botón de la IA.
   */
  async function transcribirAudios() {
    setErrorMsg(null);
    setAvisoAudio(null);
    const antes = audios.pendientes.length;
    const texto = await audios.transcribir();
    if (texto) {
      setAvisoAudio(
        `${antes > 1 ? `${antes} audios transcritos` : "Audio transcrito"}. Puedes seguir escribiendo o pulsar el botón de la IA: ya no hay que esperar a la transcripción.`
      );
    }
  }

  // Grabar desde el propio CRM (03/09/2026, AV-0037): en iPhone el selector
  // de archivo no ofrece la grabadora. Lo grabado entra por `ponerAudio`,
  // como si se hubiera elegido un archivo.
  const grabadora = useGrabadora({ onAudio: ponerAudio, onError: setErrorMsg });

  /** Lo elegido en el panel entra en el formulario. Guardar sigue siendo suyo. */
  function aplicarPropuesta(cambios, creados = []) {
    const cuantos = Object.keys(cambios).length;
    const altas = Array.isArray(creados) ? creados.length : 0;
    ponerContenido(cambios, creados);
    setVerPropuesta(false);
    setAvisoAudio(
      cuantos > 0
        ? `Se han escrito ${cuantos} apartado(s) con la propuesta de la IA${
            altas > 0 ? `, ${altas} de ellos nuevos (los verás al final del punto 2)` : ""
          }. Revisa y edita antes de guardar.`
        : "No has aplicado ningún apartado."
    );
  }

  /**
   * La firma que se va a guardar: la elegida en el desplegable y, si aún no hay
   * ninguna (el equipo no ha cargado, o el centro no tiene el módulo), la de
   * siempre — el terapeuta principal del paciente. Nunca se queda vacía por el
   * camino: el alta la exige.
   */
  function firmaDeLaSesion() {
    return terapeutaId || sesion?.therapistId || patient?.mainTherapistId || "";
  }

  /** La hora que se ve en el input, tal cual. Sin zona: `new Date` la lee local. */
  function cuandoEsLaSesion() {
    const escrita = fecha ? new Date(fecha) : new Date();
    return Number.isNaN(escrita.getTime()) ? new Date() : escrita;
  }

  /**
   * Guardar una sesión que TODAVÍA NO SE HA DADO (flujo de la mañana del 26/08).
   * El cuerpo lo arma `payloadDePreparacion`, que NO manda los campos de la IA:
   * una sesión preparada no ha pasado por Whisper ni por Claude.
   *
   * Editando una que ya existe es un PATCH y solo viajan la preparación y el
   * día (01/09/2026): es lo único que se escribe en esta pantalla. Y el estado
   * NO se toca — guardar la preparación de una sesión ya registrada no puede
   * devolverla a «Borrador», que es lo que haría reusar el alta tal cual.
   */
  async function guardarPreparacion() {
    const firma = firmaDeLaSesion();
    if (!sesion && !firma) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      if (sesion) {
        await parchear(
          {
            prepText: form.prepText,
            sessionDate: cuandoEsLaSesion().toISOString(),
            // Quién la da también se corrige desde aquí: el servidor descarta el
            // campo si no ha cambiado y rechaza a quien no sea del centro.
            ...(firma ? { therapistId: firma } : {}),
          },
          "Preparación guardada"
        );
        return;
      }
      const payload = payloadDePreparacion({
        patientId: id,
        therapistId: firma,
        fecha: cuandoEsLaSesion(),
        prepText: form.prepText,
        bookingId: cita,
        // La foto de la plantilla con la que se está preparando (02/09/2026):
        // sin ella, la entrevista inicial se reabriría con el registro normal.
        plantilla: plantillaKey,
        apartados,
      });
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la preparación");
      await subirAdjuntos(j.data.id, "Preparación guardada");
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  /**
   * Guardar ENCIMA de la sesión que se está editando (01/09/2026, Rodrigo:
   * «también quiero poder editar a posteriori el propio registro de sesión»).
   *
   * Nunca crea nada: si esta pantalla se abrió sobre una sesión, todo lo que se
   * escriba va a ESA. Es la otra mitad de «una cita, un registro».
   */
  async function parchear(cambios, etiquetaOk) {
    const r = await fetch(`/api/clinica/sessions/${sesion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar el registro");
    await subirAdjuntos(sesion.id, etiquetaOk);
  }

  // Los adjuntos van DESPUÉS del POST: necesitan el id de la sesión recién
  // creada. Si alguno falla no se pierde la sesión: se avisa y se queda aquí.
  async function subirAdjuntos(idSesion, etiquetaOk) {
    const fallidos = [];
    for (const f of prepFiles) {
      const fd = new FormData();
      fd.append("file", f, f.name);
      const up = await fetch(`/api/clinica/sessions/${idSesion}/prep-files`, { method: "POST", body: fd });
      if (!up.ok) fallidos.push(f.name);
    }
    if (fallidos.length) {
      setErrorMsg(`${etiquetaOk}, pero no se pudieron subir: ${fallidos.join(", ")}. Puedes añadirlos desde la ficha.`);
      setSaving(false);
      return;
    }
    router.push(`/pacientes/${id}`);
  }

  // Un registro sin NADA escrito no es un registro: algo tiene que llevar.
  const hayContenido = Object.values(form).some((v) => String(v ?? "").trim());

  // Lo escrito FUERA de la preparación. Guardar solo la preparación NO se lo
  // lleva —`payloadDePreparacion` manda `prepText` y nada más—, así que la
  // pantalla lo dice antes en vez de tirarlo en silencio.
  const hayMasQueLaPreparacion = Object.entries(form).some(
    ([k, v]) => k !== "prepText" && String(v ?? "").trim()
  );

  /**
   * Guardar el registro entero. Crea la sesión si es nueva y ESCRIBE ENCIMA de
   * la que se está editando si ya existe (01/09/2026) — nunca las dos cosas.
   *
   * @param {boolean} cerrar  además de guardar, cerrar el registro («finalizar»)
   */
  async function guardarRegistro(cerrar = false) {
    const firma = firmaDeLaSesion();
    if (!sesion && !firma) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      // Los apartados de fábrica van a sus columnas de siempre y los nuevos a
      // `contentSections`, junto con la foto de con qué apartados se escribió
      // esto (lib/clinica/plantillas.js). Ese reparto NO se hace a mano aquí: lo
      // comparten este formulario y el cajón del informe.
      const reparto = repartirValoresDeSesion(desdeFormulario(form, apartados), apartados);
      reparto.contentSections[CLAVE_PLANTILLA] = plantillaKey;
      const cuerpo = {
        sessionDate: cuandoEsLaSesion().toISOString(),
        ...reparto,
        prepText: form.prepText,
        parentFeedback: form.parentFeedback,
        internalNotes: form.internalNotes,
        // Quién dio la sesión (01/09/2026). Viaja siempre que haya alguien
        // elegido; el servidor lo descarta si es el mismo que ya estaba y
        // rechaza el que no sea del equipo del centro.
        ...(firma ? { therapistId: firma } : {}),
      };

      // ── Editando: PATCH sobre la misma sesión ───────────────────────────
      if (sesion) {
        // Lo que ya guardaba el JSONB y el reparto no toca —de qué plantilla
        // salió, la nota individual de un taller— se conserva: sin esto,
        // editar un registro le borraría su procedencia.
        cuerpo.contentSections = { ...(sesion.contentSections ?? {}), ...reparto.contentSections };
        // El estado SUBE, nunca baja: un borrador que se escribe pasa a
        // «Registrada», una cerrada sigue cerrada salvo que se cierre a
        // propósito. Guardar no puede reabrir un registro cerrado ni devolver
        // a borrador uno ya escrito.
        if (cerrar) cuerpo.status = "published";
        else if (sesion.status === "draft" || sesion.status === "ai_pending") cuerpo.status = "registered";
        // El texto del que salió el registro solo si esta sesión no tenía —el
        // servidor tiene la última palabra: `aiTranscription` se escribe una
        // vez y no se pisa (sessions/[id]). `aiStructured` y la duración del
        // audio no se parchean: son la foto de con qué NACIÓ el registro.
        if (result && !String(sesion.aiTranscription ?? "").trim()) {
          cuerpo.aiTranscription = result.material ?? result.transcription;
          cuerpo.aiReviewedAt = new Date().toISOString();
        }
        await parchear(cuerpo, cerrar ? "Registro cerrado" : "Registro guardado");
        return;
      }

      // ── Estrenando: alta ────────────────────────────────────────────────
      const payload = {
        patientId: id,
        therapistId: firma,
        ...cuerpo,
        // De qué cita sale, si sale de una: es lo que hace que volver a esa
        // cita traiga ESTE registro y no uno nuevo (01/09/2026).
        ...(cita ? { bookingId: cita } : {}),
        status: cerrar ? "published" : "registered",
        // Solo si pasó por la IA. `aiTranscription` guarda el MATERIAL entero
        // —la transcripción del audio, las notas pegadas, o las dos—: es de
        // dónde salió el registro, y sin esto lo que ella escribiera y la IA no
        // supiera colocar se perdería al guardar. `audioDurationSec` viene a
        // null cuando no hubo audio, que es lo que distingue las dos vías. Un
        // registro escrito a mano de principio a fin no manda nada de esto.
        ...(result
          ? {
              aiTranscription: result.material ?? result.transcription,
              aiStructured: result.structured,
              audioDurationSec: result.audioDurationSec,
              aiReviewedAt: new Date().toISOString(),
            }
          : {}),
      };
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la sesión");
      await subirAdjuntos(j.data.id, "Sesión guardada");
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  /*
   * ── ARRASTRAR Y SOLTAR (28/08/2026, Lau de Aumenta) ───────────────────────
   * El audio le llega por WhatsApp y lo descarga: le queda a la vista en la
   * barra de descargas del navegador. Pulsar «Añadir audio» abría el explorador
   * de Windows y la obligaba a ir a buscar en Descargas el fichero que ya tenía
   * delante. Ahora se puede soltar encima de la tarjeta (y pegar con Ctrl+V),
   * sin quitar el clic de siempre para quien lo prefiera.
   *
   * Los ganchos van AQUÍ, antes de los `return` de carga: son hooks.
   */
  useEvitarSoltarFuera();

  const zonaAudio = useZonaSoltar({
    accept: ACEPTA_AUDIO,
    // Varios de golpe desde el 04/09/2026: quien descarga tres notas de voz de
    // WhatsApp las suelta las tres juntas. Se apaga solo cuando ya no caben.
    varios: true,
    queSeEspera: "audios de la sesión",
    apagada: state !== STATE.FORM || audios.hueco <= 0,
    pegar: true,
    onFicheros: (nuevos) => ponerAudio(nuevos),
    onAviso: setErrorMsg,
  });

  const zonaPrep = useZonaSoltar({
    accept: ACEPTA_PREP,
    varios: true,
    queSeEspera: "fotos, audios o PDF",
    onFicheros: (nuevos) => {
      setPrepFiles((prev) => [...prev, ...nuevos].slice(0, MAX_PREP));
      setErrorMsg(null);
    },
    onAviso: setErrorMsg,
  });

  /**
   * El nombre que se enseña cuando NO hay desplegable (el centro no tiene
   * módulo de equipo, o la lista aún no ha llegado).
   *
   * Manda la firma de la SESIÓN, no el terapeuta principal del paciente: eran
   * lo mismo hasta que se pudo cambiar, y desde entonces enseñar el del
   * paciente sería mentir justo en la pantalla desde la que se corrige.
   */
  const terapeutaDelEquipo = equipo.find((m) => m.id === terapeutaId);
  const therapistName =
    terapeutaDelEquipo?.displayName ??
    (sesion?.therapist?.name || (terapeutaId === patient?.mainTherapistId ? patient?.therapist?.name : null)) ??
    "—";
  const ta = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

  // Mientras se resuelve de qué sesión estamos hablando NO se pinta el
  // formulario. Es lo que evita que, llegando desde una cita que ya tiene
  // registro, se vea medio segundo un recuadro en blanco: quien se pusiera a
  // escribir en él perdería lo tecleado al saltar a la sesión de verdad.
  if (loadingPatient || resolviendo) return <div className="p-4 lg:p-8 text-sm text-neutral-400">Cargando…</div>;
  if (noEncontrada) {
    return (
      <div className={anchoPantalla("listado")}>
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Ese registro de sesión ya no existe.</p>
          <Link href={`/pacientes/${id}`} className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">← Volver a la ficha</Link>
        </div>
      </div>
    );
  }
  if (!patient) {
    return (
      <div className={anchoPantalla("listado")}>
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Paciente no encontrado.</p>
          <Link href="/pacientes" className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">← Volver al listado</Link>
        </div>
      </div>
    );
  }

  // Los adjuntos que YA tiene la sesión se pintan dentro de este mismo bloque:
  // sin ellos, editar un registro con material adjunto parecería un registro
  // sin material y alguien lo volvería a subir.
  const adjuntosPrep = (
    <div
      {...zonaPrep.props}
      className={`-mx-2 px-2 py-1.5 rounded-lg border border-dashed transition-colors ${
        zonaPrep.arrastrando ? "border-[var(--color-primary,#1B3A2D)] bg-neutral-50" : "border-transparent"
      }`}
    >
      {sesion?.prepFiles?.length > 0 && (
        <ul className="mb-2 space-y-1">
          {sesion.prepFiles.map((f) => (
            <li key={f.id} className="text-[11px] flex items-center gap-2">
              <a
                href={`/api/clinica/sessions/${sesion.id}/prep-files/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-primary,#1B3A2D)] hover:underline truncate"
              >
                {f.name}
              </a>
              <span className="text-neutral-400 shrink-0">ya guardado</span>
            </li>
          ))}
        </ul>
      )}
      <label className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline cursor-pointer">
        {zonaPrep.arrastrando ? "Suelta aquí los archivos" : "+ Adjuntar fotos, audio o PDF (o arrástralos aquí)"}
        <input
          type="file"
          multiple
          accept={ACEPTA_PREP}
          className="hidden"
          onChange={(e) => {
            const nuevos = Array.from(e.target.files ?? []);
            e.target.value = "";
            setPrepFiles((prev) => [...prev, ...nuevos].slice(0, MAX_PREP));
          }}
        />
      </label>
      {prepFiles.length > 0 && (
        <ul className="mt-2 space-y-1">
          {prepFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} className="text-[11px] text-neutral-600 flex items-center gap-2">
              <span className="truncate">{f.name}</span>
              <span className="text-neutral-400 shrink-0">{fmtSize(f.size)}</span>
              <button
                onClick={() => setPrepFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-rose-500 hover:text-rose-700 shrink-0"
              >
                quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-neutral-400 mt-1">
        Material interno del equipo: no se comparte con la familia.
      </p>
    </div>
  );

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Link href="/pacientes" className="hover:text-[var(--color-primary,#1B3A2D)]">Pacientes</Link>
        <span className="text-neutral-300">/</span>
        <Link href={`/pacientes/${id}`} className="hover:text-[var(--color-primary,#1B3A2D)]">{patient.firstName} {patient.lastName}</Link>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-700">{sesion ? "Registro de sesión" : "Nuevo registro"}</span>
      </nav>

      {/* ── El registro ya cerrado (01/09/2026) ────────────────────────────
          Editar una nota clínica cerrada es legítimo —se corrige una errata,
          se añade lo que la familia contó después—, pero tiene que verse que
          lo está. Se dice y se sigue: no se bloquea el formulario, porque el
          encargo era justo poder editarlo. Todo cambio queda en el registro de
          auditoría, como cualquier otro. */}
      {sesion?.status === "published" && (
        <div className="px-4 py-3 rounded-lg bg-violet-50 border border-violet-100 text-xs text-violet-900">
          <span className="font-semibold">Este registro está cerrado.</span> Puedes corregirlo y
          seguirá cerrado al guardar.
        </div>
      )}

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Lo que ha sacado la IA, para elegir apartado por apartado. Se le pasa
          `form` como «lo tuyo»: si ya habías escrito, la propuesta se enseña al
          lado y viene marcada la tuya. */}
      {verPropuesta && propuesta && (
        <PropuestaIA
          bloques={bloques}
          escrito={form}
          propuesta={propuesta}
          nuevos={nuevosIA}
          // El texto del que salió, tal cual se le mandó a la IA: si hubo audio
          // y notas, las dos cosas con su rótulo. El panel lo enseña plegado.
          transcription={result?.material ?? result?.transcription ?? ""}
          // El rótulo dice la verdad de por dónde entró: decir «del audio»
          // sobre unas notas pegadas es pequeño, pero es mentira.
          titulo={
            result?.audioDurationSec != null && notas.trim()
              ? "Lo que ha sacado la IA del audio y tus notas"
              : result?.audioDurationSec != null
                ? "Lo que ha sacado la IA del audio"
                : "Lo que ha sacado la IA de tus notas"
          }
          onAplicar={aplicarPropuesta}
          onCerrar={() => setVerPropuesta(false)}
          textoAplicar="Escribir en el registro"
        />
      )}

      {/* ── FORM: el registro completo, en texto y con el audio opcional ── */}
      {state === STATE.FORM && (
        <>
          <div className="bg-white border border-neutral-100 rounded-xl p-5 lg:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="eyebrow mb-1">{sesion ? "Registro de sesión" : "Nuevo registro de sesión"}</div>
                <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
                <FirmaDeLaSesion equipo={equipo} valor={terapeutaId} onCambio={setTerapeutaId} nombre={therapistName} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Día y hora de la sesión</div>
                <input type="datetime-local" className={ta} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Audio y notas, opcionales. Dentro del registro y no como puerta
              de entrada (26/08/2026, Rodrigo): el registro se escribe; el
              audio, si lo hay, lo adelanta. La tarjeta la comparte con el
              informe desde el 04/09/2026 (`MaterialIA`), que estrena su
              pantalla de redacción con este mismo material. */}
          <MaterialIA
            audios={audios}
            grabadora={grabadora}
            zonaAudio={zonaAudio}
            fileRef={fileRef}
            onAudios={ponerAudio}
            onQuitarAudio={quitarUnAudio}
            onQuitarTodos={quitarAudio}
            onTranscribir={transcribirAudios}
            notas={notas}
            onNotas={setNotas}
            usarAudio={usarAudio}
            onUsarAudio={setUsarAudio}
            queEntra={queEntra}
            conAudio={conAudio}
            onProcesar={procesarConIA}
            procesando={state !== STATE.FORM}
            sustantivo="el registro"
            titulo="¿Tienes audio o notas de la sesión?"
            descripcion={`Arrastra aquí los audios, pégalos con Ctrl+V o búscalos — puedes añadir varios (hasta ${MAX_AUDIOS}) y transcribirlos de una vez. O pega abajo lo que tengas apuntado. La IA te propone el registro entero, de la preparación a las notas internas; tú eliges qué entra. m4a, mp3, wav, ogg, webm · máx. 25 MB cada uno.`}
            ayuda={
              <>
                El audio sirve para sacar el texto y se descarta: en la sesión quedan la
                transcripción y la duración, no la grabación. Si quieres conservarla, guárdala tú.
                El texto que pegues sí se guarda con la sesión, como constancia de dónde salió el
                registro. Lo que adjuntes en «Preparación» también se queda.
              </>
            }
            aviso={avisoAudio ? `${avisoAudio}${result?.demo ? " (datos de demostración)" : ""}` : null}
            avisoExtra={
              /* El panel se puede volver a abrir mientras no se quite el
                 audio: se cierra sin querer, o se aplica media propuesta y
                 luego se ve que faltaba un apartado. */
              (propuesta && Object.values(propuesta).some((v) => String(v ?? "").trim())) || nuevosIA.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setVerPropuesta(true)}
                  className="shrink-0 font-medium text-emerald-900 underline hover:no-underline"
                >
                  Ver la propuesta de la IA
                </button>
              ) : null
            }
          />

          {/* 1 · Preparación */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow">1 · Preparación</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Lo que preparaste antes de la sesión. Se guarda con ella y sirve para redactar el informe.
            </p>
            {form.prepText.trim() && <AvisoPrepHeredada de={prepHeredadaDe} />}
            <textarea
              className={ta}
              rows={3}
              placeholder="Material previsto, hipótesis de trabajo, qué observar…"
              value={form.prepText}
              onChange={(e) => setForm({ ...form, prepText: e.target.value })}
            />
            {adjuntosPrep}
          </div>

          {/* 2 · Informe — sus apartados salen de la plantilla del centro
              (29/08/2026), y aquí se pueden añadir sueltos para esta sesión. */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-4">
            <div className="eyebrow">2 · Informe de la sesión</div>
            <ApartadosEditor
              apartados={apartados}
              valores={form}
              onValor={(clave, v) => setForm((f) => ({ ...f, [clave]: v }))}
              onApartados={setApartados}
              plantillas={plantillas}
              plantillaKey={plantillaKey}
              onPlantilla={elegirPlantilla}
              clavesDePlantilla={
                new Set(
                  (plantillas.find((x) => x.key === plantillaKey)?.apartados ?? PLANTILLA_BASE.registro.apartados).map(
                    (a) => a.key
                  )
                )
              }
            />
          </div>

          {/* 3 · Devolución de la familia */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow">3 · Devolución de la familia</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Lo que te han contado los padres al recoger: cómo ha ido la semana, qué han notado en casa.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Qué dice la familia…"
              value={form.parentFeedback}
              onChange={(e) => setForm({ ...form, parentFeedback: e.target.value })}
            />
          </div>

          {/* 4 · Notas internas — el único apartado que la familia no puede leer. */}
          <div className="bg-white border border-amber-200 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow text-amber-700">4 · Notas internas del equipo</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Solo para vosotros: implicación de la familia, cómo están los padres, actitudes.
              No sale en el informe que recibe la familia ni en su área privada, aunque se anexen los registros.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Lo que conviene que sepa el equipo y no la familia…"
              value={form.internalNotes}
              onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <p className="text-[11px] text-neutral-500 mr-auto">
              ¿Todavía no la has dado?{" "}
              <button
                type="button"
                onClick={() => setState(STATE.PREPARING)}
                className="font-medium text-[var(--color-primary,#1B3A2D)] hover:underline"
              >
                Guárdala solo como preparación
              </button>
            </p>
            <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
            {/* ── «…hasta que le dé a finalizar» (01/09/2026, Rodrigo) ──────
                Cerrar el registro se hacía SOLO desde el cajón de la ficha, así
                que el paso natural —escribo la sesión y la doy por terminada—
                obligaba a salir de esta pantalla y buscarla. Es el mismo estado
                («Cerrada») y el mismo botón de siempre, aquí donde se acaba de
                escribir. Solo mientras esté abierta: una cerrada ya lo está. */}
            {sesion && sesion.status !== "published" && (
              <button
                onClick={() => guardarRegistro(true)}
                disabled={saving || !hayContenido}
                title="Guarda y cierra el registro para el equipo. No lo comparte con nadie: para eso está «Enviar al paciente», en la ficha."
                className="text-xs px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 disabled:opacity-50"
              >
                Guardar y finalizar
              </button>
            )}
            <button
              onClick={() => guardarRegistro(false)}
              disabled={saving || !hayContenido}
              title={!hayContenido ? "Escribe algo del registro (o procesa un audio) para poder guardarlo" : undefined}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              {saving ? "Guardando…" : sesion ? "Guardar cambios" : "Guardar registro"}
            </button>
          </div>
        </>
      )}

      {/* ── PREPARING: la sesión que aún no se ha dado (flujo intacto) ────── */}
      {state === STATE.PREPARING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Preparar la sesión</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
            <div className="inline-flex justify-center mt-1">
              <FirmaDeLaSesion equipo={equipo} valor={terapeutaId} onCambio={setTerapeutaId} nombre={therapistName} />
            </div>
          </div>

          <div className="max-w-2xl mx-auto space-y-4">
            <p className="text-[11px] text-neutral-600 leading-relaxed bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2.5">
              Se guarda como <strong>borrador</strong>: queda apuntada en la ficha con lo que
              prepares, y el día de la sesión se completa encima —escribiéndola o con el audio.
              Mientras su fecha no haya llegado no cuenta como sesión dada.
            </p>

            {/* Se llega aquí desde el registro completo, y de ahí solo viaja la
                preparación. Si hay algo más escrito se avisa: perderlo sin
                decirlo es justo lo que hacía esta pantalla antes del 01/09. */}
            {hayMasQueLaPreparacion && (
              <p className="text-[11px] text-amber-800 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                Aquí se guarda <strong>solo la preparación</strong>. Lo que hayas escrito en el
                informe de la sesión, en la devolución de la familia o en las notas internas no
                entra en el borrador: vuelve al{" "}
                <button
                  type="button"
                  onClick={() => setState(STATE.FORM)}
                  className="font-medium underline"
                >
                  registro completo
                </button>{" "}
                si quieres guardarlo todo.
              </p>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Día y hora de la sesión</div>
              <input
                type="datetime-local"
                className={ta}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Preparación</div>
              {form.prepText.trim() && (
                <div className="mb-1.5">
                  <AvisoPrepHeredada de={prepHeredadaDe} />
                </div>
              )}
              <textarea
                className={ta}
                rows={6}
                placeholder="Material previsto, hipótesis de trabajo, qué observar…"
                value={form.prepText}
                onChange={(e) => setForm((f) => ({ ...f, prepText: e.target.value }))}
              />
            </div>

            {adjuntosPrep}

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
              <button onClick={() => setState(STATE.FORM)} disabled={saving} className="text-xs px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 disabled:opacity-50">Hacer el registro completo</button>
              <button
                onClick={guardarPreparacion}
                disabled={saving || !form.prepText.trim()}
                title={!form.prepText.trim() ? "Escribe la preparación para poder guardarla" : undefined}
                className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                {saving ? "Guardando…" : "Guardar preparación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {state === STATE.PROCESSING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-8 lg:p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-5" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 animate-spin"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
          </div>
          <h2 className="font-display text-xl lg:text-2xl text-[var(--ink-900)]">
            {conAudio ? "Procesando el audio con IA" : "Rellenando el registro con tus notas"}
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            {conAudio
              ? audios.lista.length > 1
                ? `${audios.lista.length} audios`
                : (audios.lista[0]?.nombre ?? "un audio")
              : `${notas.trim().length.toLocaleString("es-ES")} caracteres`}
          </p>
          <ul className="mt-8 max-w-md mx-auto space-y-2 text-left">
            {pasos.map((step, i) => {
              const done = i < processingStep;
              const current = i === processingStep;
              return (
                <li key={i} className="flex items-center gap-2.5 text-xs">
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${done ? "bg-emerald-500 text-white" : current ? "bg-neutral-100" : "bg-neutral-50"}`}>
                    {done && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    {current && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary,#1B3A2D)] animate-pulse" />}
                  </span>
                  <span className={done ? "text-neutral-500 line-through" : current ? "text-[var(--ink-900)] font-medium" : "text-neutral-400"}>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

