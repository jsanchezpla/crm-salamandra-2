/**
 * lib/tablero/parser.js — cómo se trocea el Registro y cómo se comprueba antes
 * de publicarlo.
 *
 * (Motivo del fichero en /lib, regla #2: hasta el 19/08/2026 el troceador vivía
 * dentro de `app/api/admin/tablero/route.js`. Ese día el texto del Registro dejó
 * de viajar en la imagen de Docker y pasó a `master.tablero_documentos`, y quien
 * lo publica es un script que corre DENTRO del contenedor — donde no hay `app/`.
 * El script tiene que validar con el MISMO troceador que pinta la pantalla, o la
 * validación no vale nada. Aquí es lógica pura y la fija
 * `scripts/_smoke-tablero-parser.mjs`.)
 *
 * Dos cosas, y las dos sin base de datos:
 *
 *   · `trocear(texto)` — secciones (`##`) y tareas (`###`), con el cliente sacado
 *     de la cola del título. Es lo que pinta `/admin/tablero`.
 *   · `comprobar(texto, nombre)` — lo que se mira ANTES de guardar una versión:
 *     errores (no se publica) y avisos (se publica, pero se dicen). Existe porque
 *     con el texto en una tabla ya no hay diff de git que delate un `###` mal
 *     puesto: o se comprueba antes de escribir, o se descubre cuando el tablero
 *     sale vacío.
 *
 * Se hace a mano y no con una librería de markdown porque lo que hace falta no
 * es HTML: es saber de qué cliente es cada cosa y en qué bloque cae. El cuerpo
 * se deja tal cual y lo pinta el navegador como texto.
 */

/** Los dos documentos del Registro, por su nombre en la tabla. */
export const DOCUMENTOS = ["backlog", "resuelto"];

/**
 * Clientes conocidos, para poder colgarle cada tarea a quien es.
 *
 * `quality_energy`, `abarcaia` y `healim` se fueron el 12/08/2026 (baja y purga
 * del schema), pero SIGUEN AQUÍ a propósito: el tablero lee tareas históricas
 * del backlog y del registro de resueltas, y ahí sus nombres están escritos.
 * Quitarlos de esta lista no borra esas tareas — las deja sin cliente, con la
 * cola metida dentro del título, que es justo el despiste que costó apuntar a
 * `somos` ese mismo día.
 *
 * Esta lista no se lee de la base de datos a propósito (habla también de
 * clientes que ya no están), así que un cliente nuevo hay que añadirlo aquí a
 * mano o sus tareas se quedan sin grupo. `comprobar` avisa cuando pasa.
 */
export const SLUGS = [
  "aumenta",
  "nutri_laura",
  "spain_enzymes",
  "quality_energy",
  "retorika",
  "abarcaia",
  "healim",
  "demo",
  "sandbox",
  "salamandra_solutions",
  "somos",
  // Las tres demos por oficio (13/08/2026, ver lib/demo/demos.js). Una tarea
  // de `· demo_clinica` NO cae además en el grupo de `demo`: el guión bajo
  // cuenta como parte del nombre en `sueltoEn`, así que `demo` no casa dentro
  // de `demo_clinica`. Si algún día se relaja ese límite, saldrían en los dos.
  "demo_clinica",
  "demo_nutricion",
  "demo_agencia",
  // Alta del 14/08/2026 desde el back-office.
  "gm_alvar_alonso",
];

/**
 * Destinatarios que no son un cliente, pero sí una respuesta legítima a «¿de
 * quién es esto?». Van al lado de los slugs y forman grupo propio.
 */
export const GENERICOS = ["todos", "producto", "interno", "documentación", "varios"];

