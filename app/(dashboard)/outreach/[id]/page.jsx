import OutreachLeadDetail from "../../../../modules/outreach/OutreachLeadDetail.jsx";

export const metadata = { title: "Ficha del lead · Captación" };

export default async function OutreachLeadPage({ params }) {
  const { id } = await params;
  return <OutreachLeadDetail leadId={id} />;
}
