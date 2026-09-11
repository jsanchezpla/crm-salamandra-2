/**
 * lib/billing/bonos.js — el BONO como forma de pago, mirado desde Facturación
 * (10/09/2026, petición de Rodrigo: «un submódulo en facturación llamado Bonos
 * … es lo mismo que Cuotas pero cambiando la idea a Bonos»).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos del
 * submódulo —qué estado tiene un bono, cuándo se puede volver a coger, cómo se
 * agrupan por tipo y qué se valida al darlo—, compartida por los cinco
 * endpoints y las tres pantallas, y fijada por `scripts/_smoke-bonos.mjs`.)
 *
 * ── QUÉ ES UN BONO Y EN QUÉ NO SE PARECE A UNA CUOTA ───────────────────────
 * Una CUOTA se paga todos los meses hasta que alguien la da de baja: su unidad
 * de tiempo es el mes, y por eso tiene día de cobro, prorrateo y un botón que
 * genera el mes entero. Un BONO se paga UNA VEZ y da derecho a N sesiones: su
 * unidad no es el mes, son las sesiones. Se termina cuando se gastan, no cuando
 * llega un día del calendario.
 *
 * De ahí salen las tres diferencias que gobiernan todo lo demás:
 *
 *   · **Un cobro, no doce.** El pendiente nace al dar el bono
 *     (`lib/billing/cobroDelBono.js`) y ahí se acaba. No hay «Generar el mes»
 *     porque no hay meses que generar, y su cobro va con `periodMonth` a null
 *     para no colarse en «Facturar el mes» como si fuera una cuota.
 *   · **La baja no es una fecha: es el contador.** Una cuota está de baja
 *     porque tiene `endDate`; un bono está AGOTADO porque sus sesiones se
 *     gastaron —lo dicen las citas, no una persona— o ANULADO porque el centro
 *     lo canceló. Por eso aquí no hay `cuotaDeBaja(cuota, hoy)` sino
 *     `estadoDelBono(bono)`, que no depende del día de hoy.
 *   · **Se puede volver a coger** (Rodrigo: «pueden volver a coger el bono si
 *     quieren»). Renovar NO es reactivar el de antes: es OTRO bono, con su fila,
 *     su fecha y su cobro. Reabrir el agotado borraría de un plumazo que sus
 *     diez sesiones se dieron, y la sesión 11 volvería a llamarse «la 1 de
 *     diez». Lo dice la cabecera de `models/tenant/SessionPack.model.js` desde
 *     el primer día y aquí se respeta: `renovacionDe` devuelve una fila nueva.
 *
 * ── LO QUE SÍ SE COPIA DE CUOTAS ───────────────────────────────────────────
 * La forma de trabajar de la pantalla: los grupos («Tipos de bono», el espejo
 * de «Tipos de cuota»), el alta EN GRUPO de una tacada, el cuadro de cerrados
 * abajo con su buscador en vez de esconderlos, y que dar un bono no es
 * cobrarlo.
 *
 * ── LA UNIDAD DEL DINERO: CÉNTIMOS ─────────────────────────────────────────
 * `session_packs.amount` está en CÉNTIMOS enteros, igual que `EventType.price`
 * y que Stripe (`lib/payments/money.js`). Este fichero, su API y sus pantallas
 * hablan en céntimos de punta a punta, como `/api/citas/packs`; los euros
 * aparecen solo al pintar y al leer el formulario. La conversión al mundo de
 * `payments.amount` —que va en EUROS— vive en un único sitio, la frontera de
 * `lib/billing/cobroDelBono.js`, porque pasar el número tal cual ya nació una
 * vez como un bono de 150 € con un cobro pendiente de 15.000 €.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tope de sesiones de un bono, el mismo que valida `EventType.sessionsCount`. */
export const SESIONES_MAX = 200;

/** Los estados que se pueden escribir a mano. `agotado` lo dice el contador. */
export const ESTADOS_A_MANO = new Set(["active", "anulado"]);

