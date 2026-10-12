import { PreviewRoute } from "@/server/preview-route";

/** The saved Draft's home page, for someone signed in to the business. */
export default async function PreviewHome({ searchParams }: PageProps<"/website/preview">) {
  const { view } = await searchParams;
  return <PreviewRoute segments={[]} view={typeof view === "string" ? view : undefined} />;
}
