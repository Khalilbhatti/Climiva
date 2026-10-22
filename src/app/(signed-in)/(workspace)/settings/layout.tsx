import { SettingsNav } from "@/components/settings/SettingsNav";
import { PageHeader } from "@/components/ui/PageHeader";

/** Settings: one header, the grouped list of what can be set, and the section chosen (each section is its own route). */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <PageHeader title="Settings" description="Manage your business information and workspace preferences." />
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <SettingsNav />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </>
  );
}
