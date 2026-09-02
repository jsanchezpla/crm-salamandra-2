/**
 * lib/clinica/argumentosDelPdf.js — todo lo que necesita el PDF del informe,
 * cargado UNA vez y en un solo sitio.
 *
 * (Fichero nuevo en /lib, regla #2: no añade lógica, quita una duplicación que
 * ya estaba dando problemas.)
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 * El PDF del informe se genera desde DOS rutas: «Ver PDF»
 * (`GET /api/clinica/reports/[id]/pdf`) y «Enviar al paciente»
 * (`POST /api/clinica/reports/[id]/enviar`). Las dos construían por su cuenta
 * los mismos ocho argumentos, con sus `attributes` recortados cada una por su
 * lado y copiados a mano.
 *
 * Eso significa que un dato nuevo —la fecha de nacimiento, el nº de colegiada—
 * se puede añadir en una y olvidar en la otra, y entonces la profesional
 * previsualiza un documento y la familia recibe OTRO. Nadie lo nota hasta que
 * un padre compara los dos, que es el peor momento posible para enterarse.
 *
 * Con esto, las dos rutas hacen una sola llamada y los `attributes` se declaran
 * aquí: la clase de fallo desaparece en vez de quedarse vigilada.
 *
 * ⚠️ Los `attributes` de los `include` son la lista de lo que el PDF puede
 * pintar. Si mañana la portada necesita un campo más, se añade AQUÍ y llega a
 * las dos rutas a la vez.
 */

import { sesionesDelInforme } from "./sesionesDelInforme.js";

/**
 * ── Y LO MISMO PARA EL REGISTRO DE SESIÓN (03/09/2026) ─────────────────────
 * Desde que el registro lleva la misma portada que el informe, su PDF pide
 * lo mismo: la fecha de nacimiento para la edad, las especialidades para el
 * «Servicio de…», la acreditación de quien firma y —si sale de un taller— el
 * nombre del taller. Y también lo generan DOS rutas («Ver PDF» y «Enviar al
 * paciente»), así que la misma clase de fallo de arriba se evita igual:
 * `includesDeLaSesion` + `argumentosDelPdfDeSesion`, y nada copiado a mano.
 */

/** Lo que el PDF necesita del paciente. */
export const ATRIBUTOS_PACIENTE = ["id", "firstName", "lastName", "clientId", "specialties", "birthDate"];

/**
 * Lo que el PDF necesita de quien firma. `position` es el puesto en el centro
 * («Logopeda»); `qualification` y `collegiateNumber` son lo que ACREDITA a esa
 * persona y lo que exige un informe clínico formal.
 */
export const ATRIBUTOS_TERAPEUTA = ["id", "displayName", "position", "qualification", "collegiateNumber"];

/** Los `include` con los que hay que cargar el informe para poder pintarlo. */
export function includesDelInforme({ Patient, TeamMember }) {
  return [
    { model: Patient, as: "patient", attributes: ATRIBUTOS_PACIENTE },
    { model: TeamMember, as: "therapist", attributes: ATRIBUTOS_TERAPEUTA },
  ];
}

/** El nombre del paciente, compuesto y sin dobles espacios. */
export function nombreDePaciente(patient) {
  return `${patient?.firstName ?? ""} ${patient?.lastName ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * El paquete completo de argumentos de `buildReportPdfBuffer`, listo para
 * pasárselo tal cual.
 *
 * @param report  el informe YA cargado con `includesDelInforme`
 * @param ctx     el contexto del tenant (`withTenant`)
 */
export async function argumentosDelPdf(report, ctx) {
  const t = report?.therapist ?? null;
  return {
    report,
    patientName: nombreDePaciente(report?.patient),
    // La portada dice la edad QUE TENÍA en la fecha del informe.
    patientBirthDate: report?.patient?.birthDate ?? null,
    therapistName: t?.displayName ?? null,
    therapistPosition: t?.position ?? null,
    therapistQualification: t?.qualification ?? null,
    therapistCollegiate: t?.collegiateNumber ?? null,
    tenantName: ctx.tenant?.name ?? null,
    // De `brand` salen TODOS los colores del documento y las rutas del logo y
    // del isotipo (`lib/clinica/marcaInforme.js`, `lib/pdf/imagenLocal.js`).
    brand: ctx.tenant?.settings?.brand ?? {},
    // El tenant entero: de aquí salen los datos del centro (razón social, CIF,
    // sedes con su nº de registro sanitario, protección de datos) y el catálogo
    // de especialidades de derivación DEL CENTRO, para que la etiqueta que se
    // imprime sea la que escribieron ellos y no la clave interna.
    tenant: ctx.tenant,
    // El informe de beca traduce estas claves a los nombres oficiales de la
    // convocatoria (`lib/clinica/beca.js`).
    patientSpecialties: report?.patient?.specialties ?? [],
    // La portada imprime el periodo y el cuerpo las fechas; el contenido
    // literal solo va en el anexo opcional (26/08/2026, Rodrigo).
    sourceSessions: await sesionesDelInforme(ctx.tenantModels, report),
  };
}

/** Los `include` con los que hay que cargar la SESIÓN para poder pintarla. */
export function includesDeLaSesion({ TeamMember }) {
  return [{ model: TeamMember, as: "therapist", attributes: ATRIBUTOS_TERAPEUTA }];
}

/**
 * El nombre del taller del que sale un registro, o null si no sale de ninguno
 * (o si el centro no tiene talleres: los modelos pueden no estar).
 */
async function nombreDelTaller(session, { TallerSesion, Taller } = {}) {
  if (!session?.tallerSesionId || !TallerSesion || !Taller) return null;
  const fila = await TallerSesion.findByPk(session.tallerSesionId, {
    attributes: ["id", "tallerId"],
    include: [{ model: Taller, as: "taller", attributes: ["id", "name"] }],
  });
  return fila?.taller?.name ?? null;
}

/**
 * El paquete completo de argumentos de `buildSessionPdfBuffer`, listo para
 * pasárselo tal cual.
 *
 * @param session  la sesión YA cargada con `includesDeLaSesion`
 * @param ctx      el contexto del tenant (`withTenant`)
 *
 * Devuelve además `patientClientId` —de qué pagador es el paciente—, que el
 * PDF no usa pero «Enviar al paciente» necesita para saber a qué área privada
 * va, y sale de la misma consulta.
 */
export async function argumentosDelPdfDeSesion(session, ctx) {
  const { Patient } = ctx.tenantModels;
  // El paciente va aparte: `ClinicSession` no lo trae asociado en todos los
  // sitios y aquí solo hace falta lo que la portada pinta de él.
  const patient = await Patient.findByPk(session.patientId, { attributes: ATRIBUTOS_PACIENTE });
  const t = session?.therapist ?? null;
  return {
    session,
    patientName: nombreDePaciente(patient),
    patientBirthDate: patient?.birthDate ?? null,
    patientSpecialties: patient?.specialties ?? [],
    patientClientId: patient?.clientId ?? null,
    therapistName: t?.displayName ?? null,
    therapistPosition: t?.position ?? null,
    therapistQualification: t?.qualification ?? null,
    therapistCollegiate: t?.collegiateNumber ?? null,
    tenantName: ctx.tenant?.name ?? null,
    brand: ctx.tenant?.settings?.brand ?? {},
    // Para caer a las plantillas DEL CENTRO cuando el registro no trae su
    // propia foto de apartados: todo lo escrito antes del 29/08/2026.
    tenant: ctx.tenant,
    tallerNombre: await nombreDelTaller(session, ctx.tenantModels),
  };
}
