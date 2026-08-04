/**
 * contratoFirma — los DATOS que se piden al firmar el contrato en el portal
 * (sprint tunutrilaura 2026-08-04).
 *
 * (Fichero nuevo en /lib, regla #2: `clientContract.js` responde «¿hay contrato
 * y quién tiene que firmarlo?» y `guardians.js` normaliza los tutores de la
 * ficha. Ninguno de los dos sabe de campos de formulario ni de aceptaciones por
 * anexo, y lo que hay aquí lo comparten el endpoint de firma y el generador del
 * PDF —los dos tienen que estar de acuerdo en qué es un dato válido—.)
 *
 * La regla de fondo: lo que se guarda es lo que la persona DECLARÓ, no lo que
 * el centro tiene en la ficha. Por eso se valida el formato pero no se cruza
 * con nada: si alguien firma con un domicilio distinto del de su ficha, el
 * documento vale con el que puso al firmar.
 */

import { leerDeFicha, campoEsObligatorio } from "./datosFicha.js";

/** Tipos de campo que entiende una plantilla. */
export const FIELD_TYPES = ["text", "dni", "email", "tel", "date", "select", "textarea"];

const MAX = { text: 200, dni: 30, email: 255, tel: 30, select: 100, textarea: 2000 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEL_RE = /^[+()\d\s.-]{6,30}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// DNI: 8 dígitos + letra. NIE: X/Y/Z + 7 dígitos + letra.
const DNI_RE = /^(\d{8})([A-Z])$/;
const NIE_RE = /^([XYZ])(\d{7})([A-Z])$/;
const LETRAS = "TRWAGMYFPDXBNJZSQVHLCKE";

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * ¿Es un DNI/NIE con la letra correcta?
 *
 * Devuelve `null` cuando el valor NO tiene forma de DNI ni de NIE: se acepta
 * tal cual (pasaporte, documento extranjero). Solo se comprueba la letra de lo
 * que sí lo parece, que es donde están las erratas de verdad. Rechazar todo lo
 * que no sea un DNI español dejaría sin firmar —y por tanto sin empezar el
 * acompañamiento— a una paciente extranjera.
 */
export function letraDocumentoCorrecta(valor) {
  const v = texto(valor).toUpperCase().replace(/[\s-]/g, "");

  const dni = DNI_RE.exec(v);
  if (dni) return LETRAS[Number(dni[1]) % 23] === dni[2];

  const nie = NIE_RE.exec(v);
  if (nie) {
    const numero = Number(String("XYZ".indexOf(nie[1])) + nie[2]);
    return LETRAS[numero % 23] === nie[3];
  }
  return null;
}

/** Edad cumplida en una fecha dada. `null` si la fecha no es utilizable. */
export function edadEn(fechaNacimiento, referencia = new Date()) {
  const iso = texto(fechaNacimiento);
  if (!FECHA_RE.test(iso)) return null;
  const nac = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(nac.getTime())) return null;

  const ref = referencia instanceof Date ? referencia : new Date(referencia);
  if (Number.isNaN(ref.getTime())) return null;

  let edad = ref.getUTCFullYear() - nac.getUTCFullYear();
  const cumpleEsteAno =
    ref.getUTCMonth() > nac.getUTCMonth() ||
    (ref.getUTCMonth() === nac.getUTCMonth() && ref.getUTCDate() >= nac.getUTCDate());
  if (!cumpleEsteAno) edad -= 1;
  return edad;
}

/**
 * ¿La persona es menor de edad el día que firma?
 *
 * `null` (no lo sabemos) cuenta como MAYOR a propósito: es lo que evita que una
 * fecha ilegible convierta a una adulta en menor y le exija un consentimiento
 * paterno que no tiene sentido pedirle. El caso contrario —una menor que se
 * cuela como mayor— lo tapa la nutricionista, que la conoce.
 */
export function esMenor(fechaNacimiento, referencia = new Date()) {
  const edad = edadEn(fechaNacimiento, referencia);
  return edad != null && edad < 18;
}

/** Normaliza la definición de campos de una plantilla (defensivo ante JSONB). */
export function camposDe(plantilla) {
  const raw = Array.isArray(plantilla?.fields) ? plantilla.fields : [];
  return raw
    .filter((f) => f && typeof f === "object" && texto(f.key))
    .map((f) => ({
      key: texto(f.key),
      label: texto(f.label) || texto(f.key),
      type: FIELD_TYPES.includes(f.type) ? f.type : "text",
      required: f.required !== false,
      // Edad a partir de la cual el campo es obligatorio. null = siempre.
      requiredDesdeEdad: Number.isInteger(f.requiredDesdeEdad) ? f.requiredDesdeEdad : null,
      /**
       * `previo: true` = hace falta ANTES de firmar; el resto se piden DESPUÉS
       * (04/08/2026, Rodrigo: «después de firmar los contratos se piden los
       * datos, no antes»).
       *
       * No todos pueden esperar: la FECHA DE NACIMIENTO decide si hace falta el
       * consentimiento del tutor, y sin saberla el consentimiento aparecería a
       * mitad de la firma —que es justo el fallo que se arregló esta mañana—.
       * Por eso lo marca la plantilla campo a campo en vez de ser todo o nada.
       */
      previo: f.previo === true,
      group: texto(f.group) || null,
      placeholder: texto(f.placeholder) || null,
      help: texto(f.help) || null,
      options: Array.isArray(f.options) ? f.options.map(texto).filter(Boolean) : null,
      // Dónde vive este dato en la ficha del cliente ("cliente.taxId",
      // "tutor.dni"…). Lo interpreta `lib/clients/datosFicha.js`; vacío = solo
      // pertenece al acto de firmar (la localidad, la fecha).
      ficha: texto(f.ficha) || null,
    }));
}