const enteroPositivo = (v) => Number.isInteger(v) && v >= 0;

/*
 * ¿ESTE IMPORTE GENERA COBRO? Solo un entero de céntimos MAYOR que cero, la
 * misma regla que `bonoLlevaCobro` en `lib/billing/cobroDelBono.js`.
 *
 * Los tres valores son distintos y hay que distinguirlos: `null` es «nadie ha
 * dicho lo que vale», `0` es un bono regalado a propósito y un número es la
 * deuda. Con `Number(null)` los dos primeros se confundían —daba 0, que pasa por
 * entero positivo—, y un bono sin precio salía como vendido por 0 € en vez de
 * salir en «sin importe».
 */
const importeQueSeCobra = (v) => Number.isInteger(v) && v > 0;

/**
 * EN QUÉ ESTADO ESTÁ UN BONO.
 *
 * `anulado` manda sobre todo lo demás: un bono cancelado no es «agotado» ni
 * «vivo», está fuera. Después el contador: sin sesiones libres, agotado. El
 * resto, vivo.
 *
 * No recibe `hoy` a propósito (al contrario que `cuotaDeBaja`): un bono no
 * caduca por calendario. Un bono de 2023 con dos sesiones sin gastar sigue
 * vivo, y eso es una decisión del centro, no un despiste — quien no quiera que
 * se pueda usar lo anula.
 *
 * `restantes` lo calcula el servidor contando citas (`lib/citas/packs.js`,
 * `estadoPack`), que es lo que no miente; aquí solo se lee.
 */
export function estadoDelBono(bono) {
  if (String(bono?.status ?? "") === "anulado") return "anulado";
  // Sin tope no hay contador que lo agote: se cierra desde el expediente.
  if (bonoSinTope(bono)) return "vivo";
  const restantes = Number(bono?.restantes);
  if (Number.isFinite(restantes) && restantes <= 0) return "agotado";
  return "vivo";
}

/**
 * ¿Es un bono SIN TOPE? (12/09/2026, el bono de un DIAGNÓSTICO)
 *
 * `total` a null —el null EXPLÍCITO que serializa `estadoPack` cuando
 * `session_packs.total_sessions` es NULL—. Sus horas las acota el expediente
 * (`lib/clinica/diagnostico.js`), no un número de sesiones, así que aquí no
 * se agota nunca y el rótulo lo dice con palabras. Un objeto al que le falte
 * la clave sigue siendo lo que era: la compatibilidad es el caso por defecto.
 */
export function bonoSinTope(bono) {
  if (!bono || typeof bono !== "object") return false;
  if (bono.total === null) return true;
  return bono.total === undefined && bono.totalSessions === null;
}

/**
 * ¿Este bono está cerrado? (agotado o anulado)
 *
 * Es el equivalente de `cuotaDeBaja`: lo que decide si la fila va a la tabla de
 * arriba o al cuadro de cerrados. Cerrado no es borrado: sigue en pantalla, con
 * su historia y con el botón de volver a cogerlo.
 */
export function bonoCerrado(bono) {
  return estadoDelBono(bono) !== "vivo";
}

/** «Le quedan 3 de 10» · «Agotado · 10 de 10» · «Anulado» · «Sin tope · 3 usadas». */
export function rotuloDelBono(bono) {
  const estado = estadoDelBono(bono);
  const total = Number(bono?.total) || 0;
  const gastadas = Number(bono?.gastadas) || 0;
  const reservadas = Number(bono?.reservadas) || 0;
  if (estado === "anulado") return "Anulado";
  if (bonoSinTope(bono)) {
    const cola = reservadas ? `, ${reservadas} en la agenda` : "";
    return `Sin tope · ${gastadas} usada${gastadas === 1 ? "" : "s"}${cola}`;
  }
  if (estado === "agotado") {
    // Agotado con reservas por delante no es lo mismo que agotado del todo: las
    // sesiones están puestas en la agenda y todavía se pueden cancelar.
    return reservadas
      ? `Sin libres · ${gastadas} de ${total} usadas y ${reservadas} en la agenda`
      : `Agotado · ${gastadas} de ${total} usadas`;
  }
  const restantes = Number(bono?.restantes) || 0;
  const cola = reservadas ? `, ${reservadas} en la agenda` : "";
  return `Le ${restantes === 1 ? "queda" : "quedan"} ${restantes} de ${total}${cola}`;
}

