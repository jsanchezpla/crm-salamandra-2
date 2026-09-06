import ListaModule from "../../../../modules/mailing/ListaModule.jsx";
import { contextoMailing } from "../_pagina.js";

export const metadata = { title: "Lista · Mailing" };

export default async function ListaPage() {
  const ctx = await contextoMailing();
  return <ListaModule vocab={ctx.vocab} conClientes={ctx.conClientes} />;
}
