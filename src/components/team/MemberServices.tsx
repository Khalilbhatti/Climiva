"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, ListChecks, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cardClasses } from "@/components/ui/Card";
import { OptionCard, OptionGroup } from "@/components/ui/OptionCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { useToast } from "@/components/ui/Toast";
import { serviceHref } from "@/config/routes";
import { getAssignedServiceIds } from "@/data/team";
import { BOOKING_METHOD_LABEL, SERVICES, SERVICE_CATEGORIES, formatDuration } from "@/data/services";
import { useMember } from "./MemberWorkspace";
import { useTeam } from "./TeamProvider";

/** Eligibility reads the six canonical Service records by id; nothing about a service is copied here. */
const CATALOG = SERVICES.filter((service) => service.active);
const CATALOG_IDS = CATALOG.map((service) => service.id);

/**
 * Which services this person can be assigned to. It is set by hand by your team; nothing is inferred.
 * "All services" means every active catalog service now and later; "Selected services" is an explicit list.
 */
export function MemberServices() {
  const member = useMember();
  const { setServiceEligibility } = useTeam();
  const { toast } = useToast();

  const savedIds = getAssignedServiceIds(member, CATALOG_IDS);
  const [mode, setMode] = useState(member.serviceMode);
  const [selected, setSelected] = useState<string[]>(savedIds);
  const [query, setQuery] = useState("");

  const first = member.name.split(" ")[0];
  const locked = member.status === "inactive";
  const effective = mode === "all" ? CATALOG_IDS : selected;
  const dirty =
    mode !== member.serviceMode || (mode === "selected" && [...selected].sort().join() !== [...savedIds].sort().join());
  const empty = mode === "selected" && selected.length === 0;

  const needle = query.trim().toLowerCase();
  const shown = CATALOG.filter((service) => `${service.name} ${service.category}`.toLowerCase().includes(needle));
  const groups = SERVICE_CATEGORIES.map((category) => ({
    category,
    services: shown.filter((service) => service.category === category),
  })).filter((group) => group.services.length > 0);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="eligibility" className={cardClasses("lg", "space-y-4")}>
        <div className="flex items-start gap-2.5">
          <ListChecks aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 id="eligibility" className="text-base font-semibold text-ink">
              Service assignment & eligibility
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Define which services {member.name} can be assigned to in Jobs and the Schedule.
            </p>
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-card bg-surface-low p-3 text-xs text-ink-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span className="font-semibold text-ink">Manual control. </span>
            Service eligibility is set by your team. Climvia doesn&rsquo;t assign services automatically.
          </span>
        </p>

        <OptionGroup legend="Assignment mode" className="sm:grid-cols-2">
          <OptionCard
            type="radio"
            name="service-mode"
            title="All services"
            description={`${first} becomes assignable to any active service in your catalog, including ones added later.`}
            checked={mode === "all"}
            disabled={locked}
            onChange={() => setMode("all")}
          />
          <OptionCard
            type="radio"
            name="service-mode"
            title="Selected services"
            description="Restrict assignment to the services chosen below."
            checked={mode === "selected"}
            disabled={locked}
            onChange={() => setMode("selected")}
          />
        </OptionGroup>
      </section>

      <section aria-labelledby="service-list" className={cardClasses("lg", "space-y-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="service-list" className="text-base font-semibold text-ink">
            {mode === "all" ? "All services" : `Selected services (${selected.length} assigned)`}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              wrapperClassName="w-56"
              aria-label="Search services"
              placeholder="Search services..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {mode === "selected" && !locked && (
              <>
                <Button variant="tertiary" size="sm" onClick={() => setSelected(CATALOG_IDS)}>
                  Select all ({CATALOG.length})
                </Button>
                <Button variant="tertiary" size="sm" onClick={() => setSelected([])}>
                  Deselect all
                </Button>
              </>
            )}
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="rounded-card bg-surface-low p-4 text-sm text-ink-muted">No services match your search.</p>
        ) : (
          groups.map((group) => (
            <fieldset key={group.category} className="space-y-2">
              <legend className="mb-1 text-micro font-bold tracking-wider text-ink-muted uppercase">
                {group.category} ({group.services.filter((service) => effective.includes(service.id)).length}/{group.services.length})
              </legend>
              {group.services.map((service) => (
                <div key={service.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={effective.includes(service.id)}
                      disabled={mode === "all" || locked}
                      onChange={() => toggle(service.id)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{service.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {service.category} · {formatDuration(service.durationMinutes)} · {BOOKING_METHOD_LABEL[service.bookingMethod]}
                      </span>
                    </span>
                  </label>
                  <Link
                    href={serviceHref(service.id)}
                    aria-label={`Open ${service.name} in Services`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    Active in catalog
                    <ExternalLink aria-hidden className="size-3.5" />
                  </Link>
                </div>
              ))}
            </fieldset>
          ))
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {effective.length} of {CATALOG.length} services assigned to {member.name}
          {dirty && <span className="ml-2 font-semibold text-ink">· Unsaved changes</span>}
          {empty && <span className="ml-2 font-semibold text-danger">· Select at least one service</span>}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={!dirty}
            onClick={() => {
              setMode(member.serviceMode);
              setSelected(savedIds);
            }}
          >
            Discard
          </Button>
          <Button
            disabled={!dirty || empty || locked}
            onClick={() => {
              setServiceEligibility(member.id, mode, mode === "all" ? [] : selected);
              toast(`Assigned services for ${member.name} saved.`);
            }}
          >
            Save assigned services
          </Button>
        </div>
      </div>
    </div>
  );
}
