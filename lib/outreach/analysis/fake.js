/**
 * Proveedor FALSO para desarrollo local.
 *
 * Permite recorrer todo el flujo de análisis (prompt → respuesta → parseo →
 * persistencia → UI) sin `ANTHROPIC_API_KEY` y sin gastar una llamada de API.
 * Genera un JSON con la forma exacta que pide el prompt, con scores
 * deterministas derivados del nombre del lead.
 *
 * Se activa con OUTREACH_FAKE_AI=1 y **está prohibido en producción**
 * (ver index.js). Los análisis que produce quedan marcados con model="fake"
 * en la BD, para que nadie los confunda con un análisis real.
 */

/** Hash estable pequeño: mismo lead + misma línea → mismo score siempre. */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export async function complete({ user, businessLines }) {
  let lead = {};
  try {
    const json = user.slice(user.indexOf("{"));
    lead = JSON.parse(json);
  } catch {
    lead = { nombre: "Empresa" };
  }
  const name = lead.nombre ?? "Empresa";
  const sector = lead.sector ?? "su sector";
  const location = lead.ubicacion ?? "su zona";

  const out = {};
  for (const line of businessLines) {
    const score = hash(name + line.key) % 101;
    out[line.key] = {
      score,
      reason_why: `[SIMULADO] ${name} encaja con ${line.name} por su perfil en ${sector}.`,
      necesidades: [`[SIMULADO] Carencia detectada en ${sector}`, "[SIMULADO] Segunda carencia"],
      pitch: `[SIMULADO] Abordarles por su situación en ${location}.`,
      correo: {
        asunto: `[SIMULADO] Una idea para ${name}`,
        cuerpo: `Hola,\n\nEste correo es SIMULADO: no lo ha escrito la IA.\n\nSe genera con OUTREACH_FAKE_AI=1 para poder probar el flujo sin gastar API.\n\nUn saludo,\nEl equipo`,
      },
    };
  }

  return JSON.stringify(out);
}
