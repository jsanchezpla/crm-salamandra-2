/**
 * _solo-este-tenant.js — acota una migración al cliente que la ha pedido.
 *
 * ── DE DÓNDE SALE (11/08/2026) ──────────────────────────────────────────────
 * `ensure-tenant-schema.js <slug>` promete poner al día el schema de ESE
 * cliente. Y no lo hacía: el slug solo servía para elegir QUÉ migraciones
 * correr, y luego cada una se lanzaba con `spawnSync(execPath, [file])`, sin un
 * solo argumento. Treinta y una de las que dispara el alta se enumeran solas
 * («todos los tenants activos»), así que dar de alta a un cliente nuevo entraba
 * en el schema de Aumenta —12.030 citas, quince personas dentro— y en el de
 * todos los demás.
 *
 * Dos consecuencias, y las dos se vieron de verdad:
 *
 *   · El alta de un cliente puede FALLAR por el estado de OTRO. En la prueba
 *     del 11/08, seis de siete altas salieron con las migraciones sin aplicar
 *     porque un tercer tenant no tenía schema.
 *   · Un alta coge candados sobre las tablas de clientes que están trabajando.
 *
 * ── CÓMO SE ACOTA ───────────────────────────────────────────────────────────
 * Con `ONLY_SCHEMAS`, que NO es una variable nueva: es la que ya entendía
 * `_schema-targets.js` (modo exclusivo). Se reutiliza a propósito para que no
 * haya dos formas de decir lo mismo. `ensure-tenant-schema.js` la pone al
 * lanzar cada hija; una migración lanzada A MANO no la lleva y sigue siendo
 * global, que es como se escribieron y como tienen que seguir funcionando.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   import { acotarSlugs } from "./_solo-este-tenant.js";
 *   const slugs = acotarSlugs(rows.map((r) => r.slug));
 *
 * Y si lo que se tiene son schemas ya formados:
 *   const schemas = acotarSchemas(lista);
 */

/** Los schemas a los que se ha acotado la ejecución, o `null` si es global. */
function permitidos() {
  const crudo = (process.env.ONLY_SCHEMAS || "").trim();
  if (!crudo) return null;
  const lista = crudo
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return lista.length ? new Set(lista) : null;
}

/**
 * Filtra una lista de SLUGS (`aumenta`) dejando solo los acotados.
 * Sin `ONLY_SCHEMAS` devuelve la lista tal cual: el comportamiento de siempre.
 */
export function acotarSlugs(slugs) {
  const solo = permitidos();
  if (!solo) return slugs;
  return (slugs ?? []).filter((s) => solo.has(`crm_${s}`) || solo.has(s));
}

/**
 * Filtra una lista de SCHEMAS (`crm_aumenta`) dejando solo los acotados.
 */
export function acotarSchemas(schemas) {
  const solo = permitidos();
  if (!solo) return schemas;
  return (schemas ?? []).filter((s) => solo.has(s) || solo.has(`crm_${s}`));
}

/** Para que una migración pueda decir por pantalla que va acotada. */
export function acotadoA() {
  const solo = permitidos();
  return solo ? [...solo].join(", ") : null;
}
