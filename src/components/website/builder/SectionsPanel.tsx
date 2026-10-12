"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, Layers, Link2, Plus } from "lucide-react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { connectedOf, variantLabel } from "@/lib/site-sections";
import type { ContentSection } from "@/lib/site-template";
import { useBuilder } from "./BuilderProvider";
import { useSectionActions } from "./section-actions";

function SectionRow({ pageKey, section }: { pageKey: string; section: ContentSection }) {
  const b = useBuilder();
  const actions = useSectionActions(pageKey, section.key);
  const selected = b.selection.kind === "section" && b.selection.page === pageKey && b.selection.section === section.key;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.key, disabled: b.readOnly });
  const connected = connectedOf(section.type, section.variant);

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("relative", isDragging && "z-10 opacity-80")} data-testid={`builder-section-${section.key}`}>
      <div className={cn("flex items-center gap-1 rounded-btn pr-1 transition-colors", selected ? "bg-primary-subtle ring-1 ring-primary ring-inset" : "hover:bg-surface-low", isDragging && "bg-surface shadow-overlay")}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={b.readOnly}
          aria-label={`Reorder ${section.label} section`}
          className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-btn text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-30"
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => b.select({ kind: "section", page: pageKey, section: section.key })}
          aria-current={selected ? "true" : undefined}
          data-testid="section-select"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-btn py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-medium", section.visible ? "text-ink" : "text-ink-muted line-through decoration-ink-faint")}>{section.label}</span>
            <span className="block truncate text-xs text-ink-muted">
              {variantLabel(section.type, section.variant)}
              {connected ? " · Connected" : ""}
            </span>
          </span>
          {!section.visible && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">
              <EyeOff aria-hidden className="size-3" />
              Hidden
            </span>
          )}
          {connected && section.visible && <Link2 aria-hidden className="size-3.5 shrink-0 text-ink-muted" />}
        </button>
        <ActionMenu label={`Actions for ${section.label} section`} actions={actions} />
      </div>
    </li>
  );
}

/** The section navigator: the selected page's sections in order, each selectable, reorderable by drag or by Move up / Move down, and with its actions. */
export function SectionsPanel() {
  const b = useBuilder();
  const page = b.page;
  const sections = page?.sections ?? [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const nameOf = (id: string | number) => sections.find((section) => section.key === id)?.label ?? "Section";
  const positionOf = (id: string | number) => sections.findIndex((section) => section.key === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up the ${nameOf(active.id)} section. It is number ${positionOf(active.id)} of ${sections.length}.`,
    // Picking a section up reports it over itself first; saying so would replace "Picked up" before it was heard.
    onDragOver: ({ active, over }) => (over && over.id !== active.id ? `The ${nameOf(active.id)} section is over position ${positionOf(over.id)} of ${sections.length}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `The ${nameOf(active.id)} section was dropped at position ${positionOf(over.id)} of ${sections.length}.` : `The ${nameOf(active.id)} section was dropped where it started.`),
    onDragCancel: ({ active }) => `Reordering cancelled. The ${nameOf(active.id)} section is back where it was.`,
  };

  function onDragEnd(event: DragEndEvent) {
    if (!page || !event.over || event.active.id === event.over.id) return;
    const to = sections.findIndex((section) => section.key === event.over!.id);
    if (to !== -1) b.moveSectionTo(page.key, String(event.active.id), to);
  }

  return (
    <section aria-labelledby="builder-sections-heading" className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 id="builder-sections-heading" className="text-sm font-semibold text-ink">
            Sections
          </h2>
          <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs font-semibold text-ink-muted">{sections.length}</span>
        </div>
        {!b.readOnly && (
          <Button size="sm" variant="secondary" onClick={() => b.setLibraryOpen(true)} disabled={!page} aria-haspopup="dialog">
            <Plus aria-hidden className="size-3.5" />
            Add section
          </Button>
        )}
      </div>

      {page && sections.length > 0 ? (
        <DndContext
          // A fixed id: the ids the library writes for the handles' descriptions must be the same on the server and in the browser.
          id="builder-section-order"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: "To reorder, press Space on the handle, move with the up and down arrow keys, then press Space again to drop. Escape cancels. You can also use Move up and Move down in the section's menu." },
          }}
        >
          <SortableContext items={sections.map((section) => section.key)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5 p-2">
              {sections.map((section) => (
                <SectionRow key={section.key} pageKey={page.key} section={section} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <Layers aria-hidden className="size-6 text-ink-faint" />
          <p className="mt-2 text-sm font-medium text-ink">This page has no sections yet</p>
          <p className="mt-1 text-xs text-ink-muted">{b.readOnly ? "An owner or admin can add sections." : "Add a section to start building the page."}</p>
        </div>
      )}
    </section>
  );
}
