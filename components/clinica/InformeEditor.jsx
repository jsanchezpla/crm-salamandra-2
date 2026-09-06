"use client";

/**
 * components/clinica/InformeEditor.jsx — LA pantalla donde se escribe un
 * informe clínico (04/09/2026, Rodrigo).
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * «A la hora de crear un informe no se abre una pantalla tipo la de Registrar
 * una sesión. Se crea y me lleva directamente a una vista lateral tipo la de
 * revisión final, donde por cierto no pone un botón de Editar informe. Debería
 * ser la pantalla inicial de creación de un informe tras elegir fecha, paciente
 * y tipo, como la del Registro: con su IA, sus notas y sus campos.»
 *
 * Y era exactamente así: crear un informe abría el CAJÓN lateral —el mismo por
 * el que se pasa a repasar uno ya escrito—, con 720 px de ancho para escribir
 * un documento de siete apartados y sin ninguna pista de que aquello era el
 * sitio donde se redacta. El registro de sesión llevaba desde el 01/09 con su
 * pantalla entera; el informe se había quedado atrás.
 *
 * Así que el informe pasa a tener la MISMA forma que el registro, y con las
 * mismas piezas, no con copias:
 *
 *   · la cabecera con lo que se eligió al crearlo —paciente, tipo, fecha— y
 *     que aquí se puede corregir;
 *   · `MaterialIA`: los audios y el bloc de notas, la tarjeta compartida con el
 *     registro. El informe se puede DICTAR (`/desde-material`), que es lo que
 *     faltaba: hasta hoy sus dos ayudas partían de lo ya guardado;
 *   · las dos de siempre, que no se tocan: volcar las sesiones elegidas y pulir
 *     ese volcado con IA;
 *   · `PropuestaIA`: venga de donde venga la propuesta —del dictado o del
 *     pulido—, se elige apartado por apartado en el mismo panel;
 *   · `ApartadosEditor`: los campos, que se renombran, se ordenan y se añaden
 *     para ESTE informe sin tocar la plantilla del centro.
 *
 * El cajón (`InformeDrawer`) se queda con lo que de verdad es: la revisión
 * final, de solo lectura, con su botón «Editar informe» que trae aquí.
 *
 * (Componente y no página, como `RegistroSesionEditor` y por lo mismo: la ruta
 * es una línea y el formulario vive en un solo sitio.)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import useZonaSoltar, { useEvitarSoltarFuera } from "@/components/ui/useZonaSoltar.js";
import useAudios from "@/components/clinica/useAudios.js";
import useGrabadora from "@/components/clinica/useGrabadora.js";
import ApartadosEditor from "@/components/clinica/ApartadosEditor.jsx";
import MaterialIA, { ACEPTA_AUDIO } from "@/components/clinica/MaterialIA.jsx";
import PropuestaIA from "@/components/clinica/PropuestaIA.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import {
  aFormulario,
  apartadosConPlantillas,
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
  desdeFormulario,
  MAX_APARTADOS,
  PLANTILLA_BASE,
} from "@/lib/clinica/plantillas.js";
import { cabenNuevos } from "@/lib/clinica/apartadosPropuestos.js";
import { MAX_AUDIOS } from "@/lib/clinica/audios.js";
import { SECCIONES_BECA } from "@/lib/clinica/beca.js";
import { CLAVE_PRUEBAS, TIPO_DIAGNOSTICO, normalizarPruebas } from "@/lib/clinica/pruebasDiagnosticas.js";
import PruebasDiagnosticas from "@/components/clinica/PruebasDiagnosticas.jsx";
import { REPORT_TYPES_NUEVOS, REPORT_TYPE_LABEL, nombreDelInforme } from "@/lib/clinica/serialize.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

const TA = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const soloDia = (d) => (d ? String(d).slice(0, 10) : "");

const STATUS_STYLES = {
  draft: { bg: "bg-neutral-100", text: "text-neutral-600", dot: "bg-neutral-400" },
  reviewed: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  delivered: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
};

// Pistas bajo el título de algunos apartados de fábrica. Un apartado que el
// centro se invente no lleva ninguna: nadie sabe qué poner ahí mejor que quien
// lo creó.
const AYUDAS = {
  evolution: "Un párrafo por línea; lo volcado viene con su fecha delante.",
};

/**
 * Los cinco apartados que salen del volcado de sesiones y que, por tanto, se
 * pueden pulir. Los otros dos —motivo de intervención y propuesta de
 * continuidad— los escribe la profesional y ni siquiera se le mandan al modelo.
 *
 * Copiados de `lib/clinica/pulirInforme.js` a propósito: ese fichero importa el
 * SDK de Anthropic, y traerlo aquí lo metería en el paquete del NAVEGADOR.
 * Si cambian allí, cambian aquí — son cinco claves que no se renombran nunca.
 */
