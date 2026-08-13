/**
 * lib/provisioning/ficherosTenant.js — DÓNDE están los papeles de un cliente.
 *
 * (Fichero nuevo en /lib, regla #2: hasta ahora nadie sabía responder a «¿qué
 * hay en disco de este cliente?» sin abrir seis módulos. Lo necesitan la baja
 * —que tiene que llevárselos— y la pantalla que la pide, que tiene que poder
 * enseñar cuántos son ANTES de que nadie confirme nada.)
 *
 * ── EL PROBLEMA: LOS SEIS ALMACENES NO COMPARTEN FORMA ──────────────────────
 * Se construyeron en momentos distintos y quedaron en dos convenciones:
 *
 *   {slug}/clients/{clientId}/…        adjuntos de la ficha
 *   {slug}/signatures/{clientId}/…     firmas del contrato
 *   {slug}/patients/{patientId}/…      contratos del paciente
 *   documents/{slug}/…                 el archivo documental
 *   support/{slug}/{ticketId}/…        adjuntos de tickets
 *   nutricion-recipes/{slug}/…         fotos de recetas
 *
 * Tres ponen el cliente delante y tres lo meten detrás del tipo. `borrar-tenant.js`
 * no tocaba `uploads/` en ninguna línea, así que apartar el schema dejaba en
 * disco los papeles del cliente, documentos de salud incluidos, sin nada que los
 * apuntara y sin nadie que fuera a mirarlos nunca.
 *
 * ── EL BUZÓN NO ENTRA, Y ES A PROPÓSITO ─────────────────────────────────────
 * `buzon/{slug}/…` son las capturas que el cliente nos adjuntó al escribirNOS.
 * Viven en `master` justamente para sobrevivir a su baja (ver
 * lib/buzon/buzonStorage.js y docs/modules/buzon.md): si un cliente se fue
 * quejándose de algo, la queja y su captura son NUESTRO registro, no suyo. Las
 * caduca `scripts/podar-buzon.js`, que es quien tiene esa competencia.
 *
 * ── SE APARTAN, NO SE BORRAN ────────────────────────────────────────────────
 * Misma decisión que con el schema, y por el mismo motivo: la baja tiene que
 * poder deshacerse el día siguiente. Se mueven a `uploads/_bajas/<slug>_<fecha>/`
 * conservando su ruta relativa dentro, así que devolverlos es mover carpetas de
 * vuelta. Quien destruye de verdad es la purga, que sigue siendo SSH.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { getUploadsRoot } from "../documents/documentStorage.js";

const SLUG_RE = /^[a-z][a-z0-9_]{2,40}$/;

/** La carpeta donde se aparta lo de las bajas (la misma que el .rollback.sql). */
export const CARPETA_BAJAS = "_bajas";

/**
 * Las rutas RELATIVAS a `uploads/` que son de este cliente.
 *
 * `{slug}` a secas cubre de una vez los tres almacenes que ponen el cliente
 * delante (clients, signatures, patients): son subcarpetas suyas.
 */
export function rutasDelTenant(slug) {
  if (!SLUG_RE.test(String(slug || ""))) throw new Error(`Slug inválido: ${slug}`);
  return [
    { rel: slug, que: "Adjuntos de fichas, firmas y contratos de pacientes" },
    { rel: path.posix.join("documents", slug), que: "Archivo documental" },
    { rel: path.posix.join("support", slug), que: "Adjuntos de tickets de soporte" },
    { rel: path.posix.join("nutricion-recipes", slug), que: "Fotos del recetario" },
  ];
}

/** Cuántos ficheros y cuántos bytes hay bajo una carpeta. No lanza si no existe. */
async function medirCarpeta(abs) {
  let ficheros = 0;
  let bytes = 0;
  let entradas;
  try {
    entradas = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return { existe: false, ficheros: 0, bytes: 0 };
  }
  for (const e of entradas) {
    const hijo = path.join(abs, e.name);
    if (e.isDirectory()) {
      const r = await medirCarpeta(hijo);
      ficheros += r.ficheros;
      bytes += r.bytes;
    } else {
      try {
        const st = await fs.stat(hijo);
        ficheros += 1;
        bytes += st.size;
      } catch { /* desapareció entre el readdir y el stat */ }
    }
  }
  return { existe: true, ficheros, bytes };
}

/**
 * Qué hay en disco de este cliente. Solo LEE: es lo que se enseña antes de
 * pedir la confirmación de una baja.
 *
 * @returns {Promise<{total:{ficheros:number,bytes:number}, rutas:Array}>}
 */
export async function medirFicherosDelTenant(slug) {
  const raiz = getUploadsRoot();
  const rutas = [];
  let ficheros = 0;
  let bytes = 0;
  for (const r of rutasDelTenant(slug)) {
    const m = await medirCarpeta(path.join(raiz, ...r.rel.split("/")));
    rutas.push({ ...r, ...m });
    ficheros += m.ficheros;
    bytes += m.bytes;
  }
  return { total: { ficheros, bytes }, rutas };
}

