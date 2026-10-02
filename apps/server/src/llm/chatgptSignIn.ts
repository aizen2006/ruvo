import type { ChatgptSignIn } from "@repo/contracts";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "../config/env";
import { conflict, HttpError } from "../libs/errors";
import { logger } from "../libs/logger";

/**
 * Signing in with ChatGPT from the dashboard. RUVO runs the openai-oauth CLI as README's terminal
 * steps do: `login` saves the sign-in to CODEX_HOME/auth.json, then `--detach` starts the sign-in
 * server in the background. Only the email is read from the saved sign-in; no token is returned or logged.
 */

/** Pinned: the login URL is read from this version's output. */
const CLI = "openai-oauth@2.0.0";
/** A login nobody finishes is stopped after this long. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const LOGIN_URL = /OpenAI OAuth login URL: (\S+)/;

/** A login started from the dashboard: its OpenAI login URL, which is `current` once the CLI prints it. */
type Login = { url: Promise<string>; current?: string };
/** The one login in progress, until it ends. */
let login: Login | null = null;

const authFile = () => join(env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");

/** `bun x` with the Bun running RUVO, so bunx needn't be on PATH. */
const bunx = (args: string[]) => Bun.spawn([process.execPath, "x", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });

const lastLine = (text: string) => text.trim().split("\n").at(-1)!.trim();

/** The account, the saved sign-in, the sign-in server and any login in progress. */
export async function signInStatus(): Promise<ChatgptSignIn> {
  const [saved, models] = await Promise.all([readSignIn(), listModels()]);
  return { account: env.AI_ACCOUNT, ...saved, serverRunning: models !== null, models: models ?? [], loginUrl: login?.current };
}

/** Starts `openai-oauth login`, at most one at a time, and resolves with OpenAI's login page for it. */
export async function startLogin(): Promise<string> {
  // A saved sign-in is never replaced from here (the CLI asks in a terminal before replacing one).
  if (!login && (await Bun.file(authFile()).exists())) throw conflict("This machine is already signed in with ChatGPT.");
  login ??= runLogin();
  return login.url;
}

/** Starts the sign-in server in the background, unless it already answers at OPENAI_OAUTH_URL. */
export async function startSignInServer(): Promise<void> {
  if (await listModels()) return;
  // On OPENAI_OAUTH_URL's port, so RUVO reaches the server it starts.
  const cli = bunx([CLI, "--detach", "--port", new URL(env.OPENAI_OAUTH_URL).port || "80"]);
  if ((await cli.exited) !== 0) throw new HttpError(502, `The sign-in server didn't start: ${lastLine(await new Response(cli.stderr).text())}`);
}

function runLogin() {
  // --bun runs the CLI in this one process (otherwise it runs in a Node child that outlives a kill);
  // --no-open leaves opening the page to the dashboard.
  const cli = bunx(["--bun", CLI, "login", "--no-open"]);
  const timer = setTimeout(() => cli.kill(), LOGIN_TIMEOUT_MS);
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const self: Login = { url: promise };
  const stderr = new Response(cli.stderr).text();

  // Read to the end, so the CLI can still write once the URL is found.
  void (async () => {
    let text = "";
    for await (const chunk of cli.stdout.pipeThrough(new TextDecoderStream())) {
      const url = LOGIN_URL.exec((text += chunk))?.[1];
      if (url && !self.current) resolve((self.current = url));
    }
  })();

  void cli.exited.then(async (code) => {
    clearTimeout(timer);
    // Only reaches a request still waiting for the URL.
    reject(new HttpError(502, `The ChatGPT sign-in stopped: ${lastLine(await stderr) || `exit code ${code}`}`));
    if (code === 0) {
      await startSignInServer().catch((err: Error) => logger.warn("The sign-in server didn't start after a ChatGPT sign-in", { error: err.message }));
    }
    // Settings keeps showing the sign-in as in progress until here.
    login = null;
  });
  return self;
}

/** Whether a sign-in is saved, and the email in its id token. Only the token's payload is decoded, and no token leaves here. */
async function readSignIn(): Promise<{ signedIn: boolean; email?: string }> {
  const file = Bun.file(authFile());
  if (!(await file.exists())) return { signedIn: false };
  try {
    const auth = (await file.json()) as { tokens?: { id_token?: string } };
    const { email } = JSON.parse(Buffer.from(auth.tokens?.id_token?.split(".")[1] ?? "", "base64url").toString()) as { email?: unknown };
    return { signedIn: true, email: typeof email === "string" ? email : undefined };
  } catch {
    return { signedIn: true };
  }
}

/** The models the sign-in server lists at OPENAI_OAUTH_URL, or null when it doesn't answer with them. */
async function listModels(): Promise<string[] | null> {
  try {
    const res = await fetch(`${env.OPENAI_OAUTH_URL.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    return data.map((m) => m.id);
  } catch {
    return null;
  }
}
