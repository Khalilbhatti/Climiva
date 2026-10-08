import { ClipboardList, Plus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type ServicesEmptyStateProps = {
  onAdd: () => void;
  /** Restores the standard catalog (the six canonical services). */
  onLoadStarter: () => void;
};

/**
 * Shown when no services are configured: a title, one line of copy and one primary action, plus the
 * approved "load starter services" secondary. Deliberately no feature cards or marketing copy.
 */
export function ServicesEmptyState({ onAdd, onLoadStarter }: ServicesEmptyStateProps) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-card bg-surface-low text-primary">
        <ClipboardList aria-hidden className="size-8" />
      </div>
      <h2 className="text-xl font-bold text-ink">No services configured yet</h2>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        Add the HVAC services your business provides so customers can book online and your team can manage work
        consistently.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={onAdd}>
          <Plus aria-hidden className="size-[18px]" />
          Add service
        </Button>
        <Button size="lg" variant="secondary" onClick={onLoadStarter}>
          <Wand2 aria-hidden className="size-[18px]" />
          Load standard HVAC starter services
        </Button>
      </div>
    </Card>
  );
}
