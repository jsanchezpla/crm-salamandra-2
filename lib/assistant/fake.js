/**
 * Respuesta SIMULADA del Salamandrobot (demo/dev, sin gastar API ni necesitar clave).
 * Compone una respuesta útil a partir de la base de conocimiento y de los clientes
 * encontrados, para poder enseñar el flujo. Nunca se usa en producción (ver answer.js).
 */
export function fakeAnswer({ query, relevant, clients }) {
  const parts = [];
  parts.push("🦎 (respuesta simulada) ¡Hola! Soy Salamandrobot.");

  if (clients && clients.length) {
    const list = clients.slice(0, 3).map((c) => `«${c.name}»`).join(", ");
    parts.push(`He encontrado ${clients.length > 3 ? "varios clientes, entre ellos" : "esto"}: ${list}. Ábrelos desde los enlaces de abajo.`);
  }

  if (relevant && relevant.length) {
    const top = relevant[0];
    parts.push(`Sobre "${query.trim()}": ${top.help}`);
    if (relevant.length > 1) {
      parts.push(`También te puede servir: ${relevant.slice(1, 3).map((r) => r.title).join(", ")}.`);
    }
  } else if (!clients?.length) {
    parts.push("Puedo ayudarte a encontrar clientes, facturas, citas o pacientes, y a saber dónde está cada cosa del CRM. Prueba: «busca el cliente Pedro» o «cómo hago una factura».");
  }

  return parts.join(" ");
}