/** Normaliza los bloques (documentos a leer y aceptar) de una plantilla. */
export function bloquesDe(plantilla) {
  const raw = Array.isArray(plantilla?.blocks) ? plantilla.blocks : [];
  return raw
    .filter((b) => b && typeof b === "object" && texto(b.id))
    .map((b) => ({
      id: texto(b.id),
      title: texto(b.title) || texto(b.id),
      body: texto(b.body),
      acceptLabel: texto(b.acceptLabel) || `He leído y acepto ${texto(b.title) || "este documento"}.`,
      required: b.required !== false,
    }));
}

/**
 * Vista que se manda al portal. Sin `active` ni fechas: no las necesita.
 *
 * Con `client` delante, cada campo viaja ya RESUELTO: `valor` con lo que hay en
 * la ficha y `desdeFicha` para que la pantalla lo enseñe como dato en firme en
 * vez de como una casilla vacía. Lo que se rellenó antes de firmar no se vuelve
 * a preguntar.
 */
export function serializarPlantilla(plantilla, client = null) {
  if (!plantilla) return null;
  const j = plantilla.toJSON ? plantilla.toJSON() : plantilla;
  const campos = camposDe(j);
  return {
    key: j.key,
    title: j.title,
    intro: j.intro ?? null,
    version: j.version ?? 1,
    fields: campos.map((campo) => {
      const valor = client ? leerDeFicha(client, campo) : "";
      return { ...campo, valor: valor || null, desdeFicha: !!valor };
    }),
    blocks: bloquesDe(j),
    secondSignatureLabel: j.secondSignatureLabel ?? null,
    onlyMinors: !!j.onlyMinors,
  };
}