const NOMBRES_PULIDO = {
  objectives: "Objetivos de trabajo",
  evolution: "Evolución",
  achievements: "Logros",
  persistentDifficulties: "Dificultades que persisten",
  recommendations: "Recomendaciones",
};

export default function InformeEditor({ reportId }) {
  const router = useRouter();
  const { confirmar, dialogo } = useDialogo();

  const [report, setReport] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  // La cabecera: lo que se eligió al crearlo y aquí se corrige.
  const [tipo, setTipo] = useState("evolution");
  const [fecha, setFecha] = useState("");
  const [entrega, setEntrega] = useState("");

  const [plantillas, setPlantillas] = useState([]);
  const [plantillaKey, setPlantillaKey] = useState("");
  const [apartados, setApartados] = useState([]);
  const [form, setForm] = useState({});
  const [extra, setExtra] = useState({ referralSpecialty: "", anexarRegistros: false });
  // Las pruebas con puntuaciones del informe de diagnóstico (05/09/2026,
  // AV-0045): viven en `contentSections.pruebas`, aparte de los apartados.
  const [pruebas, setPruebas] = useState([]);
  const [sesiones, setSesiones] = useState([]);
  const [elegidas, setElegidas] = useState(new Set());
  const [derivaciones, setDerivaciones] = useState([]);

  // El material y lo que sale de él.
  const [notas, setNotas] = useState("");
  const [usarAudio, setUsarAudio] = useState(true);
  const [propuesta, setPropuesta] = useState(null);
  const [nuevosIA, setNuevosIA] = useState([]);
  const [verPropuesta, setVerPropuesta] = useState(false);
  const [materialIA, setMaterialIA] = useState("");
  const [tituloPropuesta, setTituloPropuesta] = useState("Lo que ha sacado la IA");

  const [guardando, setGuardando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [avisoIA, setAvisoIA] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [pdfDeRespaldo, setPdfDeRespaldo] = useState(null);

  const fileRef = useRef(null);
  const audios = useAudios({ onError: setErrorMsg, onAviso: setAvisoIA });

  const esBeca = tipo === "beca";
  const entregado = report?.status === "delivered";

  /* ═══ Cargar ═══════════════════════════════════════════════════════════ */

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      const plantillasDelCentro = await fetch("/api/clinica/plantillas", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.data?.informe ?? [])
        .catch(() => []);
      const j = await fetch(`/api/clinica/reports/${reportId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!vivo) return;
      setPlantillas(plantillasDelCentro);
      if (!j?.ok || !j?.data) {
        setNoEncontrado(true);
        setCargando(false);
        return;
      }
      volcarInforme(j.data, plantillasDelCentro);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  /**
   * El informe guardado → el formulario. Los apartados salen de la FOTO que
   * guardó él (`apartadosConPlantillas`), no de la plantilla de hoy: un informe
   * de hace un año se sigue escribiendo con SUS títulos.
   */
  function volcarInforme(r, plantillasDelCentro) {
    const cs = r.contentSections ?? {};
    setReport(r);
    setTipo(r.type ?? "evolution");
    setFecha(soloDia(r.reportDate));
    setEntrega(soloDia(r.dueDate));
    const suyos =
      r.type === "beca"
        ? SECCIONES_BECA.map((s) => ({ ...s }))
        : apartadosConPlantillas(cs, plantillasDelCentro ?? plantillas);
    const lista = suyos.length ? suyos : PLANTILLA_BASE.informe.apartados.map((a) => ({ ...a }));
    setApartados(lista);
    setPlantillaKey(cs[CLAVE_PLANTILLA] ?? "");
    setForm(aFormulario(cs, lista));
    setExtra({
      referralSpecialty: cs.referralSpecialty ?? "",
      // Anexar al PDF los registros literales de las sesiones (26/08/2026,
      // Rodrigo): apagado por defecto — el informe es la redacción.
      anexarRegistros: cs.anexarRegistros === true,
    });
    setElegidas(new Set(cs.sourceSessionIds ?? []));
    setPruebas(normalizarPruebas(cs[CLAVE_PRUEBAS]));
  }

  useEffect(() => {
    if (!report?.patientId) return;
    // Solo las sesiones COMPLETADAS: un borrador a medias no es material para
    // un informe que firma la profesional.
    fetch(`/api/clinica/sessions?patientId=${report.patientId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSesiones((j?.data?.sessions ?? []).filter((s) => s.status === "registered" || s.status === "published")))
      .catch(() => {});
  }, [report?.patientId]);

  useEffect(() => {
    if (tipo !== "referral" || derivaciones.length) return;
    fetch("/api/clinica/derivaciones", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDerivaciones(j?.data?.especialidades ?? []))
      .catch(() => {});
  }, [tipo, derivaciones.length]);

  /* ═══ Apartados ════════════════════════════════════════════════════════ */

  const clavesDePlantilla = useMemo(() => {
    const p = plantillas.find((x) => x.key === plantillaKey) ?? plantillas[0];
    return p ? new Set(p.apartados.map((a) => a.key)) : null;
  }, [plantillas, plantillaKey]);

  /**
   * Cambiar de plantilla rehace la lista de apartados con los de la nueva. Lo
   * escrito NO se pierde: los apartados que compartan clave conservan su texto,
   * y el de los que se van sigue en `form` por si se vuelve atrás — al PDF solo
   * va lo que esté en la lista al guardar.
   */
  function elegirPlantilla(key) {
    const p = plantillas.find((x) => x.key === key);
    if (!p) return;
    setPlantillaKey(key);
    setApartados(p.apartados.map((a) => ({ ...a })));
    setForm((f) => ({ ...aFormulario({}, p.apartados), ...f }));
  }

  /**
   * Mete contenido en el informe y, si un apartado no está en la lista de este
   * informe, lo AÑADE al final en vez de escribir en un sitio que no se ve.
   * `creados` son los que propuso la IA, con su título y su tipo.
   */
  function ponerContenido(valores, creados = []) {
    setForm((f) => ({ ...f, ...valores }));
    setApartados((prev) => {
      const porClave = new Map(
        (Array.isArray(creados) ? creados : []).filter((n) => n?.key && n?.label).map((n) => [n.key, n])
      );
      const faltan = Object.keys(valores).filter((k) => !prev.some((a) => a.key === k));
      if (!faltan.length) return prev;
      return [
        ...prev,
        ...faltan.map((k) => {
          const creado = porClave.get(k);
          return {
            key: k,
            label: creado?.label ?? NOMBRES_PULIDO[k] ?? k,
            tipo: creado?.tipo ?? "lista",
          };
        }),
      ];
    });
  }

  /** Los apartados como bloques, que es lo que entiende `PropuestaIA`. */
  const bloques = useMemo(
    () => apartados.map((a) => ({ key: a.key, label: a.label, tipo: a.tipo })),
    [apartados]
  );

  /* ═══ Guardar ══════════════════════════════════════════════════════════ */

  async function guardar({ callado = false } = {}) {
    setGuardando(true);
    setErrorMsg(null);
    if (!callado) setAviso(null);
    try {
      const cs = report?.contentSections ?? {};
      const r = await fetch(`/api/clinica/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: tipo,
          reportDate: fecha || null,
          dueDate: entrega || null,
          contentSections: {
            ...cs,
            ...desdeFormulario(form, apartados),
            // La FOTO: con qué apartados se escribió este informe. Es lo que
            // hace que dentro de un año siga imprimiéndose con estos títulos
            // aunque el centro haya cambiado su plantilla entera.
            [CLAVE_APARTADOS]: apartados,
            [CLAVE_PLANTILLA]: plantillaKey,
            referralSpecialty: extra.referralSpecialty || "",
            anexarRegistros: !!extra.anexarRegistros,
            sourceSessionIds: [...elegidas],
            [CLAVE_PRUEBAS]: pruebas,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      // El PATCH devuelve el informe SIN paciente ni terapeuta (no los trae
      // `include`), así que se conservan los que ya se tenían: si no, guardar
      // dejaba la cabecera con un «—» donde estaba el nombre del paciente.
      if (j.data) {
        setReport((prev) => ({
          ...j.data,
          patient: j.data.patient ?? prev?.patient ?? null,
          therapist: j.data.therapist ?? prev?.therapist ?? null,
        }));
      }
      if (!callado) setAviso("Informe guardado.");
      return true;
    } catch (e) {
      setErrorMsg(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  }

  /**
   * «Ver PDF» — GUARDA lo que hay en pantalla y LUEGO abre el PDF
   * (01/09/2026, Rodrigo: la casilla del anexo solo movía el estado de la
   * pantalla, así que el PDF salía con lo último guardado y parecía cacheado).
   *
   * La pestaña se abre ANTES del `await` a propósito: `window.open` solo se
   * permite dentro del gesto del usuario, y después del guardado el bloqueador
   * de ventanas emergentes se la come sin decir nada.
   */
  async function verPdf() {
    setErrorMsg(null);
    setAviso(null);
    setPdfDeRespaldo(null);
    // SIN `noopener`: con esa opción `window.open` devuelve `null` por
    // especificación aunque la pestaña se abra, y siempre se caía al aviso.
    const pestana = window.open("", "_blank");
    // El sello de tiempo es para el visor del navegador, no para el servidor
    // (el PDF se genera entero en cada petición y sale con `no-store`).
    const url = `/api/clinica/reports/${reportId}/pdf?v=${Date.now()}`;
    const ok = await guardar({ callado: true });
    if (!ok) {
      pestana?.close();
      return;
    }
    if (pestana) {
      pestana.location.replace(url);
    } else if (!window.open(url, "_blank")) {
      setPdfDeRespaldo(url);
      setAviso("Informe guardado. El navegador no ha dejado abrir la pestaña:");
    }
  }

  /**
   * «Enviar al paciente» — también guarda antes: el endpoint genera el PDF
   * leyendo el informe de la base de datos, y con cambios sin guardar la
   * familia recibiría un documento distinto del que se firmó en pantalla.
   */
  async function enviar() {
    if (!(await guardar({ callado: true }))) return;
    setEnviando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/reports/${reportId}/enviar`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo enviar el informe");
      setAviso("Informe enviado al área privada de la familia.");
      const fresco = await fetch(`/api/clinica/reports/${reportId}`, { cache: "no-store" })
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (fresco?.data) setReport(fresco.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setEnviando(false);
    }
  }

  /**
   * BORRAR UN INFORME ABIERTO POR ERROR (02/09/2026, AV-0021 de Aumenta). Solo
   * un borrador; quién puede lo decide el servidor.
   */
  async function borrar() {
    if (borrando) return;
    const seguro = await confirmar({
      titulo: "Borrar este informe",
      texto: "Se borra el borrador entero, con todo lo escrito. No se puede deshacer.",
      confirmar: "Borrar",
      tono: "peligro",
    });
    if (!seguro) return;
    setBorrando(true);
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/clinica/reports/${reportId}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo borrar el informe");
      router.push("/clinica/informes");
    } catch (e) {
      setErrorMsg(e.message);
      setBorrando(false);
    }
  }

  /* ═══ El material y la IA ══════════════════════════════════════════════ */

  useEvitarSoltarFuera();

  const zonaAudio = useZonaSoltar({
    accept: ACEPTA_AUDIO,
    varios: true,
    queSeEspera: "audios para el informe",
    apagada: procesando || audios.hueco <= 0,
    pegar: true,
    onFicheros: (nuevos) => ponerAudio(nuevos),
    onAviso: setErrorMsg,
  });

  function ponerAudio(...ficheros) {
    audios.añadir(ficheros.flat());
    setUsarAudio(true);
    setErrorMsg(null);
  }

  const grabadora = useGrabadora({ onAudio: ponerAudio, onError: setErrorMsg });

  function quitarUnAudio(idAudio) {
    audios.quitar(idAudio);
    if (fileRef.current) fileRef.current.value = "";
  }

  function quitarAudios() {
    audios.limpiar();
    setUsarAudio(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function transcribirAudios() {
    setErrorMsg(null);
    setAvisoIA(null);
    const antes = audios.pendientes.length;
    const texto = await audios.transcribir();
    if (texto) {
      setAvisoIA(
        `${antes > 1 ? `${antes} audios transcritos` : "Audio transcrito"}. Puedes seguir escribiendo o pulsar el botón de la IA.`
      );
    }
  }

  const conAudio = audios.lista.length > 0 && usarAudio;
  const queEntra = conAudio ? (audios.hayPendientes ? "audio" : "transcripcion") : "notas";

  /**
   * Manda el MATERIAL —los audios, las notas, o los dos— y PROPONE el informe
   * entero. No escribe nada: lo que vuelve se elige apartado por apartado.
   */
  async function procesarConIA() {
    const texto = notas.trim();
    if (!conAudio && !texto) return;
    setErrorMsg(null);
    setAvisoIA(null);
    let transcrito = audios.texto;
    if (conAudio && audios.hayPendientes) {
      setProcesando(true);
      transcrito = await audios.transcribir();
      if (!transcrito && !texto) {
        setProcesando(false);
        return;
      }
    }
    setProcesando(true);
    try {
      // Lo que hay en pantalla se guarda antes: el endpoint lee el informe de
      // la base de datos para saber de quién es y en qué estado está.
      if (!(await guardar({ callado: true }))) return;
      const fd = new FormData();
      if (conAudio && transcrito) fd.append("transcripcion", transcrito);
      if (texto) fd.append("texto", texto);
      // Los apartados que se están viendo y lo ya tecleado viajan con el
      // material: sin ellos el servidor volvería a proponer los de fábrica.
      fd.append("apartados", JSON.stringify(apartados));
      fd.append("escrito", JSON.stringify(form));
      const r = await fetch(`/api/clinica/reports/${reportId}/desde-material`, { method: "POST", body: fd });
      const j = await leerRespuestaApi(r);
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo redactar");
      const p = j.data.propuesta ?? {};
      const cuantos = Object.values(p).filter((v) => String(v ?? "").trim()).length;
      const { entran, fuera } = cabenNuevos(j.data.nuevos ?? [], apartados.length, MAX_APARTADOS);
      setPropuesta(p);
      setNuevosIA(entran);
      setMaterialIA(String(j.data.material ?? "").trim());
      setTituloPropuesta(
        conAudio && texto
          ? "Lo que ha sacado la IA del audio y tus notas"
          : conAudio
            ? "Lo que ha sacado la IA del audio"
            : "Lo que ha sacado la IA de tus notas"
      );
      setVerPropuesta(cuantos > 0 || entran.length > 0);
      const conNuevos = entran.length
        ? ` Y propone ${entran.length} apartado${entran.length === 1 ? "" : "s"} nuevo${entran.length === 1 ? "" : "s"} para lo que no cabía en los tuyos.`
        : fuera > 0
          ? ` (Proponía apartados nuevos, pero este informe ya tiene ${MAX_APARTADOS}: no caben.)`
          : "";
      setAvisoIA(
        j.data.avisoIA ??
          (cuantos > 0 || entran.length > 0
            ? `La IA propone ${cuantos} apartado(s). Revísalos y elige cuáles entran.${conNuevos}`
            : "La IA no ha sacado nada que repartir de este material.")
      );
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setProcesando(false);
    }
  }

  /** Vuelca el contenido de las sesiones marcadas. Escribe en la base de datos. */
  async function volcarSesiones() {
    if (elegidas.size === 0) {
      setErrorMsg("Marca las sesiones que quieres volcar al informe.");
      return;
    }
    setGuardando(true);
    setErrorMsg(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/clinica/reports/${reportId}/desde-sesiones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: [...elegidas] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo redactar");
      const nc = j.data.contentSections ?? {};
      ponerContenido(Object.fromEntries(Object.keys(NOMBRES_PULIDO).map((k) => [k, (nc[k] ?? []).join("\n")])));
      const a = j.data.aporte ?? {};
      // Decir QUÉ ha traído: si no, se pulsa el botón, la pantalla cambia poco
      // y parece que no ha hecho nada.
      setAviso(
        `Volcadas ${a.sesiones} sesiones: ${a.evolucion ?? 0} líneas de evolución, ${a.objetivos ?? 0} objetivos, ` +
          `${a.dificultades ?? 0} dificultades y ${a.recomendaciones ?? 0} recomendaciones. Repásalo antes de enviarlo.`
      );
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setGuardando(false);
    }
  }

  // Solo tiene sentido pulir lo que ya está volcado: la IA redacta anotaciones,
  // no las inventa.
  const hayQuePulir = Object.keys(NOMBRES_PULIDO).some((k) => (form[k] ?? "").trim().length > 0);

  /**
   * Pide la redacción asistida del volcado. Lo que vuelve NO se guarda: se
   * enseña en el mismo panel que el dictado, para decidir apartado por apartado.
   */
  async function pulirConIa() {
    setProcesando(true);
    setErrorMsg(null);
    setAviso(null);
    setAvisoIA(null);
    try {
      // Si tiene cambios sin guardar, se guardan primero: el endpoint lee el
      // informe de la base de datos, y pulir la versión de ayer confunde más
      // que ayuda.
      if (!(await guardar({ callado: true }))) return;
      const r = await fetch(`/api/clinica/reports/${reportId}/pulir`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo redactar");
      const bruta = j.data.propuesta ?? {};
      const p = Object.fromEntries(
        Object.entries(bruta).map(([k, v]) => [k, Array.isArray(v) ? v.join("\n") : String(v ?? "")])
      );
      // Lo que la IA propone para un apartado que ESTE informe no tiene —un
      // centro con plantilla propia sin «Logros», «Recomendaciones» o
      // «Propuesta de continuidad»— no se tira: entra como apartado nuevo, a
      // aceptar uno a uno como los del dictado (revisión del 06/09/2026).
      const conocidas = new Set(apartados.map((a) => a.key));
      const sinSitio = Object.entries(p)
        .filter(([k, v]) => !conocidas.has(k) && v.trim())
        .map(([k, v]) => ({ key: k, label: NOMBRES_PULIDO[k] ?? k, tipo: "texto", valor: v }));
      setPropuesta(Object.fromEntries(Object.entries(p).filter(([k]) => conocidas.has(k))));
      setNuevosIA(sinSitio);
      setMaterialIA("");
      setTituloPropuesta(`Redacción del volcado${j.data.simulado ? " (simulada — demo)" : ""}`);
      setVerPropuesta(true);
      const avisos = j.data.avisos ?? [];
      setAvisoIA(
        avisos.length
          ? avisos.join(" ")
          : "La IA ha redactado el volcado. Repásalo apartado por apartado antes de aplicarlo."
      );
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setProcesando(false);
    }
  }

  /** Lo elegido en el panel entra en el formulario. Guardar sigue siendo suyo. */
  function aplicarPropuesta(cambios, creados = []) {
    const cuantos = Object.keys(cambios).length;
    const altas = Array.isArray(creados) ? creados.length : 0;
    ponerContenido(cambios, creados);
    setVerPropuesta(false);
    setAvisoIA(
      cuantos > 0
        ? `Se han escrito ${cuantos} apartado(s) con la propuesta de la IA${
            altas > 0 ? `, ${altas} de ellos nuevos (al final del informe)` : ""
          }. Revisa y guarda.`
        : "No has aplicado ningún apartado."
    );
  }

  /* ═══ Pantalla ═════════════════════════════════════════════════════════ */

  if (cargando) return <div className="p-4 lg:p-8 text-neutral-400 text-sm">Cargando informe…</div>;
  if (noEncontrado || !report) {
    return (
      <div className={anchoPantalla("listado")}>
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Informe no encontrado.</p>
          <Link href="/clinica/informes" className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">
            ← Volver a Informes
          </Link>
        </div>
      </div>
    );
  }

  const patient = report.patient ?? { name: "—", age: null };
  const therapist = report.therapist ?? { name: "—" };
  const st = STATUS_STYLES[report.status] ?? STATUS_STYLES.draft;
  // El tipo de un informe viejo (`admission`) ya no se ofrece al crear, pero
  // tiene que seguir saliendo en el desplegable del suyo o cambiaría solo.
  const opcionesTipo = (REPORT_TYPES_NUEVOS.includes(tipo) ? REPORT_TYPES_NUEVOS : [tipo, ...REPORT_TYPES_NUEVOS]).map(
    (value) => ({ value, label: REPORT_TYPE_LABEL[value] ?? value })
  );

  return (
    <div className={`${anchoPantalla("listado")} space-y-4`}>
      <Link href="/clinica/informes" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Volver a Informes
      </Link>

      {/* El panel de la IA, por encima de todo. Se le pasa `form` como «lo
          tuyo»: si ya habías escrito, la propuesta se enseña al lado. */}
      {verPropuesta && propuesta && (
        <PropuestaIA
          bloques={bloques}
          escrito={form}
          propuesta={propuesta}
          nuevos={nuevosIA}
          transcription={materialIA}
          titulo={tituloPropuesta}
          guardando={guardando}
          onAplicar={aplicarPropuesta}
          onCerrar={() => setVerPropuesta(false)}
          textoAplicar="Escribir en el informe"
        />
      )}

      {/* ── Cabecera: paciente, tipo y fechas ─────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-xl p-5 lg:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow mb-1">{nombreDelInforme(tipo)}</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">
              {patient.name}
              {(patient.edad ?? patient.age) != null && (
                <span className="text-neutral-400 font-normal text-xl"> · {patient.edad ?? patient.age} años</span>
              )}
            </h1>
            <p className="text-[11px] text-neutral-500 mt-1">
              {therapist.name} · creado el {fmtDate(report.reportDate)}
              <span className={`ml-2 inline-flex items-center gap-1.5 ${st.bg} ${st.text} text-[10px] font-medium px-2 py-0.5 rounded-full align-middle`}>
                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                {report.statusLabel}
              </span>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Tipo</div>
              <Select value={tipo} onChange={setTipo} options={opcionesTipo} className={TA} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Fecha del informe</div>
              <input type="date" className={TA} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Entrega</div>
              <input
                type="date"
                className={TA}
                value={entrega}
                onChange={(e) => setEntrega(e.target.value)}
                title="Cuándo toca entregarlo. Sin fecha, no cuenta como entrega vencida."
              />
            </div>
          </div>
        </div>
      </div>

      {entregado && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5 text-[11px] text-emerald-900">
          Este informe ya está en el área privada de la familia. Si lo cambias, vuelve a
          enviarlo para que tengan la versión buena.
        </div>
      )}

      {esBeca && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 text-[11px] text-neutral-600">
          Este informe es el de la <span className="font-medium">beca de apoyo educativo</span>: lleva
          solo motivo de consulta, objetivos y metodología —los que pide la convocatoria, y por eso
          no se pueden cambiar ni añadir—, y en el PDF la cabecera dice el servicio con su nombre
          oficial y la firma del terapeuta al pie.
        </div>
      )}

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* ── 1 · El material: audio y notas (en la beca también vale) ──────── */}
      <MaterialIA
        audios={audios}
        grabadora={grabadora}
        zonaAudio={zonaAudio}
        fileRef={fileRef}
        onAudios={ponerAudio}
        onQuitarAudio={quitarUnAudio}
        onQuitarTodos={quitarAudios}
        onTranscribir={transcribirAudios}
        notas={notas}
        onNotas={setNotas}
        usarAudio={usarAudio}
        onUsarAudio={setUsarAudio}
        queEntra={queEntra}
        conAudio={conAudio}
        onProcesar={procesarConIA}
        procesando={procesando || guardando}
        sustantivo="el informe"
        titulo="¿Quieres dictar el informe o pegar tus notas?"
        descripcion={`Arrastra aquí los audios, pégalos con Ctrl+V o búscalos — puedes añadir varios (hasta ${MAX_AUDIOS}) y transcribirlos de una vez. O pega abajo lo que tengas apuntado. La IA reparte lo que cuentes por los apartados del informe; tú eliges qué entra. m4a, mp3, wav, ogg, webm · máx. 25 MB cada uno.`}
        ayuda={
          <>
            El audio sirve para sacar el texto y se descarta: no se guarda la grabación. Lo que la
            IA propone no se escribe solo — lo eliges apartado por apartado y el informe lo firmas
            tú. Si lo que quieres es partir de las sesiones ya escritas, usa el bloque de abajo.
          </>
        }
        aviso={avisoIA}
        avisoExtra={
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

      {/* ── 2 · Volcar el contenido de las sesiones (en la beca no aplica) ── */}
      {!esBeca && (
        <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
          <div className="eyebrow mb-1">…o redactarlo con las sesiones ya escritas</div>
          <p className="text-[11px] text-neutral-500 mb-3">
            Marca las sesiones y el informe se rellena con lo que se escribió en ellas: objetivos,
            evolución con su fecha, incidencias y tareas. No pisa lo que ya hayas escrito.
          </p>

          {sesiones.length === 0 ? (
            <p className="text-[11px] text-neutral-400">Este paciente todavía no tiene sesiones registradas.</p>
          ) : (
            <div className="max-h-44 overflow-y-auto border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-50">
              {sesiones.map((se) => {
                const marcada = elegidas.has(se.id);
                return (
                  <label key={se.id} className="flex items-start gap-2 px-2.5 py-2 cursor-pointer hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={() =>
                        setElegidas((prev) => {
                          const n = new Set(prev);
                          if (n.has(se.id)) n.delete(se.id);
                          else n.add(se.id);
                          return n;
                        })
                      }
                      className="mt-0.5 w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[11px] text-neutral-700">
                        {fmtDate(se.sessionDate)} · {se.statusLabel}
                      </span>
                      <span className="block text-[10px] text-neutral-400 truncate">{se.preview || "Sin resumen"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={volcarSesiones}
              disabled={guardando || procesando || entregado || sesiones.length === 0}
              className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-40"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "Trabajando…" : `Volcar ${elegidas.size || "las"} sesion${elegidas.size === 1 ? "" : "es"} al informe`}
            </button>
            <button
              onClick={pulirConIa}
              disabled={guardando || procesando || entregado || !hayQuePulir}
              title={hayQuePulir ? "" : "Vuelca antes las sesiones: esto redacta lo volcado, no lo inventa"}
              className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-300 text-neutral-700 hover:border-neutral-500 disabled:opacity-40"
            >
              {procesando ? "Redactando…" : "Redactar el volcado con IA"}
            </button>
          </div>
          <p className="text-[10px] text-neutral-400 mt-2">
            Cada línea sale literal de un registro de sesión, con su fecha delante: aquí no se
            inventa nada. «Redactar el volcado con IA» lo convierte en prosa y te lo enseña al
            lado para que decidas apartado por apartado. El volcado es material de trabajo:{" "}
            <span className="font-medium text-neutral-500">al PDF va lo que dejes escrito en los
            apartados</span>, y de las sesiones solo sus fechas.
          </p>

          {/* El anexo literal, opt-in (26/08/2026, Rodrigo). */}
          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={extra.anexarRegistros}
              onChange={(e) => setExtra((x) => ({ ...x, anexarRegistros: e.target.checked }))}
              className="mt-0.5 w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
            />
            <span className="text-[11px] text-neutral-600 leading-snug">
              <span className="font-medium">Anexar al PDF los registros literales</span> de las
              sesiones marcadas, en páginas aparte al final. La preparación no va: es material
              interno.
            </span>
          </label>
        </div>
      )}

      {/* ── 3 · El informe: sus campos ────────────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-4">
        <div className="eyebrow">El informe</div>

        {tipo === "referral" && derivaciones.length > 0 && (
          <div>
            <div className="eyebrow mb-1">Especialidad de destino</div>
            <select
              className={TA}
              value={extra.referralSpecialty}
              onChange={(e) => setExtra((x) => ({ ...x, referralSpecialty: e.target.value }))}
            >
              <option value="">Sin especificar</option>
              {derivaciones.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Las pruebas con sus puntuaciones: solo en el informe de diagnóstico
            (o si este informe ya las trae). Van ANTES de los apartados porque
            en el PDF salen detrás de «Pruebas administradas», a mitad del
            documento; aquí, arriba, para que se vea que existen. */}
        {(tipo === TIPO_DIAGNOSTICO || pruebas.length > 0) && (
          <PruebasDiagnosticas pruebas={pruebas} onChange={setPruebas} />
        )}

        <ApartadosEditor
          apartados={apartados}
          valores={form}
          onValor={(clave, v) => setForm((f) => ({ ...f, [clave]: v }))}
          onApartados={setApartados}
          plantillas={esBeca ? [{ key: "beca", name: "Informe para beca", apartados: SECCIONES_BECA }] : plantillas}
          plantillaKey={plantillaKey}
          // En la beca no hay ni plantilla que elegir ni apartados que tocar.
          onPlantilla={esBeca ? null : elegirPlantilla}
          permiteOrdenar={!esBeca}
          ayudas={AYUDAS}
          clavesDePlantilla={esBeca ? null : clavesDePlantilla}
        />
      </div>

      {aviso && (
        <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {aviso}
          {/* El enlace solo aparece cuando el navegador ha bloqueado la pestaña
              de «Ver PDF»: el informe ya está guardado. */}
          {pdfDeRespaldo && (
            <>
              {" "}
              <a href={pdfDeRespaldo} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                abrir el PDF
              </a>
            </>
          )}
        </div>
      )}

      {/* ── El pie: mirar, corregir, mandar ───────────────────────────────── */}
      <div className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-wrap gap-2 items-center">
        {report.status === "draft" && (
          <button
            onClick={borrar}
            disabled={borrando || guardando}
            title="Borra este borrador. Un informe revisado o entregado no se puede borrar."
            className="text-xs px-3 py-2 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {borrando ? "Borrando…" : "Borrar"}
          </button>
        )}
        <button
          onClick={verPdf}
          disabled={guardando}
          title="Guarda lo que hay en pantalla y abre el PDF en una pestaña nueva. No lo envía a nadie."
          className="ml-auto text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400 disabled:opacity-50"
        >
          Ver PDF
        </button>
        <button
          onClick={() => guardar()}
          disabled={guardando}
          className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-700 hover:border-neutral-400 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar informe"}
        </button>
        <button
          onClick={enviar}
          disabled={enviando || guardando}
          className="text-xs px-3 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {enviando ? "Enviando…" : entregado ? "Volver a enviar" : "Enviar al paciente"}
        </button>
      </div>
      {dialogo}
    </div>
  );
}
