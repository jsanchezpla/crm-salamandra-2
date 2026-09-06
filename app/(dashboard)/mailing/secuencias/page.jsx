import SecuenciasModule from "../../../../modules/mailing/SecuenciasModule.jsx";
import { contextoMailing } from "../_pagina.js";

export const metadata = { title: "Secuencias · Mailing" };

export default async function SecuenciasPage() {
  const ctx = await contextoMailing();
  return <SecuenciasModule vocab={ctx.vocab} conClientes={ctx.conClientes} conCitas={ctx.conCitas} />;
}
