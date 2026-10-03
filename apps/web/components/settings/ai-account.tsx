"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api, isClientError } from "@/lib/api";
import { useChatgptAction, useChatgptSignIn, useRunOptions } from "@/lib/queries";

/** Which AI account RUVO uses, and signing in with ChatGPT on this machine. Its buttons sit inside the Settings form, so none submits it. */
export function AiAccountSection() {
  const options = useRunOptions();
  const chatgpt = useChatgptSignIn();
  const signIn = useChatgptAction(api.signInWithChatgpt);
  const start = useChatgptAction(api.startChatgptServer);
  const signOut = useChatgptAction(api.signOutOfChatgpt);
  const error = signIn.error ?? start.error ?? signOut.error;

  return (
    <section aria-labelledby="chatgpt-sign-in" className="space-y-item">
      <h3 id="chatgpt-sign-in" className="font-mono text-micro text-graphite">
        ChatGPT sign-in
      </h3>
      {options.data && (
        <p className="text-graphite">
          {options.data.account === "chatgpt"
            ? "RUVO uses your ChatGPT plan, because no API key is set."
            : "RUVO uses your OpenAI API key, so it doesn't use the ChatGPT sign-in."}
        </p>
      )}

      {chatgpt.isPending ? (
        <Skeleton className="h-24" />
      ) : chatgpt.data ? (
        <div className="space-y-item rounded-control border border-hairline bg-sheet p-group">
          {chatgpt.data.loginUrl ? (
            <>
              <p>Waiting for you to sign in on OpenAI&apos;s page.</p>
              <a
                href={chatgpt.data.loginUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-small text-ink underline underline-offset-4 hover:decoration-2"
              >
                Open the login page <ExternalLink className="size-3" aria-hidden />
              </a>
            </>
          ) : !chatgpt.data.signedIn ? (
            <>
              <p>Not signed in with ChatGPT on this machine.</p>
              <Button
                type="button"
                variant="primary"
                disabled={signIn.isPending}
                onClick={() => signIn.mutate(undefined, { onSuccess: ({ loginUrl }) => window.open(loginUrl, "_blank", "noopener,noreferrer") })}
              >
                {signIn.isPending ? "Opening the login page…" : "Sign in with ChatGPT"}
              </Button>
            </>
          ) : (
            <>
              <p>
                {chatgpt.data.email ? `Signed in as ${chatgpt.data.email}` : "Signed in with ChatGPT"}
                {!chatgpt.data.serverRunning && ", but the sign-in server isn't running."}
              </p>
              {chatgpt.data.serverRunning && (
                <p className="font-mono text-micro text-graphite">Models on your plan: {chatgpt.data.models.join(", ")}</p>
              )}
              <div className="flex flex-wrap gap-item">
                {!chatgpt.data.serverRunning && (
                  <Button type="button" variant="primary" disabled={start.isPending} onClick={() => start.mutate(undefined, { onSuccess: () => toast("Started") })}>
                    {start.isPending ? "Starting…" : "Start the sign-in server"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  disabled={signOut.isPending}
                  onClick={() =>
                    window.confirm("Sign out of ChatGPT on this computer? The Codex CLI shares this sign-in, so it is signed out too.") &&
                    signOut.mutate(undefined, { onSuccess: () => toast("Signed out") })
                  }
                >
                  {signOut.isPending ? "Signing out…" : "Sign out"}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        // Production doesn't serve the sign-in; any other failure is worth saying.
        !isClientError(chatgpt.error) && <p className="text-small text-brick">{chatgpt.error.message}</p>
      )}
      {error && (
        <p role="alert" className="text-small text-brick">
          {error.message}
        </p>
      )}
    </section>
  );
}
