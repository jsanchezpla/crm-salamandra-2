/**
 * lib/team/auditoriaDesempeno.js — la auditoría mensual de desempeño de una
 * profesional (09/09/2026, AV-0100).
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 * Isabel Alberca (dirección de Aumenta) pidió «un apartado de Auditoría de
 * desempeño del terapeuta», mensual y por persona: cuatro áreas con sus
 * criterios, cada criterio valorado solo como APTO / NO APTO / NO APLICA y con
 * su hueco de observaciones; nada de puntuaciones. Un «no apto» NO hace
 * desfavorable la auditoría entera —queda como aspecto a mejorar—, pero si el
 * mismo incumplimiento se repite mes a mes, tiene que verse. Y al abrir una
 * auditoría nueva hay que ver lo que quedó pendiente de la anterior.
 *
 * ── POR QUÉ ES UN MÓDULO Y NO UNA PANTALLA DE `team_avanzado` ──────────────
 * La pregunta de la regla 16 es «¿se lo venderíamos a un segundo cliente?», y
 * aquí la respuesta es que sí: cualquier centro con varias profesionales y
 * alguien que dirige hace esto, hoy en un Word. Así que va como módulo propio
 * (`auditorias`), con su clave, que se vende aparte — no como un regalo dentro
 * de Equipo.
 *
 * Y no se parece a lo que ya hay: Desempeño y Productividad son NÚMEROS que
 * salen solos de las citas y los cobros. Esto es lo contrario: una valoración a
 * mano, cualitativa, con histórico y seguimiento. Meterlo en Desempeño mezclaría
 * dos cosas que se leen distinto.
 *
 * ── LO QUE ESTE FICHERO DECIDE, Y POR QUÉ NO ESTÁ EN LA PANTALLA ───────────
 * Tres reglas que se leen en más de un sitio (el editor, la lista y el
 * histórico) y que escritas dos veces acabarían diciendo cosas distintas:
 *
 *   1. QUÉ SE VALORA — las cuatro áreas y sus criterios.
 *   2. QUÉ NO DECIDE UN «NO APTO» — el resultado global lo escribe quien audita,
 *      nunca una cuenta. Es literalmente lo que se pidió.
 *   3. QUÉ SE REPITE — un criterio que sale «no apto» dos meses seguidos deja de
 *      ser un despiste. Sin esto, el histórico es una pila de meses sueltos.
 *
 * ── LA PLANTILLA SE GUARDA DENTRO DE CADA AUDITORÍA ────────────────────────
 * Como los apartados del informe: al crear la auditoría se copian las áreas y
 * los criterios EN LA FILA (`areas`, JSONB). Si mañana se añade un criterio, las
 * auditorías ya firmadas no cambian —firmaron lo que firmaron— y las nuevas
 * salen con la lista nueva. Una auditoría que cambiara sola después de firmada
 * no valdría para nada laboral.
 *
 * Puro: sin base y sin fetch. Prueba en `scripts/_smoke-auditoria-desempeno.mjs`.
 */

/** Los tres valores. No hay medias tintas a propósito: se pidió así. */
export const VALORES = Object.freeze(["apto", "noApto", "noAplica"]);
export const ETIQUETA_VALOR = Object.freeze({
  apto: "Apto",
  noApto: "No apto",
  noAplica: "No aplica",
});

/** Los dos resultados globales, con el nombre que les puso el centro. */
export const RESULTADOS = Object.freeze(["favorable", "requiereSeguimiento"]);
export const ETIQUETA_RESULTADO = Object.freeze({
  favorable: "Favorable",
  requiereSeguimiento: "Requiere seguimiento",
});

/**
 * Las cuatro áreas y sus criterios.
 *
 * Los nombres de las áreas son los que dio el centro. Los criterios los hemos
 * escrito nosotros a partir de lo que ya vive en el CRM —un criterio que nadie
 * puede comprobar no sirve para auditar—, y cada auditoría puede añadir los
 * suyos: se guardan en su propia fila, no aquí.
 */
