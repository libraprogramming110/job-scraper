# Job Scraper

Scrapes job postings from **12 sources**, dedupes and ranks them against keywords you
choose, and writes structured output for resume tailoring.

**No API key. No database. No cost.** The scraper only gathers jobs — tailoring happens
in Claude Code, which reads the output files directly off disk.

---

## Quick start

```bash
npm start                                        # uses config.json, prompts you
npm start -- --keywords "some role, another"     # override for one run
npm start -- --all                               # config as-is, no prompt
```

Output lands in `out/`:

| File | Purpose |
|---|---|
| `out/jobs-latest.md` | Ranked, linked, **new-since-last-run**. Skim this. |
| `out/jobs-latest.json` | Every match with full descriptions. Claude reads this when tailoring. |
| `out/runs/jobs-<ts>.json` | Archive of each run. |

### Flags

| Flag | Effect |
|---|---|
| `--keywords "a,b"` | Search these instead of config's searches |
| `--source <id>` | Only this source (repeatable) |
| `--all` | Skip the prompt, use config as-is |
| `--limit N` | Cap jobs per source |
| `--no-descriptions` | Skip OnlineJobs.PH's per-job detail fetches (much faster, thinner data) |
| `--fresh` | Ignore the seen-cache; treat every job as new |

### Telegram alerts

New-since-last-run jobs are pushed to a Telegram bot after every run (`config.json`
→ `notify.enabled`, `jobsPerMessage`). Secrets live in **`telegram.json`** (gitignored):
`{ "token": ..., "chatId": ... }`. Get the token from @BotFather, your chat ID from
@userinfobot.

- **No spam** — only jobs never seen before get sent.
- **No silent loss** — if a send fails, those jobs stay out of the seen-cache and
  are re-alerted on the next run (the run summary prints `Telegram: FAILED — …`).
- **Scheduled runs** — a Windows Task Scheduler entry (`JobScraperDaily`) runs the
  scraper every day at 08:00; it also runs shortly after wake if the PC was asleep.

---

## Configuration

**Everything you'd want to change lives in `config.json`.** The code contains no roles,
job titles, or filters — change the config, never `src/`.

- `searches[]` — labelled keyword groups; toggle with `enabled`
- `filters.remoteOnly` — `false` lets on-site roles through (mainly the PH sources)
- `filters.employmentTypes` — `[]` means any; e.g. `["internship"]` or `["ojt"]` to narrow
- `filters.excludeKeywords` — drop postings containing these
- `filters.minSalary`, `filters.postedWithinDays` — optional; unparseable/undated jobs are kept
- `sources` — flip any source off
- `limits` — per-source cap, detail-fetch budget, politeness delay

---

## Sources

All 12 verified working (see `SOURCES.md` for probe findings). **Indeed is blocked** —
HTTP 403, confirmed — and LinkedIn is rate-limited and description-less, so neither is used.

| Class | Sources | Behavior |
|---|---|---|
| **Feed** (7) | RemoteOK · Remotive · Jobicy · Himalayas · Arbeitnow · WeWorkRemotely · WorkingNomads | Publish their whole recent feed. One request each; filtered locally. |
| **Query** (5) | JobStreet PH · Kalibrr · OnlineJobs.PH · RemoteRocketship · Jobspresso | Take a search term — **one request per keyword**, so run time scales with config. |

Notes worth knowing:

- **OnlineJobs.PH** is the strongest PH/VA source but its search page only yields links —
  descriptions need one extra request per job (~15s for 40). Gated by
  `limits.fetchDescriptions` and `limits.maxDetailFetches`.
- **JobStreet PH** returns only a teaser plus bullet points, not a full description; the
  URL carries the rest.
- **Himalayas** and **Remotive** cap their own page sizes (~20 and ~35) regardless of ours.

---

## How it works

```
config.json → 12 adapters (isolated) → score → dedupe → filter → rank → out/
```

- **Failure isolation** — every adapter is wrapped; one broken source never kills the run,
  and the summary always names what failed. A zero is never silent.
- **Ranking is plain keyword matching**, no LLM: title hit = 3 points, description = 1.
- **Dedupe runs twice** — within a run (same job cross-posted to two boards collapses) and
  across runs via `data/seen.json`, so the Markdown only shows what's new.
- **Mojibake repair** — several sources serve double-encoded UTF-8; it's repaired on the
  way in (`fixMojibake` in `src/core.mjs`), which cleaned up ~25% of descriptions.

### Layout

```
config.json              your knobs
src/cli.mjs              entry point
src/core.mjs             job shape, HTTP policy, dedupe, score, filter, rank
src/output.mjs           JSON + Markdown writers, seen-cache
src/sources/index.mjs    registry + failure isolation
src/sources/*.mjs        one adapter per source
scripts/probe-*.mjs      source health checks
```

### When a source breaks

Scrapers rot. The run summary names the failure; fix that one adapter in `src/sources/`.
To confirm what's still reachable: `node scripts/probe-sources.mjs`.

---

## Tailoring (in Claude Code, not here)

The scraper never touches your CV. To tailor, just ask in this folder — Claude reads
`out/jobs-latest.json` and your `data/master-profile.md` directly:

> "Show me the top matches, then tailor my resume for #3."

`data/master-profile.md` is gitignored; drop your CV there whenever you're ready.

---

## Not in scope

No LLM, no API key, no database, no PDF rendering, no auto-apply, no login, no cron,
no web UI. Deliberately — it keeps the tool free, fast, and unlikely to break.