/**
 * Aparta los ficheros del cliente a `uploads/_bajas/<destino>/`.
 *
 * `destino` es el mismo sello que el schema apartado, para que en disco y en
 * PostgreSQL se llamen igual y no haya que casar nada a ojo.
 *
 * Best-effort POR CARPETA: si una falla, las demás se mueven igual y el fallo se
 * devuelve. Dejar de dar de baja a un cliente porque un fichero está abierto en
 * Windows sería peor que el rastro que se intenta recoger — pero el fallo tiene
 * que llegar a la pantalla, no a un log.
 *
 * Si el destino ya existe (dos bajas el mismo segundo) el `rename` falla y se
 * recoge como error: no se sobreescribe nada.
 */
export async function apartarFicherosDelTenant(slug, destino) {
  const raiz = getUploadsRoot();
  const base = path.join(raiz, CARPETA_BAJAS, destino);
  const movidas = [];
  const errores = [];

  for (const r of rutasDelTenant(slug)) {
    const origen = path.join(raiz, ...r.rel.split("/"));
    const medida = await medirCarpeta(origen);
    if (!medida.existe) continue;

    const fin = path.join(base, ...r.rel.split("/"));
    try {
      await fs.mkdir(path.dirname(fin), { recursive: true });
      await fs.rename(origen, fin);
      movidas.push({ rel: r.rel, ficheros: medida.ficheros, bytes: medida.bytes });
    } catch (err) {
      errores.push(`${r.rel}: ${err.code ?? err.message}`);
    }
  }

  return { movidas, errores, carpeta: movidas.length || errores.length ? base : null };
}

/**
 * Los nombres que la purga tiene que reconocer, en un solo sitio.
 *
 * El `sello` se valida AQUÍ además de en quien llama: estos patrones acaban
 * decidiendo qué carpeta se borra con `rm -rf`, y un sello con `..` dentro
 * construiría una expresión que casa donde no debe. Quien llama ya lo comprueba,
 * pero el último filtro antes de un borrado recursivo no puede fiarse de eso.
 */
function patronesApartados(slug, sello) {
  if (sello !== null && sello !== undefined && !/^\d{14}$/.test(String(sello))) {
    throw new Error(`Sello inválido: ${sello}`);
  }
  return {
    dir: sello ? new RegExp(`^${slug}_${sello}$`) : new RegExp(`^${slug}_\\d{14}$`),
    red: sello
      ? new RegExp(`^baja-${slug}-${sello}\\.rollback\\.sql$`)
      : new RegExp(`^baja-${slug}-\\d{14}\\.rollback\\.sql$`),
  };
}

/**
 * Qué hay apartado en disco de este cliente. Solo LEE.
 *
 * La purga la necesita ANTES de decidir si tiene algo que hacer: mirando solo
 * los schemas decía «nada que purgar» y se iba, dejando en disco los papeles y
 * la red de rescate de un cliente cuyo schema ya no existía. Es lo que pasó con
 * las tres bajas del 12/08/2026.
 */
export async function listarApartados(slug, sello = null) {
  if (!SLUG_RE.test(String(slug || ""))) throw new Error(`Slug inválido: ${slug}`);
  const raiz = path.join(getUploadsRoot(), CARPETA_BAJAS);
  const { dir, red } = patronesApartados(slug, sello);
  let entradas;
  try {
    entradas = await fs.readdir(raiz, { withFileTypes: true });
  } catch {
    return { carpetas: [], redes: [] };
  }
  return {
    carpetas: entradas.filter((e) => e.isDirectory() && dir.test(e.name)).map((e) => e.name),
    redes: entradas.filter((e) => e.isFile() && red.test(e.name)).map((e) => e.name),
  };
}

/**
 * Destruye de verdad lo apartado de un cliente: sus ficheros Y su red de
 * rescate. La usa la PURGA, nunca la baja.
 *
 * ── POR QUÉ SE LLEVA TAMBIÉN EL `.rollback.sql` (13/08/2026) ────────────────
 * Purgado el schema, ese fichero no sirve para NADA: sus INSERT devuelven las
 * filas de master de un cliente cuyo schema ya no existe, o sea que restauran a
 * un tenant roto. Lo único que conserva de verdad son los `password_hash` de sus
 * usuarios, sobre disco, sin caducidad. Fue exactamente lo que pasó con las tres
 * bajas del 12/08/2026: schemas purgados y las tres redes ahí, inútiles.
 *
 * Acota por el sello para no llevarse por delante lo de otra baja del mismo
 * cliente que alguien quisiera conservar.
 */
export async function purgarFicherosApartados(slug, sello = null) {
  if (!SLUG_RE.test(String(slug || ""))) throw new Error(`Slug inválido: ${slug}`);
  const raiz = path.join(getUploadsRoot(), CARPETA_BAJAS);
  let entradas;
  try {
    entradas = await fs.readdir(raiz, { withFileTypes: true });
  } catch {
    return { borradas: [], redes: [] };
  }
  // El mismo filtro que la purga de schemas, y por el mismo motivo: un slug
  // puede ser PREFIJO de otro (`demo` se llevaría lo de `demo_clinica`), así que
  // se exige el formato entero <slug>_<14 dígitos> y no un `startsWith`.
  const { dir, red } = patronesApartados(slug, sello);

  const borradas = [];
  const redes = [];
  for (const e of entradas) {
    const abs = path.join(raiz, e.name);
    if (e.isDirectory() && dir.test(e.name)) {
      await fs.rm(abs, { recursive: true, force: true });
      borradas.push(e.name);
    } else if (e.isFile() && red.test(e.name)) {
      await fs.rm(abs, { force: true });
      redes.push(e.name);
    }
  }
  return { borradas, redes };
}
