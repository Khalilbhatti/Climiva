import { PageHeader } from "@/components/ui/PageHeader";
import { TabNav } from "@/components/ui/TabNav";

/** Settings: one header and one set of section tabs; each section is its own route. */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <PageHeader title="Settings" description="Manage your business information and workspace preferences." />
      <TabNav
        label="Settings sections"
        items={[
          { label: "Business information", href: "/settings" },
          { label: "Business hours", href: "/settings/hours" },
          { label: "Branding", href: "/settings/branding" },
          { label: "Workspace preferences", href: "/settings/preferences" },
          { label: "My profile", href: "/settings/profile" },
        ]}
      />
      {children}
    </>
  );
}
