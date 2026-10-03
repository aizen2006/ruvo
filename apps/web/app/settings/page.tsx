import { SettingsForm } from "@/components/settings/settings-form";

export const metadata = { title: "Settings | RUVO" };

export default function SettingsPage() {
  return (
    <div className="space-y-stack">
      <h1 className="font-dot text-title font-black">Settings</h1>
      <SettingsForm />
    </div>
  );
}
