import BajasModule from "../../../../modules/mailing/BajasModule.jsx";
import { contextoMailing } from "../_pagina.js";

export const metadata = { title: "Bajas · Mailing" };

export default async function BajasPage() {
  await contextoMailing();
  return <BajasModule />;
}
