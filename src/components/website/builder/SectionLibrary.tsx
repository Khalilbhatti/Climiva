"use client";

import { Modal } from "@/components/ui/Modal";
import { SECTION_CATEGORIES, SECTION_LIBRARY } from "@/lib/site-sections";
import { useBuilder } from "./BuilderProvider";

/** The Section library: every registered kind of section, by group. A section can only be added from here, so only a registered kind can be. */
export function SectionLibrary() {
  const b = useBuilder();
  const page = b.page;

  return (
    <Modal
      open={b.libraryOpen}
      onClose={() => b.setLibraryOpen(false)}
      size="xl"
      title="Add a section"
      description={page ? `Choose a section to add to the ${page.title} page. It starts with plain starter text you can change.` : "Choose a section to add."}
    >
      <div className="space-y-6">
        {SECTION_CATEGORIES.map((category) => {
          const entries = SECTION_LIBRARY.filter((entry) => entry.category === category.id);
          if (entries.length === 0) return null;
          return (
            <section key={category.id} aria-labelledby={`library-${category.id}`}>
              <h3 id={`library-${category.id}`} className="mb-2 text-xs font-bold tracking-wider text-ink-muted uppercase">
                {category.label}
              </h3>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {entries.map((entry) => (
                  <li key={`${entry.type}-${entry.variant}`}>
                    <button
                      type="button"
                      onClick={() => {
                        b.addSection(entry.type, entry.variant);
                        b.setLibraryOpen(false);
                      }}
                      className="flex h-full w-full flex-col rounded-card border border-line bg-surface p-3 text-left transition-colors hover:border-primary hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="text-sm font-semibold text-ink">{entry.label}</span>
                      <span className="mt-0.5 text-xs text-ink-muted">{entry.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