/**
 * QUÉ SE VALIDA AL DAR (o editar) UN BONO.
 *
 * Devuelve `{ valores, problema }` como `limpiarCuota`, y por el mismo motivo:
 * que la pantalla y la API digan exactamente la misma cosa cuando algo está
 * mal, en vez de dos frases parecidas.
 *
 * `parcial` (el PATCH) solo toca lo que venga en el cuerpo: editar la nota de
 * un bono no puede exigir reenviar sus sesiones.
 *
 * El importe entra en CÉNTIMOS (ver la cabecera). `null` = sin importe, que
 * NO es lo mismo que 0: sin importe no nace cobro, y 0 es un bono regalado.
 * Los dos son legítimos y ninguno de los dos genera deuda.
 */
export function limpiarBono(body, { parcial = false } = {}) {
  const valores = {};
  const b = body || {};

  if (!parcial || "eventTypeId" in b) {
    const id = String(b.eventTypeId ?? "");
    if (!UUID_RE.test(id)) return { valores: null, problema: "Elige el tipo de bono" };
    valores.eventTypeId = id;
  }
  if (!parcial || "clientId" in b) {
    const id = b.clientId ? String(b.clientId) : null;
    if (id && !UUID_RE.test(id)) return { valores: null, problema: "La ficha que paga el bono no es válida" };
    valores.clientId = id;
  }
  if (!parcial || "patientId" in b) {
    const id = b.patientId ? String(b.patientId) : null;
    if (id && !UUID_RE.test(id)) return { valores: null, problema: "El paciente no es válido" };
    valores.patientId = id;
  }
  if (!parcial || "totalSessions" in b) {
    // Vacío en el alta = las que traiga su tipo de bono; lo resuelve la API,
    // que es la que tiene el catálogo delante.
    if (b.totalSessions === null || b.totalSessions === undefined || b.totalSessions === "") {
      valores.totalSessions = null;
    } else {
      const n = Math.trunc(Number(b.totalSessions));
      if (!Number.isFinite(n) || n < 1 || n > SESIONES_MAX) {
        return { valores: null, problema: `Las sesiones tienen que ser un número entre 1 y ${SESIONES_MAX}` };
      }
      valores.totalSessions = n;
    }
  }
  if (!parcial || "amount" in b) {
    if (b.amount === null || b.amount === undefined || b.amount === "") {
      valores.amount = null; // sin importe: no nace cobro
    } else {
      const n = Number(b.amount);
      if (!enteroPositivo(n)) {
        return { valores: null, problema: "El importe del bono tiene que ser un número entero de céntimos" };
      }
      valores.amount = n;
    }
  }
  if (!parcial || "purchasedAt" in b) {
    if (b.purchasedAt === null || b.purchasedAt === undefined || b.purchasedAt === "") {
      valores.purchasedAt = null; // hoy, lo pone la API
    } else {
      const d = new Date(b.purchasedAt);
      if (Number.isNaN(d.getTime())) return { valores: null, problema: "La fecha del bono no es válida" };
      valores.purchasedAt = d;
    }
  }
  if (!parcial || "notes" in b) {
    valores.notes = typeof b.notes === "string" ? b.notes.trim().slice(0, 2000) || null : null;
  }
  if ("status" in b) {
    const s = String(b.status ?? "");
    if (!ESTADOS_A_MANO.has(s)) {
      // 'agotado' no se escribe: sale de contar las citas. Dejarlo pasar sería
      // poder mentirle al contador de sesiones.
      return { valores: null, problema: "El estado de un bono solo puede ser activo o anulado" };
    }
    valores.status = s;
  }

  return { valores, problema: null };
}

