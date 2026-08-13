import { headers } from "next/headers";

import AyudaModule from "../../../modules/buzon/AyudaModule.jsx";
import { esSlugDemo } from "../../../lib/demo/demos.js";

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
 *
 * ⚠️ Y SE PREGUNTA CON `esSlugDemo`, NO COMPARANDO CON "demo". Aquí ponía
 * `x-tenant === "demo"`, que era verdad hasta que la demo se partió en una por
 * oficio (13/08/2026): desde entonces el visitante de `demo_clinica`,
 * `demo_nutricion` o `demo_agencia` SÍ veía el formulario, lo rellenaba entero y
 * se comía el 403 de `/api/ayuda` al darle a enviar — porque el endpoint sí
 * usaba el helper. Es exactamente el error que este comentario decía evitar,
 * escrito de la única forma que se desincroniza sola.
 */
export const metadata = { title: "Ayuda" };

export default async function AyudaPage() {
  const headersList = await headers();
  const esDemo = esSlugDemo(headersList.get("x-tenant"));
  return <AyudaModule esDemo={esDemo} />;
}
