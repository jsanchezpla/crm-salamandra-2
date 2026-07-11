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

export function buildSystemPrompt({ companyName, companyContext, businessLines, chainingRule }) {
  if (!businessLines?.length) {
    throw new Error("No hay líneas de negocio activas: no se puede construir el prompt");
  }

  const contexto = companyContext?.trim()
    ? companyContext.trim()
    : `${companyName} capta clientes para las líneas de negocio descritas abajo.`;

  const encadenamiento = chainingRule?.trim()
    ? `\nRELACIÓN ENTRE LÍNEAS:\n${chainingRule.trim()}\n`
    : "";

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

Escríbelo HUMANIZADO, como lo redactaría un comercial real de carne y hueso:
español natural y cercano, frases variadas y con ritmo, un punto de calidez.
EVITA los clichés de venta y el tono robótico ("somos líderes", "no dude en
contactarnos", "en la era digital", adjetivos vacíos). Sé concreto y útil: qué
problema suyo resuelves y qué gana. Longitud breve (4-6 frases). Incluye un CTA
claro y natural (proponer una llamada corta o una videollamada) y cierra con una
firma sencilla del equipo de ${companyName}. El cuerpo va en texto plano (sin
markdown), con saltos de línea normales y párrafos cortos. El asunto, corto,
concreto y sin sonar a spam (sin MAYÚSCULAS gritonas ni exclamaciones de más).

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
