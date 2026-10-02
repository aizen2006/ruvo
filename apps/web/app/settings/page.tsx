import { AiAccountSection } from "@/components/settings/ai-account";

export const metadata = { title: "Settings | RUVO" };

export default function SettingsPage() {
  return (
    <div className="space-y-stack">
      <h1 className="font-dot text-title font-black">Settings</h1>
      <AiAccountSection />
    </div>
  );
}