export const AREAS = Object.freeze([
  Object.freeze({
    key: "documental",
    label: "Gestión documental",
    criterios: Object.freeze([
      { key: "registrosAlDia", label: "Registra las sesiones en plazo" },
      { key: "planEscrito", label: "Los pacientes a su cargo tienen plan de intervención escrito" },
      { key: "informesEnPlazo", label: "Entrega los informes comprometidos en su fecha" },
      { key: "consentimientos", label: "La documentación obligatoria del paciente está completa" },
    ]),
  }),
  Object.freeze({
    key: "casos",
    label: "Preparación y seguimiento de casos",
    criterios: Object.freeze([
      { key: "preparacion", label: "Prepara la sesión antes de la sesión" },
      { key: "objetivosVivos", label: "Los objetivos del plan están actualizados y se revisan" },
      { key: "materiales", label: "Usa y deja ordenado el material del centro" },
      { key: "derivaciones", label: "Detecta y plantea derivaciones cuando hacen falta" },
    ]),
  }),
  Object.freeze({
    key: "intervencion",
    label: "Calidad de la intervención",
    criterios: Object.freeze([
      { key: "ajusteAlPlan", label: "Lo que hace en sesión responde al plan del paciente" },
      { key: "puntualidad", label: "Empieza y termina a su hora" },
      { key: "adaptacion", label: "Adapta la intervención a la evolución del paciente" },
      { key: "protocolos", label: "Sigue los protocolos del centro" },
    ]),
  }),
  Object.freeze({
    key: "familias",
    label: "Familias y coordinación",
    criterios: Object.freeze([
      { key: "devolucion", label: "Devuelve información a la familia con la frecuencia acordada" },
      { key: "coordinacionInterna", label: "Coordina con el resto del equipo los casos compartidos" },
      { key: "coordinacionExterna", label: "Coordina con colegio y profesionales externos cuando procede" },
      { key: "incidencias", label: "Registra y atiende las incidencias que le tocan" },
    ]),
  }),
]);

/**
 * La foto de las áreas que se guarda al abrir una auditoría: los criterios de la
 * plantilla, todos sin valorar.
 *
 * Sin valor de partida a propósito. Arrancar todo en «Apto» convierte la
 * auditoría en un trámite de pulsar Guardar, que es exactamente lo que no se
 * quiere de una revisión de desempeño.
 */
export function areasEnBlanco() {
  return AREAS.map((a) => ({
    key: a.key,
    label: a.label,
    criterios: a.criterios.map((c) => ({ key: c.key, label: c.label, valor: null, observaciones: "" })),
  }));
}

const texto = (v) => (v == null ? "" : String(v).trim());

/** ¿Es un valor de los tres? `null` (sin valorar) también vale. */
export function valorValido(v) {
  return v == null || VALORES.includes(v);
}

/**
 * Normaliza lo que llega del formulario: tira lo que no reconoce y conserva
 * los criterios sueltos que haya añadido quien audita.
 *
 * ⚠️ Los rótulos se conservan tal cual vienen de la fila y NO se releen de
 * `AREAS`: una auditoría firmada tiene que seguir diciendo lo que decía.
 */
export function normalizarAreas(areas) {
  if (!Array.isArray(areas)) return areasEnBlanco();
  return areas
    .filter((a) => a && texto(a.key))
    .map((a) => ({
      key: texto(a.key),
      label: texto(a.label) || texto(a.key),
      criterios: (Array.isArray(a.criterios) ? a.criterios : [])
        .filter((c) => c && texto(c.key))
        .map((c) => ({
          key: texto(c.key),
          label: texto(c.label) || texto(c.key),
          valor: valorValido(c.valor) ? c.valor ?? null : null,
          observaciones: texto(c.observaciones),
        })),
    }));
}

