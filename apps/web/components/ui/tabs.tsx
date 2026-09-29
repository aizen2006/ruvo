import { Tabs as RadixTabs } from "radix-ui";

/** Tabs on a thick ink rule; the active tab is a black block. Keyboard navigation comes from Radix. */
export function TabList({ tabs }: { tabs: Array<{ value: string; label: string; hint?: string }> }) {
  return (
    <RadixTabs.List className="flex overflow-x-auto border-b-[3px] border-ink">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className="group/tab px-item py-2.5 text-small font-semibold whitespace-nowrap text-graphite hover:bg-highlighter hover:text-ink focus-visible:outline-offset-[-3px] data-[state=active]:bg-ink data-[state=active]:text-sheet"
        >
          {tab.label}
          {tab.hint && <span className="ml-1.5 text-pencil group-data-[state=active]/tab:text-sheet/75">{tab.hint}</span>}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export const Tabs = RadixTabs.Root;
export const TabPanel = RadixTabs.Content;
