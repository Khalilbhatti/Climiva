import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** Rendered inside the workspace shell when a record route (customer, service…) doesn't exist. */
export default function WorkspaceNotFound() {
  return (
    <EmptyState
      as="h1"
      icon={SearchX}
      title="We couldn't find that page"
      description="The record may have been removed, or the link may be incorrect."
      action={<ButtonLink href="/">Back to Overview</ButtonLink>}
    />
  );
}