/**
 * QUÉ HA PASADO CON EL COBRO, dicho en una cola de frase.
 *
 * Corregir un bono toca su cobro pendiente —lo pone al día, lo crea o lo
 * retira— y eso hay que decirlo en pantalla: un ajuste de dinero silencioso es
 * el que nadie revisa. Vive aquí y no en la pantalla porque lo pintan tres
 * sitios (la lista, el cajón y la ficha del grupo) y tienen que decir lo mismo.
 *
 * Recibe el parte que devuelven `PATCH /api/billing/bonos/[id]` y compañía.
 */
export function parteDelCobro(cobro) {
  if (!cobro) return "";
  if (cobro.accion === "retirado") {
    const n = Number(cobro.cobros) || 0;
    return ` · ${n === 1 ? "su cobro pendiente retirado" : `sus ${n} cobros pendientes retirados`}`;
  }
  if (cobro.accion === "creado") return " · cobro pendiente apuntado en Cobros";
  if (cobro.accion === "al día") return " · su cobro pendiente puesto al día";
  return cobro.motivo ? ` · ${cobro.motivo}` : "";
}

/**
 * ¿La nota de este cobro la escribió el programa o una persona?
 *
 * El espejo de `esNotaAutomatica` de `cuotas.js` («Cuota septiembre 2026»), que
 * no reconoce las de bono y por eso no vale aquí: la automática de un bono es
 * la que escribe `textoDelCobroDeBono` — «Bono «Logopedia 10» · 10 sesiones».
 *
 * Importa para lo mismo: al cambiar el importe de un bono su cobro pendiente se
 * pone al día, y si alguien escribió a mano en Cobros por qué ese bono es
 * distinto, rehacerlo no puede borrárselo. Ese texto es el único sitio donde
 * vive esa explicación.
 */
export function esNotaAutomaticaDeBono(notas) {
  return /^Bono\s+(«|de sesiones)/i.test(String(notas ?? "").trim());
}

/**
 * ¿Le queda a esta persona un bono VIVO del mismo tipo?
 *
 * No es un impedimento —un bono se puede volver a coger, y hasta tener dos a la
 * vez si el centro quiere—: es lo que permite avisar antes de darlo, igual que
 * el alta de cuotas avisa de quien ya tiene una. Un doble clic en un lote de
 * cuarenta pacientes no puede convertirse en cuarenta bonos repetidos sin que
 * nadie lo haya dicho.
 *
 * El paciente se compara como se guarda: null (de la familia entera) es un
 * valor distinto de un paciente concreto, porque son dos bonos distintos.
 */
export function bonoVivoIgual(bonos, { eventTypeId, clientId, patientId = null } = {}) {
  const mismo = (a, b) => (a ? String(a) : null) === (b ? String(b) : null);
  return (
    (Array.isArray(bonos) ? bonos : []).find(
      (x) =>
        !bonoCerrado(x) &&
        mismo(x.eventTypeId, eventTypeId) &&
        mismo(x.clientId, clientId) &&
        mismo(x.patientId, patientId)
    ) ?? null
  );
}

/**
 * VOLVER A COGER EL BONO (Rodrigo, 10/09/2026).
 *
 * Los valores de la fila NUEVA: el mismo tipo, las mismas sesiones, el mismo
 * importe y el mismo paciente que el anterior, comprado hoy. Es lo que hace que
 * renovar sea un clic y no volver a teclear el alta entera.
 *
 * Lo que NO se copia, a propósito:
 *   · el estado (nace activo, aunque el anterior esté anulado);
 *   · las sesiones ya gastadas (`sesionesPrevias` a 0: el bono nuevo está
 *     entero, y arrastrar el gasto del viejo sería cobrarlo dos veces);
 *   · la nota del anterior, que hablaba de aquel trato;
 *   · su cobro, que ya está cobrado o pendiente por su cuenta.
 *
 * `cambios` permite renovar con otro importe o más sesiones sin salir del botón
 * («este año le hago 8 en vez de 6»).
 */
