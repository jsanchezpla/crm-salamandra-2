/**
 * lib/fichaje/totales.js — los números del fichaje, en UN solo sitio.
 *
 * La pantalla, el Excel de salida y cualquier informe futuro llaman aquí. Si el
 * total de la pantalla y el del Excel salieran de sitios distintos acabarían
 * discrepando por un redondeo, y entonces nadie se fía de ninguno de los dos —
 * que es exactamente lo que pasa con las hojas de cálculo que este módulo viene
 * a sustituir. Mismo criterio que `lib/clinica/estadisticas.js`, que alimenta
 * pantalla, Excel y PDF con una sola función.
 *
 * Nada de esto se guarda en base de datos. Los totales se cuentan al leer, como
 * el stock del inventario se suma de sus movimientos.
 *
 * Estas funciones son PURAS: reciben filas ya cargadas y devuelven números. No
 * consultan nada, así que se pueden probar sin base de datos.
 */

/** Suma de minutos de un conjunto de filas, ignorando las dadas de baja. */
function suma(filas, campo) {
  return filas.reduce((acc, f) => acc + (Number(f[campo]) || 0), 0);
}

/**
 * Resumen por persona de un conjunto de fichajes.
 *
 * `personas` es la lista completa del equipo activo, y NO se deduce de las
 * filas a propósito: quien no tiene ni un fichaje en todo el mes es
 * precisamente el caso que hay que ver, y si se dedujera de los datos
 * desaparecería del listado justo cuando importa.
 */
