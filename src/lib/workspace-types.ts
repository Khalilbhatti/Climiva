/**
 * What the browser is told about the signed-in person and their workspace.
 *
 * Plain serializable data, built on the server from verified records and handed to the client providers as props.
 * It contains nothing the person is not entitled to see: their own name and sign-in email, the organizations they are an
 * active member of, and the settings of the one that is active. Never an id the server did not verify.
 */
import type { SettingsData } from "@/data/settings";

export type OrganizationRole = "owner" | "admin" | "member";

export const ROLE_LABEL: Record<OrganizationRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Roles that may change the workspace itself (Business information, hours, preferences). */
export const MANAGER_ROLES: readonly OrganizationRole[] = ["owner", "admin"];
export const canManage = (role: OrganizationRole) => MANAGER_ROLES.includes(role);

/**
 * The transitional switch (see docs/saas-architecture.md): organizations flagged with this value still see the sample
 * content of modules that have not moved to PostgreSQL. Any other organization sees those modules as not yet available.
 */
export const SAMPLE_DATA_SET = "apex-demo";

export type WorkspaceOrganization = { id: string; name: string; slug: string; role: OrganizationRole };

export type WorkspaceSnapshot = {
  user: { id: string; email: string; name: string };
  organization: WorkspaceOrganization & { jobTitle: string | null };
  /** Every organization this person is an active member of, active one included. */
  organizations: WorkspaceOrganization[];
  /** True when this organization is the one flagged with the sample dataset. */
  hasSampleData: boolean;
  /** Whether this person may edit the workspace's settings. */
  canEditSettings: boolean;
  settings: SettingsData;
};
