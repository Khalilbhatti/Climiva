import "server-only";
import type { GalleryTemplate } from "@/components/website/templates/types";
import { findTemplateRecord } from "@/db/site-templates";
import { listActiveTemplates } from "@/db/site-queries";
import { withTenant } from "@/db/tenant";
import type { WorkspaceContext } from "./workspace";

/**
 * The application's website Templates, for the Template Gallery and the Template preview: the ACTIVE ones, validated, in the order the
 * application lists them, with the display metadata (style and tags) the application gives each.
 *
 * Templates are application-owned product content, not tenant data: the same four for every business, with no organization in them. They
 * are read through the verified caller's own tenant transaction like any other read (the runtime role can SELECT an active Template and
 * nothing more), and what is returned is plain data for the page to hand to the browser. No Draft, Customer, Job or other private record
 * is read here: a preview is drawn with the demonstration business (data/template-demo), never with anyone's records.
 */
export async function getTemplateGallery(context: Pick<WorkspaceContext, "userId" | "organizationId">): Promise<GalleryTemplate[]> {
  const active = await withTenant({ userId: context.userId, organizationId: context.organizationId }, (tx) => listActiveTemplates(tx));
  return active.map((template) => {
    const record = findTemplateRecord(template.key);
    return {
      key: template.key,
      name: template.name,
      description: template.description,
      style: record?.style ?? "",
      tags: record?.tags ?? [],
      content: template.definition,
    };
  });
}