/** Todos los criterios de todas las áreas, con su área delante. */
export function criteriosDe(areas = []) {
  const salida = [];
  for (const a of areas ?? []) {
    for (const c of a?.criterios ?? []) salida.push({ ...c, areaKey: a.key, areaLabel: a.label });
  }
  return salida;
}

/**
 * El recuento de una auditoría: cuántos aptos, no aptos, no aplica y sin valorar.
 *
 * NO devuelve nota ni porcentaje, y no es un olvido: se pidió expresamente que
 * no hubiera puntuaciones. Un «3 de 16» invita a comparar personas, y esto no es
 * una clasificación.
 */
export function recuentoDeAuditoria(areas = []) {
  const c = { apto: 0, noApto: 0, noAplica: 0, sinValorar: 0 };
  for (const cr of criteriosDe(areas)) {
    if (cr.valor === "apto") c.apto++;
    else if (cr.valor === "noApto") c.noApto++;
    else if (cr.valor === "noAplica") c.noAplica++;
    else c.sinValorar++;
  }
  return c;
}

/**
 * ⚠️ EL «NO APTO» NO DECIDE EL RESULTADO GLOBAL.
 *
 * Literal de la petición: «un "no apto" no hace desfavorable toda la auditoría:
 * queda como aspecto a mejorar». Así que esta función NO calcula el resultado —
 * lo escribe quien audita— y lo único que hace es decir si lo que ha escrito
 * cuadra con lo que ha valorado, para poder avisar sin impedir nada.
 *
 * Un «favorable» con no aptos dentro es perfectamente posible y es el caso
 * normal. Lo que sí merece una pregunta es lo contrario: marcar «requiere
 * seguimiento» sin escribir ni un aspecto a mejorar deja a la persona sin saber
 * qué tiene que cambiar.
 */
export function avisosDelCierre(auditoria = {}) {
  const avisos = [];
  const { noApto, sinValorar } = recuentoDeAuditoria(auditoria.areas ?? []);
  if (sinValorar > 0) {
    avisos.push(
      sinValorar === 1
        ? "Queda 1 criterio sin valorar."
        : `Quedan ${sinValorar} criterios sin valorar.`
    );
  }
  if (auditoria.resultado === "requiereSeguimiento" && !texto(auditoria.aspectosAMejorar)) {
    avisos.push("Has marcado «requiere seguimiento» y no hay ningún aspecto a mejorar escrito.");
  }
  if (auditoria.resultado === "requiereSeguimiento" && !texto(auditoria.accionAcordada)) {
    avisos.push("Un seguimiento sin acción acordada no se puede revisar el mes que viene.");
  }
  if (noApto > 0 && !texto(auditoria.aspectosAMejorar)) {
    avisos.push("Hay criterios «no apto» y el apartado de aspectos a mejorar está vacío.");
  }
  return avisos;
}

/**
 * Lo que quedó pendiente de la auditoría anterior, para enseñarlo arriba al
 * abrir la del mes siguiente.
 *
 * Es la pieza que convierte una pila de meses sueltos en un seguimiento: «si
 * Araceli acordó en agosto que se entregarían los informes antes del día 10, en
 * septiembre eso tiene que estar delante».
 */
export function loQuePendiaDeLaAnterior(anterior) {
  if (!anterior) return null;
  const noAptos = criteriosDe(anterior.areas ?? []).filter((c) => c.valor === "noApto");
  return {
    mes: anterior.mes ?? null,
    resultado: anterior.resultado ?? null,
    aspectosAMejorar: texto(anterior.aspectosAMejorar),
    accionAcordada: texto(anterior.accionAcordada),
    plazoRevision: anterior.plazoRevision ?? null,
    // El campo lo escribe quien abre la auditoría nueva; hasta entonces, nadie
    // ha dicho si aquello se resolvió.
    resueltoLoAnterior: anterior.resueltoLoAnterior ?? null,
    noAptos: noAptos.map((c) => ({ areaLabel: c.areaLabel, label: c.label, observaciones: c.observaciones })),
  };
}

