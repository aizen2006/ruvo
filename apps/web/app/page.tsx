import { PromptComposer } from "@/components/prompt-composer";
import { RunHistory } from "@/components/run-history";

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="max-w-3xl space-y-3">
        <h1 className="font-serif text-4xl leading-tight tracking-tight">Ask for a dataset in your own words.</h1>
        <p className="max-w-2xl text-muted">
          RUVO turns the request into a contract you can review, collects matching records from public job boards,
          and shows where every value came from.
        </p>
      </section>

      <section className="max-w-3xl">
        <PromptComposer />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent runs</h2>
        <RunHistory limit={8} />
      </section>
    </div>
  );
}