export function renovacionDe(bono, cambios = {}) {
  const base = {
    eventTypeId: bono?.eventTypeId ?? null,
    clientId: bono?.clientId ?? null,
    patientId: bono?.patientId ?? null,
    totalSessions: Number(bono?.total ?? bono?.totalSessions) || null,
    // `null` (nadie dijo lo que vale) y `0` (regalado) se conservan tal cual:
    // son dos decisiones distintas y las dos se heredan.
    amount: Number.isInteger(bono?.amount) ? bono.amount : null,
    notes: null,
  };
  const pedido = cambios || {};
  for (const campo of ["totalSessions", "amount", "notes", "patientId", "purchasedAt"]) {
    if (campo in pedido) base[campo] = pedido[campo];
  }
  return base;
}

/**
 * Lo que hay que decirle a quien renueva antes de que renueve.
 *
 * Aviso, nunca corte: los tres casos son legítimos y el centro sabe lo que
 * hace. Pero un bono duplicado por error se paga dos veces, así que la frase
 * tiene que estar delante.
 */
export function avisosDeRenovacion(bono) {
  const avisos = [];
  const estado = estadoDelBono(bono);
  const restantes = Number(bono?.restantes) || 0;
  if (estado === "vivo" && restantes > 0) {
    avisos.push(
      `Este bono todavía tiene ${restantes} ${restantes === 1 ? "sesión" : "sesiones"} sin usar: al renovarlo tendrá los dos abiertos y las citas gastarán primero el antiguo.`
    );
  }
  if (estado === "anulado") {
    avisos.push("El bono anterior está anulado: el nuevo nace activo y con su cobro pendiente aparte.");
  }
  if (!importeQueSeCobra(bono?.amount)) {
    avisos.push(
      "El bono anterior no tenía importe que cobrar (en blanco o 0 €), así que el nuevo tampoco creará cobro pendiente. Ponle uno si esta vez se cobra."
    );
  }
  return avisos;
}

/**
 * TOTALES DE UNA LISTA DE BONOS, en céntimos.
 *
 * `vendido` es lo que valen los bonos (lo dice el bono, en céntimos);
 * `pendiente`, lo que de ese dinero no ha entrado todavía — y eso lo dice su
 * cobro, no el bono. Ojo a la costura: `cobro.pendiente` llega en EUROS porque
 * viene de `payments.amount`, y aquí se devuelve todo en céntimos.
 */
export function totalesDeBonos(bonos = []) {
  let vendido = 0;
  let pendiente = 0;
  let sesionesLibres = 0;
  let sinImporte = 0;
  for (const b of bonos) {
    // Sin precio escrito no suma y se cuenta aparte; un bono regalado (0) sí
    // tiene precio escrito, y su cero suma cero.
    if (Number.isInteger(b?.amount)) vendido += b.amount;
    else sinImporte += 1;
    pendiente += Math.round((Number(b?.cobro?.pendiente) || 0) * 100);
    sesionesLibres += Math.max(0, Number(b?.restantes) || 0);
  }
  return { vendido, pendiente, sesionesLibres, sinImporte, bonos: bonos.length };
}

/**
 * LOS GRUPOS: el catálogo de bonos con la gente que lo lleva detrás.
 *
 * El espejo de `resumenPorTipo` de `tiposDeCuota.js` — Rodrigo: «que se puedan
 * ordenar por grupos igual que cuotas»— con una diferencia que importa: un bono
 * lleva UN tipo y solo uno, así que aquí no existe el problema de las cuotas
 * compartidas y todos los importes suman exactos. Nadie tiene que decidir cómo
 * repartir 190 € entre dos terapias.
 *
 * `tipos` son los `EventType` del centro; `bonos`, las filas ya contadas por el
 * servidor. Los bonos de un tipo borrado del catálogo no se pierden: caen en su
 * propia fila con el nombre en su sitio.
 */
