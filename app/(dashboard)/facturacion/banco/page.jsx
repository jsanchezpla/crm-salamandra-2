import { headers } from "next/headers";
import { notFound } from "next/navigation";

import BancoModule from "./BancoModule.jsx";
import { tieneModuloBanco } from "../../../../lib/banco/moduloBanco.js";

export const metadata = { title: "Banco" };

/**
 * /facturacion/banco — el extracto real del banco y la conciliación.
 *
 * Segunda de las tres puertas del módulo `banco` (la pestaña la esconde el
 * layout, los endpoints comprueban hasModule): sin módulo, esta URL escrita a
 * mano responde 404, como /clientes/urgentes.
 */
export default async function BancoPage() {
  const headersList = await headers();
  if (!(await tieneModuloBanco(headersList.get("x-tenant")))) notFound();
  return <BancoModule />;
}