/**
 * Las secciones del backlog son FIJAS: la pantalla les da color y etiqueta por
 * el título, y una inventada sale en gris y sin urgencia, como si no corriera
 * prisa. Por eso `comprobar` las trata como error y no como aviso.
 *
 * ── TRES COLORES Y DOS SALAS DE ESPERA (24/08/2026, Jorge) ─────────────────
 * Eran cuatro prioridades numeradas (P0 a P3) más «Pendiente de una decisión
 * suya». El problema no era cuántas: era que P2 y P3 querían decir lo mismo a la
 * hora de elegir qué se hace hoy —«no ahora»— y que P0 y P1 no se distinguían
 * sin leerse la etiqueta. Ahora son TRES y llevan color, porque de un vistazo es
 * como se mira esta lista: alta en rojo, media en ámbar, baja en verde.
 *
 * Y DOS que no llevan color a propósito, porque no son prioridades: son salas
 * de espera. Una tarea ahí no espera turno, espera OTRA COSA.
 *
 *   · «Pendiente de una decisión suya» — espera que Jorge o Rodrigo elijan. Ya
 *     existía, y no cambia.
 *   · «Sin comprobar» — NUEVA, y es la que hace posible apuntar desde el móvil.
 *     La regla de siempre («si no puedes comprobarlo, no lo apuntes») se escribió
 *     cuando apuntar costaba bajar el Registro, editarlo y publicarlo; aplicada a
 *     una tarea que se apunta en diez segundos desde el coche, obligaría a no
 *     apuntar nada. Aquí entra, pero entra DICIENDO que nadie ha ido a
 *     producción a verla, y no se mezcla con lo que sí se comprobó.
 *
 * Salir de «Sin comprobar» es moverla a una prioridad, y ese gesto es justo el
 * de haberla comprobado. Por eso no hay un tick de «comprobada»: sería un estado
 * más que mantener para decir lo que ya dice la sección.
 */
export const SECCIONES_BACKLOG = [
  "Alta",
  "Media",
  "Baja",
  "Pendiente de una decisión suya",
  "Sin comprobar",
];

/**
 * Las tres que son prioridad de verdad, de más a menos. Las otras dos de
 * `SECCIONES_BACKLOG` son salas de espera y no entran aquí: mover una tarea a
 * «Sin comprobar» no es bajarle la prioridad, es decir que no se sabe.
 */
export const PRIORIDADES = ["Alta", "Media", "Baja"];

/**
 * Los nombres viejos: se aceptan al LEER y nunca al escribir.
 *
 * El día que esto se escribió, el texto publicado (v16 del backlog) estaba
 * entero en `## P2 — cuando se pueda`. Si el troceador dejara de conocer esos
 * nombres, la pantalla se quedaría en blanco en el mismo despliegue y la única
 * salida sería republicar a toda prisa: un cambio de datos en producción metido
 * con calzador para tapar un despliegue, que es exactamente lo que no se hace
 * aquí. Con el alias, el documento viejo se sigue pintando —y ya con los colores
 * nuevos—, y reescribirlo deja de correr prisa.
 *
 * Dos de ellos caen en la misma: P0 y P1 eran «hoy» y «esta semana», y las dos
 * son Alta. Al reescribir el documento se fusionan, y eso es el cambio, no un
 * efecto secundario.
 */
export const SECCIONES_VIEJAS = new Map([
  ["P0 — hoy", "Alta"],
  ["P1 — esta semana", "Alta"],
  ["P2 — cuando se pueda", "Media"],
  ["P3 — deuda", "Baja"],
]);

/**
 * Cómo se llama hoy una sección, lleve el nombre que lleve escrito. Lo usa la
 * pantalla para dar color y el editor para saber dónde está una tarea.
 */
export function seccionDeHoy(titulo) {
  return SECCIONES_VIEJAS.get(titulo) ?? titulo;
}

/**
 * El manual de uso que va al principio de cada documento. Sus apartados también
 * son `###` —«Cómo se añade una tarea», «Prioridades»— así que se descarta por
 * el título de la sección, que es lo único que los distingue: las instrucciones
 * se leen en el texto, el tablero enseña qué hacer.
 */
const ES_MANUAL = /^cómo se usa|^como se usa/i;