export function resumenPorTipoDeBono({ tipos = [], bonos = [] } = {}) {
  const porId = new Map(tipos.map((t) => [String(t.id), t]));
  const vacio = () => ({ vivos: [], cerrados: [] });
  const cubos = new Map(tipos.map((t) => [String(t.id), vacio()]));

  for (const bono of bonos) {
    const id = String(bono?.eventTypeId ?? "");
    if (!cubos.has(id)) cubos.set(id, vacio());
    const cubo = cubos.get(id);
    (bonoCerrado(bono) ? cubo.cerrados : cubo.vivos).push(bono);
  }

  const filas = [...cubos.entries()].map(([id, cubo]) => {
    const t = porId.get(id) ?? null;
    const todos = [...cubo.vivos, ...cubo.cerrados];
    const { vendido, pendiente, sesionesLibres, sinImporte } = totalesDeBonos(cubo.vivos);
    return {
      id,
      name: t?.name ?? "(tipo de bono borrado del catálogo)",
      enElCatalogo: Boolean(t),
      // Lo que dice el catálogo: cuántas sesiones y a qué precio se vende hoy.
      // Puede no coincidir con lo que compró la gente, y eso es correcto: quien
      // compró un bono de 10 tiene 10 aunque el programa ahora sean 12.
      sesionesDelTipo: t ? Number(t.sessionsCount) || 1 : null,
      precio: t ? (Number.isInteger(t.price) ? t.price : null) : null,
      oculto: t ? t.isHidden === true : false,
      activo: t ? t.active !== false : false,
      bonos: cubo.vivos.length,
      cerrados: cubo.cerrados.length,
      sesionesLibres,
      vendido,
      pendiente,
      sinImporte,
      ...contarGente(cubo.vivos),
      // Con la gente de siempre incluida: para saber quién PASÓ por este bono
      // hay que contar también los cerrados.
      pacientesHistoricos: contarGente(todos).pacientes,
    };
  });

  return filas;
}

/**
 * A cuánta gente cubren estos bonos, sin contar a nadie dos veces.
 *
 * Un bono con paciente cuenta ese paciente; sin paciente es de la familia
 * entera (`lib/citas/bonoDelPaciente.js`) y entonces lo que se cuenta es la
 * familia — no sus hijos, que es lo que hace `cuotaPacientes.js` con las
 * cuotas. La diferencia no es un descuido: la cuota de la familia la paga la
 * familia por todos sus hijos, y un bono de diez sesiones sin dueño es UN
 * montón de diez que se gasta el primero que pida cita, no diez por hijo.
 */
export function contarGente(bonos = []) {
  const pacientes = new Set();
  const familias = new Set();
  let deLaFamilia = 0;
  for (const b of bonos) {
    if (b?.clientId) familias.add(String(b.clientId));
    if (b?.patientId) pacientes.add(String(b.patientId));
    else deLaFamilia += 1;
  }
  return { pacientes: pacientes.size, familias: familias.size, sinPaciente: deLaFamilia };
}

/**
 * Las filas ordenadas como se leen: primero los vivos, y dentro de cada grupo
 * el más reciente arriba.
 *
 * Al revés que las cuotas, que se ordenan por nombre: una cuota se busca («¿qué
 * paga Hugo?») y un bono se repasa («¿qué se ha vendido esta semana?»). El
 * nombre se encuentra con el buscador; la fecha, no.
 */
export function ordenarBonos(bonos = []) {
  return [...bonos].sort((a, b) => {
    const ca = bonoCerrado(a);
    const cb = bonoCerrado(b);
    if (ca !== cb) return ca ? 1 : -1;
    const fa = new Date(a?.compradoEl ?? 0).getTime() || 0;
    const fb = new Date(b?.compradoEl ?? 0).getTime() || 0;
    return fb - fa;
  });
}
