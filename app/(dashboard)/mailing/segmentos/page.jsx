import SegmentosModule from "../../../../modules/mailing/SegmentosModule.jsx";
import { contextoMailing } from "../_pagina.js";

export const metadata = { title: "Segmentos · Mailing" };

export default async function SegmentosPage() {
  const ctx = await contextoMailing();
  return <SegmentosModule vocab={ctx.vocab} conClientes={ctx.conClientes} conCitas={ctx.conCitas} />;
}
