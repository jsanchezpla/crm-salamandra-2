/**
 * Construcción del system prompt a partir de la configuración del tenant.
 *
 * En el proyecto Outreach original este prompt estaba escrito a fuego con las
 * dos empresas de Salamandra. Aquí se construye desde `outreach_business_lines`
 * y `outreach_settings`: los criterios de scoring son datos, no código, y cada
 * tenant obtiene su propio analista comercial.
 *
 * La forma del JSON de salida también es dinámica: una clave por línea activa.
 */

function bulletList(items) {
  const list = (items ?? []).filter(Boolean);
  if (list.length === 0) return "  (sin criterios definidos)";
  return list.map((s) => `  - ${s}`).join("\n");
}

function describeLine(line) {
  return `### ${line.name}  [clave JSON: "${line.key}"]
${line.description?.trim() || "(sin descripción)"}

Suben el score:
${bulletList(line.scoringUp)}

Bajan el score:
${bulletList(line.scoringDown)}`;
}

/** Forma exacta que debe devolver el modelo, con una clave por línea. */
function jsonShape(businessLines) {
  const block = '{"score":0,"reason_why":"","necesidades":[],"pitch":"","correo":{"asunto":"","cuerpo":""}}';
  return `{${businessLines.map((l) => `"${l.key}":${block}`).join(",")}}`;
}

/**
 * Instrucciones de redacción del correo cuando el tenant no ha escrito las
 * suyas. Es el texto que estuvo a fuego en el prompt desde el principio: se
 * mantiene palabra por palabra para que a los tenants que no toquen nada no
 * les cambie el correo de un día para otro.
 */
function redaccionPorDefecto(companyName) {
  return `Escríbelo HUMANIZADO, como lo redactaría un comercial real de carne y hueso:
español natural y cercano, frases variadas y con ritmo, un punto de calidez.
EVITA los clichés de venta y el tono robótico ("somos líderes", "no dude en
contactarnos", "en la era digital", adjetivos vacíos). Sé concreto y útil: qué
problema suyo resuelves y qué gana. Longitud breve (4-6 frases). Incluye un CTA
claro y natural (proponer una llamada corta o una videollamada) y cierra con una
firma sencilla del equipo de ${companyName}. El asunto, corto, concreto y sin
sonar a spam (sin MAYÚSCULAS gritonas ni exclamaciones de más).`;
}

/**
 * Instrucciones de redacción cuando el tenant SÍ tiene plantilla propia
 * (Configuración → Cómo se escribe el correo).
 *
 * La plantilla se cita entre marcas para que el modelo no confunda su contenido
 * con el del lead, y se le dice explícitamente que no la copie tal cual: es la
 * forma del correo, no el correo. Sin esa advertencia el modelo devuelve los
 * huecos sin rellenar.
 */
function redaccionSegunPlantilla(emailTemplate) {
  return `Redacta el correo siguiendo la plantilla de la casa que viene abajo.
Respeta el orden de los bloques, el tono, las reglas y la longitud que marca, y
rellena cada hueco con datos REALES de este lead. La plantilla es la forma del
correo, no el correo: no la copies literalmente, no dejes corchetes ni números
de bloque en el texto final, y no menciones que existe.

--- PLANTILLA ---
${emailTemplate.trim()}
--- FIN DE LA PLANTILLA ---`;
}

export function buildSystemPrompt({ companyName, companyContext, businessLines, chainingRule, emailTemplate }) {
  if (!businessLines?.length) {
    throw new Error("No hay líneas de negocio activas: no se puede construir el prompt");
  }

  const contexto = companyContext?.trim()
    ? companyContext.trim()
    : `${companyName} capta clientes para las líneas de negocio descritas abajo.`;

  const encadenamiento = chainingRule?.trim()
    ? `\nRELACIÓN ENTRE LÍNEAS:\n${chainingRule.trim()}\n`
    : "";

  // La plantilla del tenant manda sobre las instrucciones de la casa: si está
  // escrita, es que alguien ha decidido cómo quiere sus correos.
  const redaccion = emailTemplate?.trim()
    ? redaccionSegunPlantilla(emailTemplate)
    : redaccionPorDefecto(companyName);

  return `Eres el analista comercial de ${companyName}.

${contexto}

Recibirás los datos de una empresa (lead). Debes puntuar de 0 a 100 cuánto encaja
como cliente de CADA una de las siguientes líneas de negocio, por separado, y
justificar tu puntuación. Usa los criterios de cada línea como guía, no como
checklist rígido.

## Líneas de negocio

${businessLines.map(describeLine).join("\n\n")}
${encadenamiento}
Para cada línea devuelve: score (0-100), reason_why (por qué llamarles, 1-2
frases), necesidades (lista concreta de carencias que esa línea resuelve), pitch
(propuesta breve de cómo abordarles) y correo (un email de pitch listo para
enviar).

El correo ({asunto, cuerpo}) se redacta a partir del reason_why, las necesidades
y el pitch de ESA línea, PERSONALIZADO a este lead en concreto: usa su nombre, su
sector, su ubicación y las carencias reales detectadas (menciona 1-2 datos
concretos suyos). Nada de plantilla genérica: debe notarse que está escrito para
ELLOS.

${redaccion}

El cuerpo va en texto plano (sin markdown), con saltos de línea normales y
párrafos cortos.

Si un dato no lo tienes, NO lo inventes: puntúa de forma conservadora y dilo en
el reason_why.

Responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto adicional,
con esta forma exacta:
${jsonShape(businessLines)}`;
}

/**
 * Mensaje de usuario con los datos del lead. Nunca estarán todos los campos:
 * se envía lo que hay. `rawData` trae lo que sacó el scraping (redes, reseñas,
 * dependencia de plataformas de terceros...), que es donde vive la señal.
 */
export function buildUserMessage(lead) {
  const datos = {
    nombre: lead.name,
    sector: lead.sector,
    ubicacion: lead.location,
    web: lead.website,
    telefono: lead.phone,
    email: lead.email,
    fuente: lead.source,
    datos_scrapeados: lead.rawData ?? {},
  };

  return `Analiza esta empresa y devuelve el JSON pedido.

Datos del lead:
${JSON.stringify(datos, null, 2)}`;
}