export function resumirPorPersona(fichajes, personas) {
  const porPersona = new Map();
  for (const p of personas) {
    porPersona.set(p.id, {
      teamMemberId: p.id,
      nombre: p.displayName || p.email || "(sin nombre)",
      dias: 0,
      minutos: 0,
      minutosPrevistos: 0,
      extras: 0,
      correcciones: 0,
      filas: 0,
    });
  }

  const diasVistos = new Map(); // personaId → Set(fecha)

  for (const f of fichajes) {
    const r = porPersona.get(f.teamMemberId);
    if (!r) continue; // fichaje de alguien que ya no está en la lista
    if (f.tipo !== "trabajo") continue;
    r.filas += 1;
    r.minutos += Number(f.minutos) || 0;
    r.minutosPrevistos += Number(f.minutosPrevistos) || 0;
    if (f.origen !== "import") r.correcciones += 1;
    if (!diasVistos.has(f.teamMemberId)) diasVistos.set(f.teamMemberId, new Set());
    diasVistos.get(f.teamMemberId).add(String(f.fecha));
  }

  for (const [id, dias] of diasVistos) {
    const r = porPersona.get(id);
    if (r) r.dias = dias.size;
  }
  // Las extras son la diferencia con lo previsto, y solo cuando hay previsto:
  // sin horario teórico no se puede decir que alguien haya hecho de más.
  for (const r of porPersona.values()) {
    r.extras = r.minutosPrevistos > 0 ? r.minutos - r.minutosPrevistos : 0;
  }

  return [...porPersona.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Totales del mes entero. */
export function totalesDelMes(resumen) {
  return {
    personas: resumen.length,
    personasConFichajes: resumen.filter((r) => r.filas > 0).length,
    minutos: suma(resumen, "minutos"),
    minutosPrevistos: suma(resumen, "minutosPrevistos"),
    extras: suma(resumen, "extras"),
    correcciones: suma(resumen, "correcciones"),
  };
}

// ─── Avisos ─────────────────────────────────────────────────────────────────
//
// Un módulo de fichaje que solo suma horas obliga a leerse 300 filas para
// encontrar la que está mal. Estos avisos son lo que convierte la pantalla en
// algo que se mira: dicen DÓNDE mirar.
//
// Cada aviso lleva `gravedad`: `error` es algo que casi seguro está mal y
// afecta a una nómina; `revisar` es algo raro que puede ser correcto (un turno
// de noche, un día de guardia). No se mezclan, porque un listado donde todo es
// urgente no lo lee nadie.

const JORNADA_LARGA_MIN = 12 * 60;
const JORNADA_CORTA_MIN = 15;

/**
 * @param {Array} fichajes filas del periodo
 * @param {Array} personas equipo activo
 * @param {object} ctx
 * @param {Set<string>} ctx.festivos claves 'YYYY-MM-DD' festivas
 * @param {Map<string,Set<string>>} ctx.ausencias personaId → fechas de ausencia
 */
export function avisosDelMes(fichajes, personas, { festivos = new Set(), ausencias = new Map() } = {}) {
  const avisos = [];
  const nombrePorId = new Map(personas.map((p) => [p.id, p.displayName || p.email || "(sin nombre)"]));
  const conFilas = new Set();

  for (const f of fichajes) {
    if (f.deletedAt) continue;
    conFilas.add(f.teamMemberId);
    const quien = nombrePorId.get(f.teamMemberId) || "(fuera del equipo)";
    const base = { teamMemberId: f.teamMemberId, nombre: quien, fecha: String(f.fecha), fichajeId: f.id };

    // Entró y no consta que saliera: el total de ese día es una suposición.
    if (f.entradaAt && !f.salidaAt && f.tipo === "trabajo") {
      avisos.push({ ...base, gravedad: "error", tipo: "sin_salida", texto: "Entrada sin salida" });
    }
    if (!f.entradaAt && f.salidaAt && f.tipo === "trabajo") {
      avisos.push({ ...base, gravedad: "error", tipo: "sin_entrada", texto: "Salida sin entrada" });
    }
    if (f.tipo === "trabajo" && Number(f.minutos) > JORNADA_LARGA_MIN) {
      avisos.push({
        ...base,
        gravedad: "revisar",
        tipo: "jornada_larga",
        texto: `Jornada de más de 12 h (${Math.round(Number(f.minutos) / 60)} h)`,
      });
    }
    if (f.tipo === "trabajo" && Number(f.minutos) > 0 && Number(f.minutos) < JORNADA_CORTA_MIN) {
      avisos.push({ ...base, gravedad: "revisar", tipo: "jornada_corta", texto: "Jornada de menos de 15 min" });
    }
    // Estos dos son gratis porque el CRM ya sabe de festivos y de ausencias, y
    // valen mucho: fichar un día que consta como vacaciones es, o un error del
    // reloj, o unas vacaciones mal apuntadas. Las dos cosas hay que mirarlas.
    if (festivos.has(String(f.fecha)) && f.tipo === "trabajo") {
      avisos.push({ ...base, gravedad: "revisar", tipo: "festivo", texto: "Fichaje en día festivo" });
    }
    if (ausencias.get(f.teamMemberId)?.has(String(f.fecha)) && f.tipo === "trabajo") {
      avisos.push({ ...base, gravedad: "revisar", tipo: "ausencia", texto: "Fichaje en día de ausencia o vacaciones" });
    }
  }

  // Quien no tiene NADA en todo el mes. Va el último y en su propio tipo
  // porque no es un dato malo, es un dato que falta — y esa es justo la
  // diferencia que hace que se mire.
  for (const p of personas) {
    if (conFilas.has(p.id)) continue;
    avisos.push({
      teamMemberId: p.id,
      nombre: p.displayName || p.email || "(sin nombre)",
      fecha: null,
      fichajeId: null,
      gravedad: "error",
      tipo: "sin_fichajes",
      texto: "Sin ningún fichaje este mes",
    });
  }

  const orden = { error: 0, revisar: 1 };
  return avisos.sort(
    (a, b) => orden[a.gravedad] - orden[b.gravedad] || (a.fecha || "").localeCompare(b.fecha || "") || a.nombre.localeCompare(b.nombre, "es")
  );
}

/** Primer y último día de un periodo 'YYYY-MM'. */
export function rangoDelPeriodo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    desde: `${m[1]}-${m[2]}-01`,
    hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, "0")}`,
    year,
    month,
    dias: ultimo,
  };
}
