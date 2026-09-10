/**
 * lib/billing/busquedaArqueo.js — buscar en el arqueo: los cierres de caja y
 * los apuntes de entrada y salida del cajón (10/09/2026, Rodrigo: «necesito un
 * buscador en la parte de arqueo»).
 *
 * ── QUÉ HABÍA HASTA HOY ────────────────────────────────────────────────────
 *
 * En los cierres, nada. La pestaña pintaba TODOS los de la caja —Aumenta lleva
 * 828 importados de Organízate más los que hace cada día— y la única manera de
 * llegar a uno era bajar por la tabla con el ratón. En las entradas y salidas
 * había el rango de fechas, que sirve para ver una semana pero no para
 * encontrar «el sobre del banco» entre doscientos apuntes.
 *
 * ── CÓMO BUSCA ─────────────────────────────────────────────────────────────
 *
 * Las mismas reglas que el buscador de Cobros (`busquedaCobros.js`, de donde
 * sale `patronDePalabra`): se parte en palabras, se exigen TODAS, cada una en
 * cualquiera de los campos, y sin obligar a poner tildes. Y tres cosas más,
 * porque una tabla de arqueo se mira de otra manera:
 *
 *   · POR DÍA. «31/07/2026», «31/07», «07/2026» o «2026» encuentran ese día,
 *     ese mes o ese año. Es lo primero que teclea cualquiera, y llegar al mismo
 *     sitio con el rango de fechas obliga a rellenar dos casillas.
 *   · POR IMPORTE, solo si la palabra ES un número («250», «20,50») y por
 *     IGUALDAD, no por parecido. Del descuadre se busca su TAMAÑO: los 20 que
 *     faltaron y los 20 que sobraron son el mismo 20 para quien busca.
 *   · EN CRISTIANO: «salida» filtra los apuntes con `direction='out'`, igual
 *     que «tarjeta» encuentra `method='card'` en Cobros.
 *
 * ⚠️ UN NÚMERO DE UNA O DOS CIFRAS NO SE BUSCA COMO FECHA, a propósito: «20»
 * casaría el «2026» de todos los cierres del año y el buscador devolvería la
 * tabla entera, que es justo lo que se venía a evitar. Para buscar por día hay
 * que escribir el día con su separador («31/07») o el año de cuatro cifras.
 *
 * Las dos funciones devuelven un fragmento `where` con `Op.and` (o `null` si no
 * hay nada que buscar) y necesitan que la consulta lleve el include de la
 * persona y `subQuery: false`, o las columnas `$...$` no existen.
 */
import { Op, fn, col, where as sqlWhere } from "sequelize";
import { palabrasDe } from "../utils/busqueda.js";
import { patronDePalabra } from "./busquedaCobros.js";

// Nadie busca un cierre con más de seis palabras; un pegote enorme sí llega.
const MAX_PALABRAS = 6;

// Entrada o salida dicho como se dice en recepción. Sin tildes ni mayúsculas:
// la palabra llega ya normalizada por `palabrasDe`.
const DIRECCION_DE_PALABRA = {
  entrada: "in",
  entradas: "in",
  ingreso: "in",
  ingresos: "in",
  salida: "out",
  salidas: "out",
  retirada: "out",
  retiradas: "out",
};

/** Lo escrito, en palabras buscables. */
function palabras(q) {
  return palabrasDe(q).slice(0, MAX_PALABRAS);
}

/**
 * ¿La palabra ES un importe? «250», «20,50», «-3.5» → el número; si no, null.
 *
 * Tiene que ser la palabra COMPLETA: dentro de «f-2026» hay un 2026 que no es
 * ningún importe.
 */
export function importeDe(palabra) {
  if (!/^-?\d{1,9}([.,]\d{1,2})?$/.test(String(palabra))) return null;
  const n = Number(String(palabra).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Las condiciones para encontrar un día escribiéndolo. Vacío si la palabra no
 * puede ser una fecha (ver el aviso de la cabecera).
 *
 * Dos formatos porque hay dos maneras de escribir un día y las dos se teclean:
 * la de la pantalla («31/07/2026») y la de la base («2026-07-31»).
 */
function porFecha(columna, palabra) {
  const p = String(palabra);
  const esAnio = /^\d{4}$/.test(p);
  const conSeparador = /^[\d/-]{3,10}$/.test(p) && /[/-]/.test(p);
  if (!esAnio && !conSeparador) return [];
  if (esAnio) return [sqlWhere(fn("to_char", col(columna), "YYYY"), { [Op.eq]: p })];
  const patron = patronDePalabra(p);
  return [
    sqlWhere(fn("to_char", col(columna), "DD/MM/YYYY"), { [Op.iRegexp]: patron }),
    sqlWhere(fn("to_char", col(columna), "YYYY-MM-DD"), { [Op.iRegexp]: patron }),
  ];
}

/**
 * Los CIERRES de caja. Busca en el motivo, en quién cerró, en el día y en los
 * importes del cierre (fondo, esperado, contado y el tamaño del descuadre).
 *
 * Necesita el include `closedBy` y `subQuery: false`.
 */
export function whereDeBusquedaCierres(q) {
  const trozos = palabras(q);
  if (!trozos.length) return null;

  return {
    [Op.and]: trozos.map((p) => {
      const patron = patronDePalabra(p);
      const campos = [
        { notes: { [Op.iRegexp]: patron } },
        { "$closedBy.display_name$": { [Op.iRegexp]: patron } },
        ...porFecha("CashClose.close_date", p),
      ];
      const importe = importeDe(p);
      if (importe !== null) {
        campos.push({ openingAmount: importe });
        campos.push({ expectedAmount: importe });
        campos.push({ countedAmount: importe });
        // El descuadre, por su tamaño: ver cabecera.
        campos.push(sqlWhere(fn("abs", col("CashClose.difference")), { [Op.eq]: Math.abs(importe) }));
      }
      return { [Op.or]: campos };
    }),
  };
}

/**
 * Las ENTRADAS Y SALIDAS del cajón. Busca en el concepto, en las
 * observaciones, en quién lo apuntó, en el día, en el importe y en la palabra
 * «entrada» o «salida».
 *
 * Necesita el include `createdBy` y `subQuery: false`.
 */
export function whereDeBusquedaMovimientos(q) {
  const trozos = palabras(q);
  if (!trozos.length) return null;

  return {
    [Op.and]: trozos.map((p) => {
      const patron = patronDePalabra(p);
      const campos = [
        { concept: { [Op.iRegexp]: patron } },
        { notes: { [Op.iRegexp]: patron } },
        { "$createdBy.display_name$": { [Op.iRegexp]: patron } },
        ...porFecha("CashMovement.date", p),
      ];
      const importe = importeDe(p);
      // El importe se guarda siempre positivo: el signo lo pone `direction`.
      if (importe !== null) campos.push({ amount: Math.abs(importe) });
      if (DIRECCION_DE_PALABRA[p]) campos.push({ direction: DIRECCION_DE_PALABRA[p] });
      return { [Op.or]: campos };
    }),
  };
}

/**
 * Colgar la búsqueda del `where` que ya se ha montado, respetando lo que
 * hubiera. Asignar `where[Op.and]` a pelo se lleva por delante lo anterior EN
 * SILENCIO, que es el fallo que ya se pagó en el Buzón.
 */
export function colgarBusqueda(where, busqueda) {
  if (!busqueda || !where) return where;
  const previos = Array.isArray(where[Op.and]) ? where[Op.and] : where[Op.and] ? [where[Op.and]] : [];
  where[Op.and] = [...previos, ...busqueda[Op.and]];
  return where;
}