/**
 * Los criterios que se repiten «no apto» en meses CONSECUTIVOS.
 *
 * «Si el mismo incumplimiento se repite mes a mes, tiene que verse». Consecutivos
 * y no acumulados: un no apto en marzo y otro en septiembre son dos hechos, no
 * una pauta, y tratarlos igual convertiría el aviso en ruido.
 *
 * @param auditorias  las de esa persona, en cualquier orden; se ordenan por mes
 * @returns [{ areaLabel, label, meses: ["2026-08","2026-09"] }] de más largo a
 *          más corto, solo las rachas de 2 o más.
 */
export function criteriosQueSeRepiten(auditorias = []) {
  const ordenadas = [...(auditorias ?? [])]
    .filter((a) => a && typeof a.mes === "string")
    .sort((a, b) => a.mes.localeCompare(b.mes));

  // Racha viva por criterio, y la más larga vista.
  const viva = new Map();
  const mejor = new Map();
  for (const a of ordenadas) {
    const noAptos = new Set();
    for (const c of criteriosDe(a.areas ?? [])) {
      const id = `${c.areaKey}/${c.key}`;
      if (c.valor !== "noApto") continue;
      noAptos.add(id);
      const racha = viva.get(id) ?? { areaLabel: c.areaLabel, label: c.label, meses: [] };
      racha.meses = [...racha.meses, a.mes];
      viva.set(id, racha);
      const anterior = mejor.get(id);
      if (!anterior || racha.meses.length > anterior.meses.length) mejor.set(id, { ...racha, meses: [...racha.meses] });
    }
    // Un mes valorado que NO trae el no apto corta la racha. Un criterio que ese
    // mes no se valoró (o salió «no aplica») también la corta: no consta.
    for (const id of [...viva.keys()]) if (!noAptos.has(id)) viva.delete(id);
  }

  return [...mejor.values()]
    .filter((r) => r.meses.length >= 2)
    .sort((a, b) => b.meses.length - a.meses.length || a.label.localeCompare(b.label));
}

/** «2026-09» → «septiembre de 2026». Sin Intl: la prueba no depende del locale. */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function nombreDelMes(mes) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(mes ?? ""));
  if (!m) return "";
  return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** El mes anterior a uno dado, en el mismo formato. */
export function mesAnterior(mes) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(mes ?? ""));
  if (!m) return null;
  const a = Number(m[1]);
  const n = Number(m[2]);
  return n === 1 ? `${a - 1}-12` : `${a}-${String(n - 1).padStart(2, "0")}`;
}

/**
 * ── QUIÉN PUEDE VER UNA AUDITORÍA ──────────────────────────────────────────
 * Es material laboral sobre una persona, y esa conversación ya se tuvo con las
 * incidencias en agosto (AV-0018): no todo el equipo tiene por qué leer lo que
 * dirección escribe de una compañera.
 *
 *   · Dirección (admin) ve, escribe y cierra todas.
 *   · La persona auditada ve LAS SUYAS y solo cuando están CERRADAS. Un borrador
 *     a medio escribir no es una valoración, es una nota de quien audita.
 *   · Nadie más ve nada.
 *
 * Que la persona vea la suya cerrada no es un extra: una auditoría que la
 * auditada no puede leer no le sirve para mejorar, que es para lo que se hace.
 */
export function puedeVerAuditoria({ esAdmin = false, teamMemberId = null } = {}, auditoria = {}) {
  if (esAdmin) return true;
  if (!teamMemberId || String(auditoria.teamMemberId ?? "") !== String(teamMemberId)) return false;
  return auditoria.estado === "cerrada";
}

/** Solo dirección escribe. La auditada lee. */
export function puedeEditarAuditoria({ esAdmin = false } = {}) {
  return Boolean(esAdmin);
}
