import type { Metadata } from "next";
import { Activity, Database, HardDrive, ScrollText } from "lucide-react";
import { formatInstant, groupDigits } from "@/components/platform-admin/format";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/Table";
import { platformAuditRecent, platformSystem } from "@/db/platform-queries";
import { isProductionDeployment } from "@/lib/deployment";
import { checkReadiness, deployedVersion } from "@/server/readiness";
import { requirePlatformAdmin } from "@/server/platform-admin";
import { configuredDriver } from "@/storage";

export const metadata: Metadata = { title: "System" };
export const dynamic = "force-dynamic";

const COUNT_LABELS: Record<string, string> = {
  organizations: "Organizations",
  users: "Users",
  liveSessions: "Live sessions",
  memberships: "Memberships",
  sites: "Sites",
  publishedSites: "Published sites",
  activeDomains: "Active custom domains",
  readyAssets: "Stored files (ready)",
  listings: "Marketplace listings",
  suspendedListings: "Suspended listings",
  bookings: "Bookings",
  reviews: "Reviews",
  platformAdministrators: "Platform administrators",
  auditEvents: "Audit entries",
};

const ACTION_LABELS: Record<string, string> = {
  "platform_admin.granted": "Platform administrator granted",
  "platform_admin.revoked": "Platform administrator revoked",
  "marketplace_listing.suspended": "Listing suspended",
  "marketplace_listing.unsuspended": "Listing allowed again",
  "marketplace_listing.message_updated": "Message to the business changed",
  "marketplace_listing.review_requested": "Business asked for a suspension to be reviewed",
  "marketplace_listing.review_resolved": "Suspension review answered",
  "review.hidden": "Review hidden from the Marketplace",
  "review.restored": "Review restored to the Marketplace",
};

const TARGET_KINDS: Record<string, string> = { user: "Person", marketplace_listing: "Listing", review: "Review" };

function storageDriver(): string {
  try {
    return configuredDriver();
  } catch {
    return "not configured";
  }
}

/**
 * Safe operational facts only: which build is running, which environment, whether the application can serve, the storage driver's NAME, the database
 * server's version, and counts. It reads no setting's value, no connection string, no key, no token and no path: it is a diagnostic, not a viewer for secrets.
 */
export default async function PlatformSystemPage() {
  const admin = await requirePlatformAdmin();
  const [readiness, system, audit] = await Promise.all([checkReadiness(), platformSystem(admin.id), platformAuditRecent(admin.id, 20)]);
  const check = (answer: "ok" | "fail") => <StatusBadge tone={answer === "ok" ? "positive" : "danger"}>{answer === "ok" ? "OK" : "Failing"}</StatusBadge>;

  return (
    <>
      <PageHeader title="System" description="What is running and whether it is healthy. This page shows no secrets." />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Application" icon={Activity}>
          <KeyValueList
            items={[
              { label: "Build", value: deployedVersion() },
              { label: "Environment", value: isProductionDeployment() ? "Production deployment" : "Not a production deployment" },
              { label: "Ready to serve", value: check(readiness.ready ? "ok" : "fail") },
              { label: "Configuration", value: check(readiness.checks.config) },
              { label: "Database", value: check(readiness.checks.database) },
              { label: "File storage", value: check(readiness.checks.storage) },
            ]}
          />
        </SectionCard>

        <SectionCard title="Database and storage" icon={Database}>
          <KeyValueList
            items={[
              { label: "Database server", value: `PostgreSQL ${system.databaseVersion}` },
              { label: "Migrations applied", value: system.migrationsApplied ?? "unknown" },
              { label: "Asset storage driver", value: storageDriver() },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard title="Diagnostic counts" description="Totals across every business, read now." icon={HardDrive}>
        <KeyValueList layout="tiles" className="sm:grid-cols-3 lg:grid-cols-4" items={Object.entries(system.counts).map(([name, value]) => ({ label: COUNT_LABELS[name] ?? name, value: groupDigits(value) }))} />
      </SectionCard>

      <SectionCard title="Recent platform activity" description="Granting and revoking platform access, suspending or allowing listings, answering a business's request to review a suspension, and hiding or restoring reviews. The trail is append-only." icon={ScrollText}>
        {audit.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing has been recorded yet.</p>
        ) : (
          <Table aria-label="Recent platform activity">
            <TableHead>
              <tr>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>What</TableHeaderCell>
                <TableHeaderCell>By</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {audit.map((entry) => (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-ink-muted">{formatInstant(entry.occurredAt)}</TableCell>
                  <TableCell>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                    <p className="text-xs text-ink-muted">
                      {TARGET_KINDS[entry.targetKind] ?? "Item"}{" "}
                      {typeof entry.metadata.email === "string"
                        ? entry.metadata.email
                        : typeof entry.metadata.publicSlug === "string"
                          ? entry.metadata.publicSlug
                          : typeof entry.metadata.reviewSlug === "string"
                            ? entry.metadata.reviewSlug
                            : entry.targetId}
                    </p>
                  </TableCell>
                  <TableCell>{entry.actorLabel}</TableCell>
                  <TableCell className="max-w-xs text-ink-muted">{entry.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
