import { Tabs as RadixTabs } from "radix-ui";

/** Mono tabs on a single hairline; the active tab sits on a 2px ink underline. Keyboard navigation comes from Radix. */
export function TabList({ tabs }: { tabs: Array<{ value: string; label: string; hint?: string }> }) {
  return (
    <RadixTabs.List className="flex gap-group overflow-x-auto border-b border-hairline-strong">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className="-mb-px border-b-2 border-transparent py-2.5 font-mono text-small whitespace-nowrap text-pencil transition-colors duration-(--duration-fast) hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
        >
          {tab.label}
          {tab.hint && <span className="tabular ml-1.5 text-pencil">{tab.hint}</span>}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export const Tabs = RadixTabs.Root;
export const TabPanel = RadixTabs.Content;
