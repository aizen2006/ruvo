import { Tabs as RadixTabs } from "radix-ui";

/** Underlined tabs on a single hairline; the active tab is marked in ink. Keyboard navigation comes from Radix. */
export function TabList({ tabs }: { tabs: Array<{ value: string; label: string; hint?: string }> }) {
  return (
    <RadixTabs.List className="flex gap-group overflow-x-auto border-b border-hairline">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className="-mb-px border-b-2 border-transparent py-2.5 text-small whitespace-nowrap text-graphite hover:text-ink data-[state=active]:border-ink data-[state=active]:font-medium data-[state=active]:text-ink"
        >
          {tab.label}
          {tab.hint && <span className="ml-1.5 text-pencil">{tab.hint}</span>}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export const Tabs = RadixTabs.Root;
export const TabPanel = RadixTabs.Content;
