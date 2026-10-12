"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { pageIn, sectionIn, sectionLock, sectionProblems } from "@/lib/site-builder";
import { SECTION_LABEL_MAX, SECTION_REGISTRY, connectedOf, fieldLabel, fieldsOf, switchVariantProps, variantDescription, variantLabel, type ConnectedSource } from "@/lib/site-sections";
import { FieldControl } from "./FieldControl";
import { ServiceControls } from "./ServiceControls";
import { useBuilder } from "./BuilderProvider";
import { useSectionActions } from "./section-actions";

const CONNECTED_COPY: Record<ConnectedSource, { text: string; link: string; href: "/settings" | "/settings/hours" | "/services" }> = {
  services: { text: "Services come directly from your Service catalog. Their name, price, duration and booking method are managed there.", link: "Manage Services", href: "/services" },
  "business-info": { text: "Managed in Business Settings. It is shown from your business information, so there is nothing to retype here.", link: "Business information", href: "/settings" },
  "business-hours": { text: "Managed in Business Settings. It is shown from your business hours, so there is nothing to retype here.", link: "Business hours", href: "/settings/hours" },
  booking: { text: "Each Service sets how customers book it: instantly, by appointment request, or by quote request. Managed in Services.", link: "Manage Services", href: "/services" },
};

/** What a selected section offers: its name, whether it shows, its style, the text its style declares, and its actions. */
export function SectionInspector({ pageKey, sectionKey }: { pageKey: string; sectionKey: string }) {
  const b = useBuilder();
  const page = pageIn(b.content, pageKey);
  const section = sectionIn(b.content, pageKey, sectionKey);
  const actions = useSectionActions(pageKey, sectionKey);
  const [switching, setSwitching] = useState<{ variant: string; dropped: string[] } | null>(null);
  if (!page || !section) return null;

  const def = SECTION_REGISTRY[section.type];
  const fields = fieldsOf(section.type, section.variant);
  const connected = connectedOf(section.type, section.variant);
  const problems = sectionProblems(b.problems, pageKey, sectionKey);
  const errorOf = (field: string) => problems[field] ?? b.serverFields[`${pageKey}.${sectionKey}.${field}`];
  const lock = sectionLock(b.content, pageKey, sectionKey);
  const hasText = fields.some((field) => field.kind !== "align");

  function chooseVariant(variant: string) {
    if (!section || variant === section.variant) return;
    const next = switchVariantProps(section.type, section.variant, variant, section.props);
    if (next.dropped.length > 0) setSwitching({ variant, dropped: next.dropped });
    else b.changeVariant(pageKey, sectionKey, variant);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <Input
          label="Section name"
          hint="Shown in the section list. Visitors never see it."
          value={section.label}
          maxLength={SECTION_LABEL_MAX}
          disabled={b.readOnly}
          error={errorOf("label")}
          onChange={(event) => b.setLabel(pageKey, sectionKey, event.target.value)}
          onBlur={b.endEdit}
        />
        <div className="flex items-center justify-between gap-3 rounded-btn bg-surface-low px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Show on the website</p>
            {lock && section.visible && <p className="mt-0.5 text-xs text-ink-muted">{lock}</p>}
          </div>
          <Switch checked={section.visible} label={`Show ${section.label} section`} disabled={b.readOnly || (section.visible && Boolean(lock))} onChange={(visible) => b.setVisible(pageKey, sectionKey, visible)} />
        </div>
        {def.variants.length > 1 && (
          <div>
            <Select label="Style" value={section.variant} disabled={b.readOnly} onChange={(event) => chooseVariant(event.target.value)}>
              {def.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variantLabel(section.type, variant.id)}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-muted">{variantDescription(section.type, section.variant)}</p>
          </div>
        )}
      </div>

      {connected && (
        <div className="rounded-btn bg-surface-low p-3">
          <p className="text-xs text-ink-muted">{CONNECTED_COPY[connected].text}</p>
          <Link href={CONNECTED_COPY[connected].href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {CONNECTED_COPY[connected].link}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      )}

      {section.type === "service_list" && <ServiceControls />}

      {section.type === "contact_form" && (
        <p className="rounded-btn bg-warning-soft px-3 py-2 text-xs text-warning">
          Messages sent from this form are not delivered yet. On your public website it tells visitors to call or email you instead. You can change its wording here.
        </p>
      )}

      {fields.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold tracking-wider text-ink-muted uppercase">Text</h3>
          {fields.map((field) => (
            <FieldControl
              key={`${section.key}-${section.variant}-${field.key}`}
              field={field}
              label={fieldLabel(section.type, section.variant, field)}
              idBase={`${pageKey}-${section.key}`}
              value={section.props[field.key] ?? ""}
              error={errorOf(field.key)}
              disabled={b.readOnly}
              onChange={(value) => b.setProp(pageKey, sectionKey, field.key, value)}
              onBlur={b.endEdit}
            />
          ))}
          {hasText && !b.readOnly && (
            <p className="text-xs text-ink-muted">
              Use {"{{business.name}}"} and {"{{business.location}}"} to insert your business name and place, so the text follows them.
            </p>
          )}
        </div>
      )}
      {fields.length === 0 && !connected && section.type !== "service_list" && <p className="text-xs text-ink-muted">This section has no text of its own.</p>}

      {!b.readOnly && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {actions
            .filter((action) => action.id !== "hide" && action.id !== "show")
            .map((action) => (
              <Button
                key={action.id}
                variant={action.destructive ? "destructive" : "secondary"}
                size="sm"
                aria-disabled={action.disabled || undefined}
                title={action.disabled ? action.reason : undefined}
                onClick={() => {
                  if (!action.disabled) action.onSelect();
                }}
              >
                {action.icon && <action.icon aria-hidden className="size-3.5" />}
                {action.label}
              </Button>
            ))}
        </div>
      )}
      {b.readOnly && <p className="text-xs text-ink-muted">You can look at this section. Only an owner or admin can change it.</p>}

      <Modal
        open={switching !== null}
        onClose={() => setSwitching(null)}
        title={`Change to ${switching ? variantLabel(section.type, switching.variant) : ""}?`}
        description="This style has no place for some of the text you wrote. That text is removed from the section. Undo brings it back before you save."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSwitching(null)}>
              Keep the current style
            </Button>
            <Button
              onClick={() => {
                if (switching) b.changeVariant(pageKey, sectionKey, switching.variant);
                setSwitching(null);
              }}
            >
              Change style
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          {switching?.dropped.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
