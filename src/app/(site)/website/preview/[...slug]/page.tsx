import { PreviewRoute } from "@/server/preview-route";

/** Any other page of the saved Draft, or one Service's booking journey, for someone signed in to the business. */
export default async function PreviewPageRoute({ params, searchParams }: PageProps<"/website/preview/[...slug]">) {
  const { slug } = await params;
  const { view } = await searchParams;
  return <PreviewRoute segments={slug} view={typeof view === "string" ? view : undefined} />;
}
