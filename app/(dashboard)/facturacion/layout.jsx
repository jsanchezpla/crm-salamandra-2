import { headers } from "next/headers";

import FacturacionNav from "./_components/FacturacionNav.jsx";
import { tieneModuloBanco } from "../../../lib/banco/moduloBanco.js";

/**
 * Layout de Facturación. Servidor desde el 29/08/2026: la pestaña «Banco»
 * depende del submódulo `billing_banco` y un "use client" no puede preguntarlo — el mismo
 * patrón que la página de Configuración. La barra vive en
 * `_components/FacturacionNav.jsx`; la regla del módulo, en
 * `lib/banco/moduloBanco.js` (la comparte con la página de Banco).
 */
export default async function FacturacionLayout({ children }) {
  const headersList = await headers();
  const conBanco = await tieneModuloBanco(headersList.get("x-tenant"));

  return (
    <div className="flex flex-col h-full min-h-0">
      <FacturacionNav conBanco={conBanco} />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
