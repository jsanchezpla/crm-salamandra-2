import { headers } from "next/headers";
import AbarcaIAReferidosModule from "../../../modules/overrides/quality-energy/ReferidosModule.jsx";

export const metadata = { title: "Referidos AbarcaIA" };

export default async function ReferidosPage() {
  // Solo quality-energy usa este módulo — si en el futuro otro tenant
  // necesita vista propia, añadir override aquí igual que en leads/page.jsx
  const headersList = await headers();
  void headersList.get("x-tenant"); // disponible por si se necesita en el futuro

  return <AbarcaIAReferidosModule />;
}
