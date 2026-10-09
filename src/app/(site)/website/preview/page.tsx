import { PublicPage } from "@/components/website/preview/PublicPage";
import { publicGate } from "@/server/fixture-gate";

export default async function PreviewHomePage() {
  const gate = await publicGate();
  if (gate) return gate;
  return <PublicPage page="home" />;
}
