# Job Source Reconnaissance — Findings

Probed live on 2026-07-23 from a single residential IP, no proxies, plain `fetch` with a
normal browser User-Agent. Scripts: `scripts/probe-sources.mjs`, `scripts/probe-deep.mjs`.

**Headline:** only **Indeed** is genuinely blocked. Everything else returned real job data.

---

## Tier A — Open JSON/RSS APIs (no browser, no login, no key)

| Source | Endpoint | Records | Full description? |
|---|---|---|---|
| **RemoteOK** | `remoteok.com/api` | 99 jobs/call | ✅ yes (~1.1k chars HTML) |
| **Remotive** | `remotive.com/api/remote-jobs` | 35+ | ✅ yes |
| **Jobicy** | `jobicy.com/api/v2/remote-jobs` | configurable | ✅ yes |
| **Himalayas** | `himalayas.app/jobs/api` | configurable | ✅ yes |
| **Arbeitnow** | `arbeitnow.com/api/job-board-api` | 100/page | ✅ yes |
| **WeWorkRemotely** | `weworkremotely.com/remote-jobs.rss` | 100 items | partial (RSS summary) |
| **WorkingNomads** | `workingnomads.com/api/exposed_jobs/` | 43 | ✅ yes |

> **Note on Remotive & Jobicy:** the *human-facing website* shows a Cloudflare
> "verify you're human" check, but the **API endpoints do not** — they returned clean JSON.
> Different doors. The browser friction does not affect us.

## Tier B — Open, but needs HTML parsing (still no login)

| Source | Result |
|---|---|
| **OnlineJobs.PH** | ✅ **No login required.** Search page HTTP 200, 30 job links/page. Detail pages fully public: title, salary (`$900` visible), full description, employer contact **not** gated. |
| **JobStreet PH** | ✅ Working JSON API — but **v5, not v4**. `ph.jobstreet.com/api/jobsearch/v5/search?siteKey=PH-Main&sourcesystem=houston&keywords=…` returns `{data, totalCount, facets}`. (v4 chalice = 404, deprecated.) |
| **Kalibrr** | ✅ Open JSON — `kalibrr.com/kjs/job_board/search?limit=&offset=&text=`. Returns title, company, city, description. No salary field. |

## Tier C — Blocked or awkward

| Source | Result |
|---|---|
| **Indeed** (PH + US) | 🧱 **HTTP 403 — "Security Check"**. Confirmed on both domains. Needs a paid scraper (Apify/SerpApi) or skip. |
| **LinkedIn** (guest endpoint) | ⚠️ Returns 10 job cards as HTML fragments, no descriptions — needs a 2nd fetch per job. Rate-limits aggressively. ToS-hostile. Treat as last resort. |

---

## Caveats

- These are **single probes**. Sustained polling may trigger rate limits that a one-shot
  request doesn't reveal. Politeness (delays, caching, low frequency) still required.
- OnlineJobs.PH job **links** parse reliably; the title selector used in the probe (`h4`)
  returned 0 — the real markup differs. Titles come from the detail page anyway.
- Site markup/endpoints change. Each source must live in its own adapter module.

## Recommended v1 source set

`RemoteOK` + `Remotive` + `Himalayas` + `Arbeitnow` + `WeWorkRemotely` (trivial APIs)
→ then `OnlineJobs.PH` + `JobStreet PH` + `Kalibrr` (PH anchors, parsing work).

**Indeed deferred. LinkedIn deferred.**
