/**
 * lib/clients/contactMethods.js — lógica compartida de los métodos de contacto
 * múltiples de un cliente (emails/teléfonos etiquetados, uno principal por tipo).
 *
 * (Motivo del fichero nuevo en /lib, regla #2: encapsula la validación por tipo
 * y, sobre todo, el ESPEJO del principal → Client.email / Client.phone. Ese
 * espejo lo comparten el endpoint de contactos y el PUT legacy de la ficha del
 * cliente; tenerlo en un solo sitio evita que ambos caminos diverjan y dejen el
 * portal/facturación apuntando a un email obsoleto.)
 *
 * Decisión de Aumenta: un cliente/tutor puede tener varios contactos, pero SOLO
 * el principal (email) da acceso al portal "Mis citas" y es el que usan
 * facturación y los avisos de cita — por eso el resto del CRM sigue leyendo
 * Client.email / Client.phone y aquí lo mantenemos sincronizado.
 */

export const CONTACT_KINDS = ["email", "phone"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// La columna value es VARCHAR(255), igual que Client.email/phone (la columna
// espejo), para no fallar ANTES ni de forma distinta a la que ya existía.
export const MAX_CONTACT_VALUE = 255;
export const MAX_CONTACT_LABEL = 60;

export function isMissingTable(err) {
  return err?.parent?.code === "42P01" || err?.original?.code === "42P01";
}

/** Normaliza el valor según el tipo. email → trim+lower; phone → trim. "" → null. */
export function normalizeContactValue(kind, raw) {
  if (raw == null) return null;
  let v = String(raw).trim();
  if (v === "") return null;
  if (kind === "email") v = v.toLowerCase();
  return v;
}

export function normalizeLabel(raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  return v === "" ? null : v.slice(0, MAX_CONTACT_LABEL);
}

/** Valida el valor ya normalizado. Devuelve mensaje de error o null si OK. */
export function validateContactValue(kind, value) {
  if (!CONTACT_KINDS.includes(kind)) return `Tipo de contacto inválido: "${kind}"`;
  if (!value) return "El valor no puede estar vacío";
  if (value.length > MAX_CONTACT_VALUE) return `El valor supera ${MAX_CONTACT_VALUE} caracteres`;
  if (kind === "email" && !EMAIL_RE.test(value)) return "Email inválido";
  return null;
}

/**
 * Refleja el método principal de cada tipo en Client.email / Client.phone.
 * Si no hay principal de un tipo pero sí métodos, usa el primero (fallback
 * defensivo). Si no hay ninguno de ese tipo → deja el campo a null.
 *
 * Guarda el Client dentro de la misma transacción. NO captura 42P01 aquí: si la
 * tabla no existe, el error debe propagar para que la transacción del endpoint
 * haga rollback y el catch EXTERNO (fuera de la transacción) lo convierta en 503
 * — capturarlo dentro dejaría la transacción abortada (25P02). Post-migración la
 * tabla existe siempre en todo tenant con `clients`.
 *
 * @returns {boolean} true (sincronizó); false solo si no hay modelo registrado.
 */
export async function syncClientMirror({ client, ClientContactMethod, transaction }) {
  if (!ClientContactMethod) return false;
  const methods = await ClientContactMethod.findAll({
    where: { clientId: client.id },
    order: [["isPrimary", "DESC"], ["createdAt", "ASC"]],
    transaction,
  });
  const patch = {};
  for (const kind of CONTACT_KINDS) {
    const ofKind = methods.filter((m) => m.kind === kind);
    const chosen = ofKind.find((m) => m.isPrimary) ?? ofKind[0] ?? null;
    const col = kind === "email" ? "email" : "phone";
    patch[col] = chosen ? chosen.value : null;
  }
  await client.update(patch, { transaction });
  return true;
}

/**
 * Upsert del método PRINCIPAL de un tipo con un valor dado (usado por el PUT
 * legacy de la ficha: el campo email/teléfono único edita el principal). Si ya
 * existe un principal de ese tipo, actualiza su valor; si no, crea uno nuevo
 * marcado principal. No desmarca otros (el índice parcial garantiza unicidad;
 * como reutilizamos el principal existente, no hay colisión). Luego refleja.
 *
 * value ya debe venir normalizado y validado. NO captura 42P01 (ver
 * syncClientMirror): que propague para rollback + 503 en el catch externo. El
 * caller que quiera degradar en tenants sin tabla debe comprobarlo ANTES de
 * abrir la transacción (el PUT legacy lo hace con un fallback fuera de la tx).
 */
export async function setPrimaryContactValue({ client, ClientContactMethod, kind, value, label, transaction }) {
  const col = kind === "email" ? "email" : "phone";
  if (!ClientContactMethod) {
    await client.update({ [col]: value }, { transaction });
    return false;
  }
  const existingPrimary = await ClientContactMethod.findOne({
    where: { clientId: client.id, kind, isPrimary: true },
    transaction,
  });
  if (existingPrimary) {
    if (existingPrimary.value !== value) {
      // El nuevo valor puede coincidir con OTRO método (secundario) del mismo
      // tipo. Fusiona en vez de duplicar: descarta el principal antiguo y
      // promueve el existente (así no quedan dos filas con el mismo value).
      const dup = await ClientContactMethod.findOne({
        where: { clientId: client.id, kind, value },
        transaction,
      });
      if (dup && dup.id !== existingPrimary.id) {
        await existingPrimary.destroy({ transaction });
        await dup.update({ isPrimary: true, ...(label != null ? { label } : {}) }, { transaction });
      } else {
        await existingPrimary.update({ value, ...(label != null ? { label } : {}) }, { transaction });
      }
    } else if (label != null && existingPrimary.label !== label) {
      await existingPrimary.update({ label }, { transaction });
    }
  } else {
    // ¿Existe ya un método (no principal) con ese mismo valor? Reutilízalo como
    // principal en vez de duplicar.
    const dup = await ClientContactMethod.findOne({ where: { clientId: client.id, kind, value }, transaction });
    if (dup) {
      await dup.update({ isPrimary: true, ...(label != null ? { label } : {}) }, { transaction });
    } else {
      await ClientContactMethod.create(
        { clientId: client.id, kind, value, label: label ?? null, isPrimary: true },
        { transaction }
      );
    }
  }
  await syncClientMirror({ client, ClientContactMethod, transaction });
  return true;
}

/** Serializa un método para la API (forma estable que consume la UI). */
export function serializeContactMethod(m) {
  const j = m.toJSON ? m.toJSON() : m;
  return {
    id: j.id,
    clientId: j.clientId,
    kind: j.kind,
    value: j.value,
    label: j.label ?? null,
    isPrimary: !!j.isPrimary,
  };
}
