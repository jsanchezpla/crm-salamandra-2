import { headers } from "next/headers";

import AyudaModule from "../../../modules/buzon/AyudaModule.jsx";

/**
 * /ayuda — la línea directa del cliente con NOSOTROS.
 *
 * No lleva `moduleKey` ni comprobación de módulo, igual que su endpoint: si
 * avisarnos dependiera de tener algo contratado, al que se le olvidara
 * activárselo se le quedaría el CRM sin forma de decirnos que algo va mal.
 *
 * ⚠️ NO ES LA MISMA PANTALLA QUE `/soporte`. Aquella es el helpdesk del cliente
 * hacia SUS clientes (módulo `support`); esta va del cliente hacia Salamandra.
 * Que se parezcan es justo el motivo de que se llamen distinto y de que el pie
 * del sidebar tenga dos iconos separados.
 *
 * `esDemo` se resuelve AQUÍ, en el servidor, y no esperando a la respuesta del
 * endpoint: si no, el visitante de la demo vería el formulario un instante,
 * empezaría a escribir y se encontraría con un 403 al enviar.
 */
export const metadata = { title: "Ayuda" };

export default async function AyudaPage() {
  const headersList = await headers();
  const esDemo = headersList.get("x-tenant") === "demo";
  return <AyudaModule esDemo={esDemo} />;
}
