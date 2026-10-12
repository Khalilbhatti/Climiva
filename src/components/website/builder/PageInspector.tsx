"use client";

import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { pagePath } from "@/data/website";
import { normalizeSlugInput, pageDeleteLock, pageHideLock, pageIn, pageProblems, pageSlugLock } from "@/lib/site-builder";
import { MAX_PAGES } from "@/lib/site-template";
import { useBuilder } from "./BuilderProvider";

const OFF = "Only an owner or admin can change the website.";

/** What a selected page offers: its title, address, visibility and the actions that change the site's page list. */
export function PageInspector({ pageKey }: { pageKey: string }) {
  const b = useBuilder();
  const page = pageIn(b.content, pageKey);
  const [deleting, setDeleting] = useState(false);
  if (!page) return null;

  const index = b.content.pages.findIndex((candidate) => candidate.key === pageKey);
  const problems = pageProblems(b.problems, pageKey);
  const errorOf = (field: string) => problems[field] ?? b.serverFields[`${pageKey}.${field}`];
  const home = page.type === "home";
  const slugLock = pageSlugLock(b.content, pageKey);
  const hideLock = pageHideLock(b.content, pageKey);
  const deleteLock = pageDeleteLock(b.content, pageKey);
  const full = b.content.pages.length >= MAX_PAGES;

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <Input
          label="Page title"
          hint="Shown in the website's menu and as the page's heading in search results."
          value={page.title}
          maxLength={80}
          disabled={b.readOnly}
          error={errorOf("title")}
          onChange={(event) => b.updatePage(pageKey, { title: event.target.value }, `page-title:${pageKey}`)}
          onBlur={b.endEdit}
        />
        <div>
          <Input
            label="Page address"
            hint={slugLock && home ? "The home page is the website's own address." : `${pagePath(page)}`}
            value={page.slug}
            maxLength={80}
            spellCheck={false}
            autoCapitalize="none"
            disabled={b.readOnly || Boolean(slugLock)}
            error={errorOf("slug")}
            onChange={(event) => b.updatePage(pageKey, { slug: normalizeSlugInput(event.target.value) }, `page-slug:${pageKey}`)}
            onBlur={() => {
              // A trailing hyphen is allowed while typing a new word, but is not an address.
              if (page.slug.endsWith("-")) b.updatePage(pageKey, { slug: page.slug.replace(/-+$/, "") }, `page-slug:${pageKey}`);
              b.endEdit();
            }}
          />
          {slugLock && !home && <p className="mt-1 text-xs text-ink-muted">{slugLock}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-btn bg-surface-low px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Show in the website</p>
            <p className="mt-0.5 text-xs text-ink-muted">{hideLock && page.visible ? hideLock : "A hidden page is not on the website or in its menu."}</p>
            {errorOf("visible") && <p className="mt-0.5 text-xs text-danger">{errorOf("visible")}</p>}
          </div>
          <Switch checked={page.visible} label={`Show ${page.title} page`} disabled={b.readOnly || (page.visible && Boolean(hideLock))} onChange={(visible) => b.updatePage(pageKey, { visible })} />
        </div>
        {errorOf("") && <p role="alert" className="text-xs text-danger">{errorOf("")}</p>}
      </div>

      {!b.readOnly ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" variant="secondary" aria-disabled={home || index <= 1 || undefined} title={home ? "The home page stays first." : index <= 1 ? "It is already the first page after Home." : undefined} onClick={() => !home && index > 1 && b.movePageBy(pageKey, -1)}>
            <ArrowUp aria-hidden className="size-3.5" />
            Move up
          </Button>
          <Button size="sm" variant="secondary" aria-disabled={home || index === b.content.pages.length - 1 || undefined} title={home ? "The home page stays first." : index === b.content.pages.length - 1 ? "It is already the last page." : undefined} onClick={() => !home && index < b.content.pages.length - 1 && b.movePageBy(pageKey, 1)}>
            <ArrowDown aria-hidden className="size-3.5" />
            Move down
          </Button>
          <Button size="sm" variant="secondary" aria-disabled={full || undefined} title={full ? `A website has up to ${MAX_PAGES} pages.` : undefined} onClick={() => !full && b.duplicatePage(pageKey)}>
            <Copy aria-hidden className="size-3.5" />
            Duplicate
          </Button>
          <Button size="sm" variant="destructive" aria-disabled={Boolean(deleteLock) || undefined} title={deleteLock} onClick={() => !deleteLock && setDeleting(true)}>
            <Trash2 aria-hidden className="size-3.5" />
            Delete page
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">{OFF}</p>
      )}
      {deleteLock && !b.readOnly && deleteLock !== hideLock && <p className="text-xs text-ink-muted">{deleteLock}</p>}

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete the ${page.title} page?`}
        description="The page and its sections are removed from the Draft. The published website keeps the page until you publish, and Undo brings it back before you save."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              onClick={() => {
                setDeleting(false);
                b.removePage(pageKey);
              }}
            >
              Delete page
            </Button>
          </>
        }
      />
    </div>
  );
}
