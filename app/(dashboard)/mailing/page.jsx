import MailingModule from "../../../modules/mailing/MailingModule.jsx";
import { contextoMailing } from "./_pagina.js";

export const metadata = { title: "Mailing" };

export default async function MailingPage() {
  const ctx = await contextoMailing();
  return <MailingModule vocab={ctx.vocab} />;
}
