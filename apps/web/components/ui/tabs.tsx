import { Tabs as RadixTabs } from "radix-ui";

/** Underlined tabs on a single rule; keyboard navigation comes from Radix. */
export function TabList({ tabs }: { tabs: Array<{ value: string; label: string; hint?: string }> }) {
  return (
    <RadixTabs.List className="flex gap-6 overflow-x-auto border-b border-rule">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className="-mb-px border-b-2 border-transparent py-2.5 text-sm whitespace-nowrap text-muted hover:text-ink data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-ink"
        >
          {tab.label}
          {tab.hint && <span className="ml-1.5 text-faint">{tab.hint}</span>}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export const Tabs = RadixTabs.Root;
export const TabPanel = RadixTabs.Content;