/**
 * `## 19/08/2026` — las secciones de resuelto son fechas, lo más reciente arriba.
 * También vale un rango de días dentro del mismo mes, `## 06–07/08/2026` (hay
 * uno histórico); para ordenar cuenta el último día.
 */
const ES_FECHA = /^(?:\d{2}[–-])?(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * La ficha de una tarea: `<!--id:k7m2p9-->` en una línea suya dentro del cuerpo.
 *
 * ── POR QUÉ HAY UN IDENTIFICADOR DENTRO DEL TEXTO (24/08/2026) ─────────────
 * Hasta hoy una tarea se identificaba por su título normalizado
 * (`lib/tablero/estado.js`), y eso tenía una herida conocida y asumida:
 * reescribir el título dejaba huérfanos su tick y su reparto. Con un tick
 * huérfano no pasa nada —no casa con nada y no se pinta—, así que se aceptó.
 *
 * Con un ADJUNTO sí pasa: queda un fichero en disco que ya no alcanza nadie y
 * que nadie va a borrar. Por eso, antes de poder subir la primera captura, hacía
 * falta algo que no cambie cuando cambia el título.
 *
 * Va dentro del texto y no en una tabla aparte porque el texto es la verdad de
 * este Registro: una tarea copiada, movida de sección o cerrada se lleva su
 * ficha puesta, sin que nadie tenga que acordarse de mover nada al lado. Y va
 * como comentario de HTML porque el cuerpo se pinta como texto plano: el
 * troceador lo SACA del cuerpo antes de devolverlo, así que en pantalla no se
 * ve, y en el markdown crudo es una línea que no estorba a quien edita a mano.
 *
 * Las tareas viejas no lo llevan y no se las va a reescribir en bloque: `id`
 * sale `null` y todo lo de siempre sigue funcionando por título. Una tarea gana
 * su ficha la primera vez que se la toca desde el tablero.
 */
const MARCA_FICHA = /^[ \t]*<!--\s*id:([a-z0-9]{4,32})\s*-->[ \t]*$/im;

/** Cómo se escribe esa marca. Una sola forma, para que el `replace` la encuentre. */
export const marcaDeFicha = (id) => `<!--id:${id}-->`;

/** El formato que se acepta como ficha: minúsculas y números, de 4 a 32. */
export const ES_FICHA = /^[a-z0-9]{4,32}$/;

/**
 * Que el nombre esté SUELTO, no dentro de otra palabra: si no, «producto
 * (demostración)» le colgaría la tarea a `demo`. El guión bajo cuenta como
 * letra para que `nutri_laura` no case dentro de `nutri_laura_2`.
 */
export const sueltoEn = (texto, nombre) =>
  new RegExp(`(^|[^a-z0-9_])${nombre}([^a-z0-9_]|$)`, "i").test(texto);

/**
 * Los destinatarios de una tarea, sacados de la cola del título.
 *
 * NO SE PARTE POR COMAS, y ese detalle es justo lo que hace que los recuentos
 * cuadren. Las colas están escritas a mano y no son listas limpias: hay «demo,
 * aumenta, salamandra_solutions», pero también «nutri_laura (y todos con
 * citas)». Partiendo por comas, esa segunda inventa un cliente llamado
 * «nutri_laura (y todos con citas)» que no cae en ningún grupo — que es
 * exactamente lo que hacía que Aumenta enseñara 7 tareas teniendo 10.
 *
 * Se buscan los nombres CONOCIDOS dentro de la cadena y se devuelven los que
 * estén, sin repetir. Una tarea de tres clientes sale en los tres grupos.
 */
export function destinatarios(cola) {
  return [...SLUGS, ...GENERICOS].filter((n) => sueltoEn(cola, n));
}

/**
 * Trocea un documento en secciones (`##`) y tareas (`###`).
 *
 * Devuelve solo las secciones con tareas y sin el manual. Para ver TODO lo que
 * hay (también lo que se descarta, que es lo que `comprobar` necesita mirar)
 * está `trocearTodo`.
 */
export function trocear(texto) {
  return trocearTodo(texto).secciones.filter((s) => s.tareas.length > 0 && !s.esManual);
}

/**
 * El troceo completo, sin descartar nada: cada sección con su número de línea
 * y su marca de manual, y las tareas que aparecieron ANTES de la primera sección
 * (que el tablero no pinta — es una de las cosas que `comprobar` avisa).
 */
export function trocearTodo(texto) {
  /*
   * Se parte por /\r?\n/ y no por "\n" a secas (12/08/2026).
   *
   * Con finales de línea de Windows, cada línea conservaba su `\r` final. Y en
   * JavaScript el `.` no casa con `\r`, así que `/^##\s+(.+)$/` NO casaba con
   * «## P0 — hoy\r»: ninguna cabecera entraba, el troceador devolvía cero
   * secciones y la pantalla decía «Nada por aquí» — lo contrario de la verdad.
   *
   * El arreglo va aquí, en el corte, y no aflojando los regex: así se limpian a
   * la vez las cabeceras y los cuerpos, que también arrastraban un `\r` por
   * línea porque `join("\n").trim()` solo toca los extremos.
   */
  const lineas = (texto ?? "").split(/\r?\n/);
  const secciones = [];
  const huerfanas = [];
  let seccion = null;
  let tarea = null;
  // La última línea con algo escrito que se ha visto, en numeración de 1. Es lo
  // que hace que `lineaFin` no se coma las líneas en blanco que separan una
  // tarea de la siguiente: si contara hasta el `###` de abajo, cortar un bloque
  // se llevaría por delante el hueco que lo separa del vecino.
  let ultimaLlena = 0;

  const cerrarTarea = () => {
    if (!tarea) return;
    /*
     * La ficha se SACA del cuerpo antes de devolverlo. El cuerpo se pinta tal
     * cual en la pantalla —es texto, no markdown—, así que un comentario de HTML
     * ahí dentro se leería en pantalla con sus signos y todo.
     *
     * Quitar la línea deja tres saltos donde había dos; se recogen, o cada tarea
     * con ficha nacería con un hueco de más justo debajo del título.
     */
    const bruto = tarea.cuerpo.join("\n");
    const ficha = bruto.match(MARCA_FICHA);
    tarea.id = ficha ? ficha[1] : null;
    tarea.cuerpo = (ficha ? bruto.replace(MARCA_FICHA, "") : bruto)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // `lineaFin` es la última línea que ocupa la tarea en el texto. El editor la
    // necesita para poder cortar el bloque entero sin volver a buscarlo: sin
    // ella habría que adivinar dónde acaba, y una tarea acaba donde empieza otra
    // cosa, que puede ser un `###`, un `##` o el final del fichero.
    tarea.lineaFin = ultimaLlena;
    (seccion ? seccion.tareas : huerfanas).push(tarea);
    tarea = null;
  };

  lineas.forEach((linea, i) => {
    const h2 = linea.match(/^##\s+(.+)$/);
    const h3 = linea.match(/^###\s+(.+)$/);

    if (h2) {
      // Cerrar ANTES de contar esta línea: la tarea de arriba acaba en la última
      // línea escrita que hubo antes de la cabecera, no en la cabecera.
      cerrarTarea();
      ultimaLlena = i + 1;
      const titulo = h2[1].trim();
      seccion = { titulo, linea: i + 1, esManual: ES_MANUAL.test(titulo), tareas: [] };
      secciones.push(seccion);
      return;
    }

    if (h3) {
      cerrarTarea();
      ultimaLlena = i + 1;
      // El título lleva el cliente detrás de «·»: «Ocho familias … · nutri_laura»
      const bruto = h3[1].trim();
      const corte = bruto.lastIndexOf("·");
      let titulo = bruto;
      let quien = null;
      let quienes = [];
      if (corte > 0) {
        const cola = bruto
          .slice(corte + 1)
          .replace(/`/g, "")
          .trim();
        // Solo se separa si de verdad hay alguien conocido detrás: así un
        // título con un punto medio por otro motivo no se parte por la mitad.
        const encontrados = destinatarios(cola);
        if (encontrados.length > 0) {
          titulo = bruto.slice(0, corte).trim();
          quien = cola;
          quienes = encontrados;
        }
      }
      // `quien` es lo que escribió la persona y es lo que se enseña; `quienes`
      // es la lista para agrupar y contar. Son dos cosas distintas a propósito:
      // dentro del grupo de Aumenta sigue interesando ver que una tarea es
      // compartida con la demo.
      tarea = { titulo, quien, quienes, cuerpo: [], linea: i + 1 };
      return;
    }

    if (linea.trim()) ultimaLlena = i + 1;
    if (tarea) tarea.cuerpo.push(linea);
  });
  cerrarTarea();

  return { secciones, huerfanas };
}

/** Cuántas tareas pinta el tablero de un texto. */
export function contarTareas(texto) {
  return trocear(texto).reduce((n, s) => n + s.tareas.length, 0);
}

/**
 * Lo que se mira antes de guardar una versión. Devuelve `{ errores, avisos,
 * tareas, secciones }`; con un solo error, no se publica.
 *
 * Errores — lo que deja el tablero mintiendo o vacío:
 *   · documento desconocido, texto vacío o sin ninguna tarea;
 *   · una tarea antes de la primera sección (no se pinta);
 *   · en backlog, una sección que no es de las fijas (sale gris, sin urgencia);
 *   · en resuelto, una sección que no es una fecha `DD/MM/AAAA`, dos secciones
 *     con la misma fecha, o fechas que no van de la más reciente a la más vieja;
 *   · dos tareas con el mismo título en la misma sección (la pantalla las usa
 *     como clave y se pisan).
 *
 * Avisos — se publica igual, pero se dicen, porque son las tres líneas que el
 * manual llama obligatorias y que más se olvidan:
 *   · una tarea sin `*Se comprueba*`, sin sello `*Comprobado en producción*`, o
 *     sin cliente reconocido detrás del `·` (en backlog; en resuelto las viejas
 *     no lo llevaban y no se va a reescribir la historia).
 */
export function comprobar(texto, nombre) {
  const errores = [];
  const avisos = [];

  if (!DOCUMENTOS.includes(nombre)) {
    errores.push(`Documento desconocido: «${nombre}». Son ${DOCUMENTOS.join(" y ")}.`);
    return { errores, avisos, tareas: 0, secciones: 0 };
  }
  if (!texto || !texto.trim()) {
    errores.push("El texto está vacío.");
    return { errores, avisos, tareas: 0, secciones: 0 };
  }

  const { secciones, huerfanas } = trocearTodo(texto);
  const deVerdad = secciones.filter((s) => !s.esManual);
  const tareas = deVerdad.reduce((n, s) => n + s.tareas.length, 0);

  if (huerfanas.length) {
    errores.push(
      `${huerfanas.length} tarea(s) antes de la primera sección (no se pintan): ` +
        huerfanas.map((t) => `«${t.titulo}» (línea ${t.linea})`).join(", ")
    );
  }
  if (tareas === 0) {
    errores.push("No hay ninguna tarea (ningún `###` dentro de una sección `##`).");
  }

  if (nombre === "backlog") {
    for (const s of deVerdad) {
      if (SECCIONES_BACKLOG.includes(s.titulo)) continue;
      // Un nombre viejo (P0…P3) no es un error: es lo que hay escrito en lo ya
      // publicado. Se avisa para que quien esté editando sepa que ese bloque
      // todavía no se ha reescrito, y se sigue.
      if (SECCIONES_VIEJAS.has(s.titulo)) {
        avisos.push(
          `Sección «${s.titulo}» (línea ${s.linea}) lleva el nombre de antes del 24/08/2026; hoy se llama «${SECCIONES_VIEJAS.get(s.titulo)}». Se pinta con su color, pero conviene reescribirla.`
        );
        continue;
      }
      errores.push(
        `Sección «${s.titulo}» (línea ${s.linea}) no es de las fijas: ${SECCIONES_BACKLOG.map((x) => `«${x}»`).join(", ")}.`
      );
    }
  } else {
    let anterior = null;
    const vistas = new Set();
    for (const s of deVerdad) {
      const m = s.titulo.match(ES_FECHA);
      if (!m) {
        errores.push(`Sección «${s.titulo}» (línea ${s.linea}) no es una fecha DD/MM/AAAA.`);
        continue;
      }
      const clave = `${m[3]}${m[2]}${m[1]}`;
      if (vistas.has(clave)) {
        errores.push(
          `La fecha ${s.titulo} aparece dos veces (línea ${s.linea}): las entradas del día van dentro de la misma sección.`
        );
      }
      vistas.add(clave);
      if (anterior && clave > anterior) {
        errores.push(
          `La sección ${s.titulo} (línea ${s.linea}) está debajo de una más antigua: lo más reciente va arriba.`
        );
      }
      anterior = clave;
    }
  }

  /*
   * Las fichas se miran en TODO el documento, no por sección, y son un error y
   * no un aviso.
   *
   * De una ficha cuelgan los adjuntos. Dos tareas con la misma ficha no son un
   * despiste cosmético: son dos tareas enseñando cada una las capturas de la
   * otra, y la forma normal de llegar ahí es copiar y pegar un bloque entero
   * para escribir una tarea parecida — que es exactamente lo que hace todo el
   * mundo. Por eso se para aquí, antes de publicar, y no se descubre mirando una
   * captura que no venía a cuento.
   */
  const fichas = new Map();
  for (const s of deVerdad) {
    for (const t of s.tareas) {
      if (!t.id) continue;
      const antes = fichas.get(t.id);
      if (antes) {
        errores.push(
          `La ficha «${t.id}» está en dos tareas: «${antes}» y «${t.titulo}» (línea ${t.linea}). Si has copiado un bloque para escribir otra tarea, bórrale la línea <!--id:…--> a la copia.`
        );
      } else {
        fichas.set(t.id, t.titulo);
      }
    }
  }

  for (const s of deVerdad) {
    const titulos = new Set();
    for (const t of s.tareas) {
      if (titulos.has(t.titulo)) {
        errores.push(
          `Dos tareas con el mismo título en «${s.titulo}»: «${t.titulo}» (línea ${t.linea}).`
        );
      }
      titulos.add(t.titulo);

      if (nombre === "backlog") {
        const faltas = [];
        if (!/\*Se comprueba\*/.test(t.cuerpo)) faltas.push("*Se comprueba*");
        if (!/\*Comprobado en producción\*/.test(t.cuerpo))
          faltas.push("*Comprobado en producción*");
        if (!t.quienes.length) faltas.push("cliente reconocido detrás del «·»");
        if (faltas.length) {
          avisos.push(`«${t.titulo}» (línea ${t.linea}) sin ${faltas.join(", ")}.`);
        }
      }
    }
  }

  return { errores, avisos, tareas, secciones: deVerdad.length };
}

/**
 * Qué tareas entran y cuáles salen entre dos textos, por título. Es lo que
 * enseña `publicar` antes de escribir: «+1 entra, −2 salen» dice más que un
 * número de bytes, y un «salen 14» con una nota de «apuntar una tarea» es la
 * señal de que alguien ha pegado medio fichero.
 */
export function diferenciaDeTitulos(antes, despues) {
  const titulosDe = (texto) =>
    new Set(trocear(texto ?? "").flatMap((s) => s.tareas.map((t) => t.titulo)));
  const a = titulosDe(antes);
  const d = titulosDe(despues);
  return {
    entran: [...d].filter((t) => !a.has(t)),
    salen: [...a].filter((t) => !d.has(t)),
  };
}
