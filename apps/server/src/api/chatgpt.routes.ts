import { Router } from "express";
import { signInStatus, startLogin, startSignInServer } from "../llm/chatgptSignIn";

/**
 * Signing in with ChatGPT from the dashboard's Settings. The POST routes start programs on this
 * machine, so app.ts serves these only outside production.
 */
export const chatgptRouter = Router();

chatgptRouter.get("/", async (_req, res) => {
  res.json(await signInStatus());
});

/** Starts a sign-in and answers once OpenAI's login page for it is known (`loginUrl`). */
chatgptRouter.post("/sign-in", async (_req, res) => {
  await startLogin();
  res.json(await signInStatus());
});

/** Starts the sign-in server, for a machine that is already signed in. */
chatgptRouter.post("/start", async (_req, res) => {
  await startSignInServer();
  res.json(await signInStatus());
});
