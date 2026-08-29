/**
 * lib/tenant/datosCentro.js — los datos del centro que salen impresos.
 *
 * (Fichero nuevo en /lib, regla #2: es el LECTOR de `settings.centro`, y lo van
 * a compartir el PDF del informe clínico, su prueba y cualquier documento que
 * mañana lleve el membrete. La escritura y su validación viven aparte, en
 * `lib/tenant/normalizarCentro.js`: quien escribe puede ser estricto y
 * rechazar, quien imprime solo puede callar.)
 *
 * ── DE DÓNDE SALE ESTO ─────────────────────────────────────────────────────
 * El informe clínico rediseñado (28/08/2026, Rodrigo y Jorge) es el documento
 * que la familia lleva al colegio o presenta para la beca del Ministerio, así
 * que tiene que decir de qué centro sale: razón social, CIF, las sedes con su
 * nº de Registro Sanitario, los teléfonos y el párrafo de protección de datos.
 * Nada de eso existía en el CRM: `settings` solo tenía la marca.
 *
 * Va en `master.tenants.settings.centro` y NO en `TenantBillingSettings` —donde
 * ya viven `fiscalName` y `taxId`— porque eso ataría el informe clínico al
 * módulo de facturación: sin `billing` la tarjeta no se ve, el alta no crea la
 * fila, y su endpoint no mira el rol ni audita. El CIF que va impreso en un
 * documento sanitario no puede depender de si el centro nos ha contratado las
 * facturas. La Configuración es universal (CLAUDE.md, regla 14).
 *
 * ── LA REGLA: LO QUE NO ESTÁ, NO SE IMPRIME ────────────────────────────────
 * Todo esto es opcional y hoy, en producción, NO LO TIENE NADIE (el `settings`
 * de aumenta solo lleva `brand`, comprobado el 28/08/2026). Así que aquí no se
 * inventa nada ni se rellena con guiones: cada campo que falta sale como cadena
 * vacía o lista vacía, y el generador se salta la línea entera. Una portada sin
 * CIF es correcta; una portada que dice «CIF: undefined» es un error de la
 * clínica delante de una familia.
 */

const texto = (v) => (typeof v === "string" ? v.trim() : "");
const lista = (v) => (Array.isArray(v) ? v : []);

/**
 * Una sede lista para imprimir, o `null` si está completamente vacía.
 *
 * ⚠️ La regla de aquí tiene que ser la MISMA que la de
 * `lib/tenant/normalizarCentro.js`, que es quien guarda. Al principio esto
 * exigía nombre o dirección, y el escritor guardaba cualquier sede con algún
 * campo: una sede con solo el nº de Registro Sanitario se guardaba y NO se
 * imprimía, sin decir nada. Entre imprimir una línea escueta y tragarse en
 * silencio lo que alguien tecleó, se imprime: quien la escribió sabrá por qué.
 */
function sedeParaImprimir(s) {
  if (!s || typeof s !== "object") return null;
  const sede = {
    nombre: texto(s.nombre),
    direccion: texto(s.direccion),
    cp: texto(s.cp),
    ciudad: texto(s.ciudad),
    registroSanitario: texto(s.registroSanitario),
    telefono: texto(s.telefono),
  };
  if (!Object.values(sede).some(Boolean)) return null;
  return sede;
}

/**
 * La línea de una sede tal y como va al pie del documento:
 * «C/ Belén 12, Local · 28943 Fuenlabrada (Madrid) · Nº Reg. Sanitario CS12631»
 *
 * Se construye juntando SOLO lo que hay, para que no queden separadores
 * huérfanos cuando falta la mitad.
 */
export function lineaDeSede(sede) {
  const s = sedeParaImprimir(sede);
  if (!s) return "";
  const sitio = [s.cp, s.ciudad].filter(Boolean).join(" ");
  return [
    [s.nombre, s.direccion].filter(Boolean).join(", "),
    sitio,
    s.registroSanitario ? `Nº Reg. Sanitario ${s.registroSanitario}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Los datos del centro de un tenant, normalizados y sin huecos.
 *
 * Acepta el tenant entero (lo que devuelve `getTenantContext`), su `settings` o
 * directamente el objeto `centro`: los tres llegan desde sitios distintos y
 * obligar a acertar con el nivel es una fuente de bugs tonta.
 *
 * `nombre` cae al nombre del tenant cuando no hay razón social, porque la
 * portada necesita SIEMPRE algo que poner donde iría el logo.
 */
export function datosDelCentro(origen, { nombrePorDefecto = "" } = {}) {
  const raiz = origen && typeof origen === "object" ? origen : {};
  const settings = raiz.settings && typeof raiz.settings === "object" ? raiz.settings : raiz;
  const c = settings?.centro && typeof settings.centro === "object" ? settings.centro : {};

  const razonSocial = texto(c.razonSocial);
  const sedes = lista(c.sedes).map(sedeParaImprimir).filter(Boolean);
  const telefonos = lista(c.telefonos).map(texto).filter(Boolean);

  return {
    razonSocial,
    // Lo que se pinta cuando no hay logo, y lo que encabeza el pie.
    nombre: razonSocial || texto(raiz.name) || texto(nombrePorDefecto),
    cif: texto(c.cif),
    telefonos,
    sedes,
    // El aviso legal por defecto y, si el centro lo ha escrito, el de adultos.
    // Quién elige entre los dos es el generador del informe, que es el único
    // que sabe la edad del paciente: aquí solo se entregan los dos.
    proteccionDatos: texto(c.proteccionDatos),
    proteccionDatosAdultos: texto(c.proteccionDatosAdultos),
    // ¿Hay algo que imprimir en el pie? Si no, el generador se salta el bloque
    // entero en vez de dejar una raya con nada debajo.
    hayPie: Boolean(razonSocial || texto(c.cif) || sedes.length || telefonos.length),
  };
}

/**
 * El teléfono del centro, mirando los tres sitios donde ha ido cayendo.
 *
 * `settings.phone` y `settings.citas.telefono` ya se LEÍAN en los avisos de
 * cancelación y en la puerta de reserva, y nunca los escribió nadie porque no
 * había pantalla para ellos. Ahora que la hay, este es el orden: lo nuevo
 * primero, lo viejo detrás, para no romper a quien ya los tuviera puestos a
 * mano en la base.
 */
export function telefonoDelCentro(origen) {
  const raiz = origen && typeof origen === "object" ? origen : {};
  const settings = raiz.settings && typeof raiz.settings === "object" ? raiz.settings : raiz;
  const { telefonos } = datosDelCentro(origen);
  return telefonos[0] || texto(settings?.phone) || texto(settings?.citas?.telefono) || "";
}
