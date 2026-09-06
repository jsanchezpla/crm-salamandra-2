import CampanaEditor from "../../../../modules/mailing/CampanaEditor.jsx";
import { contextoMailing } from "../_pagina.js";

export const metadata = { title: "Campaña · Mailing" };

export default async function CampanaPage({ params }) {
  const ctx = await contextoMailing();
  const { id } = await params;
  return <CampanaEditor id={id} vocab={ctx.vocab} />;
}
