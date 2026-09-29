import { AskComposer } from "@/components/ask/ask-composer";

export const metadata = { title: "New list | RUVO" };

/** The ask screen: say what you want a list of. */
export default function NewListPage() {
  return (
    <div className="mx-auto max-w-[720px]">
      <AskComposer />
    </div>
  );
}
