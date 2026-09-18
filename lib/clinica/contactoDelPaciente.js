/**
 * lib/clinica/contactoDelPaciente.js — el contacto externo con el que se
 * coordinó, comprobando que pertenece a la agenda DE ESE paciente.
 *
 * (Se saca de `app/api/clinica/coordinations/route.js` el 18/09/2026, al añadir
 * el PATCH: la comprobación tenía que correr también al corregir un acta —y
 * sobre todo al cambiarle el paciente—, y dos copias del mismo guard acaban
 * divergiendo. Es justo el caso de la regla #2: un «esto sí, esto no» que el
 * servidor necesita se declara una vez en `lib/`.)
 *
 * Sin esta comprobación, mandar el id del contacto de otro niño enlazaría el
 * acta con la orientadora de una familia distinta: una fuga de datos clínicos
 * entre familias, y de las difíciles de ver porque el acta se guardaría sin
 * error. Devuelve null ante cualquier duda; el enlace es opcional.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function contactoValido(models, patientId, contactoId) {
  if (!contactoId || !patientId) return null;
  if (!UUID_RE.test(String(contactoId)) || !UUID_RE.test(String(patientId))) return null;
  const { ExternalContact } = models ?? {};
  if (!ExternalContact) return null;
  const c = await ExternalContact.findOne({
    where: { id: String(contactoId), patientId: String(patientId) },
    attributes: ["id"],
  });
  return c ? c.id : null;
}
