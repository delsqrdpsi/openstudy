import { PrintView } from "./PrintView";

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintView id={id} />;
}
