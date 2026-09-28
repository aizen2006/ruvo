import { Router } from "express";
import { z } from "zod";

/**
 * A small fictional careers page served by RUVO itself, for demonstrating self-repair.
 * Version 1 marks jobs up as `.job-card`; version 2 is the "redesigned" site using
 * `.job-listing` with different inner markup. Switching versions keeps the same URL, the
 * way a real site redesign breaks a recorded recipe.
 */

const JOBS = [
  { id: "be-1", title: "Senior Backend Engineer, Inference API", location: "Remote (EU)", team: "Platform" },
  { id: "ai-2", title: "AI Infrastructure Engineer", location: "Berlin", team: "Infrastructure" },
  { id: "ag-3", title: "Agents Engineer, Tool Use", location: "Remote (US)", team: "Applied AI" },
  { id: "da-4", title: "Data Engineer, Evaluation Pipelines", location: "London", team: "Data" },
  { id: "fe-5", title: "Frontend Engineer, Console", location: "Remote", team: "Product" },
  { id: "sr-6", title: "Site Reliability Engineer", location: "Amsterdam", team: "Platform" },
  { id: "ml-7", title: "Machine Learning Engineer, Retrieval", location: "Remote (EU)", team: "Research" },
  { id: "ae-8", title: "Account Executive", location: "New York", team: "Sales" },
];

let version: 1 | 2 = 1;

const v1 = () =>
  JOBS.map(
    (j) => `<div class="job-card">
      <h3 class="job-title"><a href="/fixtures/careers/jobs/${j.id}">${j.title}</a></h3>
      <span class="job-location">${j.location}</span>
      <span class="job-team">${j.team}</span>
    </div>`,
  ).join("\n");

const v2 = () =>
  JOBS.map(
    (j) => `<article class="job-listing">
      <a class="listing-link" href="/fixtures/careers/jobs/${j.id}"><h2 class="listing-name">${j.title}</h2></a>
      <ul class="listing-meta"><li class="meta-where">${j.location}</li><li class="meta-team">${j.team}</li></ul>
    </article>`,
  ).join("\n");

/** The careers page as it looks in a given site version (exported for tests). */
export const careersPage = (v: 1 | 2 = version) => `<!doctype html>
<html><head><title>Northwind Labs careers (RUVO demo site)</title></head>
<body>
  <header><h1>Northwind Labs</h1><p>A fictional company used to demonstrate RUVO's self-repair. Site version ${v}.</p></header>
  <main><h2>Open roles</h2><section class="jobs">${v === 1 ? v1() : v2()}</section></main>
  <footer><p>${"We build reliable AI infrastructure for developers. ".repeat(8)}</p></footer>
</body></html>`;

export const careersSite = Router();

careersSite.get("/careers", (_req, res) => {
  res.type("html").send(careersPage());
});

careersSite.get("/careers/jobs/:id", (req, res) => {
  const job = JOBS.find((j) => j.id === req.params.id);
  if (!job) return void res.status(404).send("Not found");
  res.type("html").send(`<!doctype html><html><body><h1>${job.title}</h1><p>${job.location}, ${job.team}</p></body></html>`);
});

/** Switches the markup version, simulating a redesign: `POST /fixtures/careers/version {"version": 2}`. */
careersSite.post("/careers/version", (req, res) => {
  version = z.object({ version: z.union([z.literal(1), z.literal(2)]) }).parse(req.body).version;
  res.json({ version });
});