function validarUno(campo, valor, fechaNacimiento = null) {
  const v = texto(valor).slice(0, MAX[campo.type] ?? MAX.text);

  if (!v) {
    if (campoEsObligatorio(campo, fechaNacimiento)) return { error: `Falta «${campo.label}»` };
    return { valor: null };
  }

  switch (campo.type) {
    case "email":
      if (!EMAIL_RE.test(v)) return { error: `«${campo.label}» no parece un correo válido` };
      return { valor: v.toLowerCase() };

    case "tel":
      if (!TEL_RE.test(v)) return { error: `«${campo.label}» no parece un teléfono válido` };
      return { valor: v };

    case "date": {
      if (!FECHA_RE.test(v)) return { error: `«${campo.label}» tiene que ser una fecha` };
      const d = new Date(`${v}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return { error: `«${campo.label}» no es una fecha real` };
      return { valor: v };
    }

    case "dni": {
      const ok = letraDocumentoCorrecta(v);
      if (ok === false) return { error: `La letra de «${campo.label}» no corresponde. Revísalo, por favor.` };
      return { valor: v.toUpperCase().replace(/[\s-]/g, "") };
    }

    case "select":
      if (campo.options?.length && !campo.options.includes(v)) {
        return { error: `«${campo.label}» no es una opción válida` };
      }
      return { valor: v };

    default:
      return { valor: v };
  }
}

/**
 * Valida lo que manda el portal contra los campos de la plantilla.
 *
 * Devuelve `{ datos }` o `{ error }`. Solo se queda con las claves que la
 * plantilla declara: lo que llegue de más se tira, para que nadie pueda meter
 * campos inventados en un documento firmado.
 */
export function validarDatos(plantilla, entrada, client = null) {
  const campos = camposDe(plantilla);
  const fuente = entrada && typeof entrada === "object" ? entrada : {};
  const datos = {};

  // La edad decide si algún campo es obligatorio (el DNI de los menores de 14).
  // Se busca primero en lo que acaba de escribir la persona y, si no viene, en
  // la ficha: al firmar el consentimiento parental la fecha ya está guardada y
  // el formulario no vuelve a preguntarla.
  const campoFecha = campos.find((c) => c.ficha === "cliente.birthDate");
  const fechaNacimiento =
    (campoFecha ? texto(fuente[campoFecha.key]) : "") ||
    texto(client?.birthDate).slice(0, 10) ||
    null;

  for (const campo of campos) {
    const { valor, error } = validarUno(campo, fuente[campo.key], fechaNacimiento);
    if (error) return { error };
    if (valor != null) datos[campo.key] = valor;
  }
  return { datos };
}

/**
 * Claves por las que se busca la fecha de nacimiento entre los datos
 * declarados. Es lo que decide si hace falta el consentimiento del tutor, así
 * que no puede depender de cómo llame cada plantilla a su campo.
 */
const CLAVES_NACIMIENTO = ["fechaNacimiento", "birthDate", "fnac"];

/** La fecha de nacimiento que declaró la familia al firmar, si ya firmó algo. */
function nacimientoDeclarado(firmas) {
  for (const f of firmas ?? []) {
    const datos = f?.signerData;
    if (!datos || typeof datos !== "object") continue;
    for (const clave of CLAVES_NACIMIENTO) {
      if (datos[clave]) return String(datos[clave]);
    }
  }
  return null;
}

/**
 * Qué documentos le tocan a esta ficha.
 *
 * El consentimiento parental (`onlyMinors`) solo sale si la destinataria es
 * menor de edad. La fecha manda de la FICHA (04/08/2026): se pide antes de
 * empezar a firmar, así que se sabe desde el principio y el consentimiento del
 * tutor aparece en su sitio. Antes salía de lo declarado a mitad del contrato,
 * y hasta que no firmaba el primero no había manera de saberlo.
 *
 * Se conserva lo declarado como respaldo para las firmas anteriores a ese
 * cambio, cuya ficha puede no tener la fecha.
 */
export function documentosQueAplican(plantillas, firmas, client = null) {
  const nacimiento = texto(client?.birthDate).slice(0, 10) || nacimientoDeclarado(firmas);
  return (plantillas ?? []).filter((p) => !p.onlyMinors || (nacimiento && esMenor(nacimiento)));
}

/**
 * Situación del contrato estructurado: qué le queda por firmar a quien ha
 * entrado y si la ficha está ya completa.
 *
 * Vive aquí y no en `lib/citas/portalContract.js` porque no depende de HTTP ni
 * de la sesión del portal —solo de plantillas y firmas—, y así se puede probar
 * sin levantar el servidor.
 *
 * @param plantillas  filas ACTIVAS de ContractTemplate, el contrato principal primero
 * @param firmas      filas de ContractSignature de TODA la ficha
 * @param firmantes   `effectiveSigners(client)`: quién tiene que firmar
 * @param firmante    quién ha entrado (uno de los anteriores), o null
 * @param client      la ficha: de ahí sale la fecha de nacimiento
 */
export function situacionDocumentos({ plantillas, firmas, firmantes, firmante, client = null }) {
  const aplican = documentosQueAplican(plantillas, firmas, client);
  const suyas = (id) =>
    new Set(
      (firmas ?? [])
        .filter((s) => String(s.guardianId ?? s.guardian_id).toLowerCase() === String(id).toLowerCase())
        .map((s) => s.templateKey ?? s.template_key)
    );

  const misFirmas = firmante
    ? (firmas ?? []).filter(
        (f) => String(f.guardianId ?? f.guardian_id).toLowerCase() === String(firmante.id).toLowerCase()
      )
    : [];
  const yaFirmadas = new Set(misFirmas.map((f) => f.templateKey ?? f.template_key));
  const pendientes = aplican.filter((p) => !yaFirmadas.has(p.key));

  // TODOS los firmantes de la ficha tienen que haber firmado TODO lo que les
  // aplica. Con padres separados son dos personas y dos juegos de documentos.
  const leFalta = (firmantes ?? []).filter((f) => {
    const firmado = suyas(f.id);
    return !aplican.every((p) => firmado.has(p.key));
  });

  return {
    aplican,
    misFirmas,
    pendientes,
    siguiente: pendientes[0] ?? null,
    leFalta,
    completo: (firmantes ?? []).length > 0 && leFalta.length === 0,
  };
}

/**
 * Valida las aceptaciones. Exige TODOS los bloques obligatorios: los anexos del
 * contrato se firman de forma independiente, así que aceptar el principal no
 * arrastra a los demás.
 *
 * Devuelve `{ aceptaciones }` con la foto de lo aceptado (id, título y hora),
 * que es lo que se guarda y lo que se imprime en el PDF.
 */
export function validarAceptaciones(plantilla, entrada, momento = new Date()) {
  const bloques = bloquesDe(plantilla);
  const marcados = new Set(
    Array.isArray(entrada) ? entrada.map((x) => texto(x)) : Object.keys(entrada ?? {}).filter((k) => entrada[k])
  );

  const faltan = bloques.filter((b) => b.required && !marcados.has(b.id));
  if (faltan.length) {
    return {
      error:
        faltan.length === 1
          ? `Te falta aceptar «${faltan[0].title}»`
          : `Te falta aceptar: ${faltan.map((b) => `«${b.title}»`).join(", ")}`,
    };
  }

  const acceptedAt = (momento instanceof Date ? momento : new Date()).toISOString();
  return {
    aceptaciones: bloques
      .filter((b) => marcados.has(b.id))
      .map((b) => ({ id: b.id, title: b.title, acceptedAt })),
  };
}
