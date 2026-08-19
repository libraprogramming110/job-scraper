/**
 * Core: the shared job shape, HTTP policy, and everything that happens to jobs
 * after a source hands them over — normalize, dedupe, filter, rank.
 *
 * Nothing in this file knows what any particular role is. Keywords arrive from config.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─────────────────────────────────────────────────────────────── HTTP policy ──

const lastHit = new Map(); // host -> timestamp, so we stay polite per-host

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RETRY_BASE_MS = 800;
const MAX_RETRIES = 2;

/** Retryable = network error or a 5xx/429. 4xx (403s etc.) are permanent — never retry. */
const retryable = (err, res) => Boolean(res && (res.status >= 500 || res.status === 429)) || /fetch failed|network|timeout|abort/i.test(err?.message || '');

/** GET with a browser UA, a timeout, a per-host delay, and retries on transient errors. Throws on non-2xx. */
export async function httpGet(url, { delayMs = 300, timeoutMs = 25000, headers = {} } = {}) {
  const host = new URL(url).host;
  const since = Date.now() - (lastHit.get(host) ?? 0);
  if (since < delayMs) await sleep(delayMs - since);
  lastHit.set(host, Date.now());

  let res;
  let attempt = 0;
  for (;;) {
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      if (!retryable(null, res)) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (retryable(e, null) && attempt < MAX_RETRIES) {
        attempt++;
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw e;
    }
  }
}

export const getJson = async (url, opts) => (await httpGet(url, opts)).json();
export const getText = async (url, opts) => (await httpGet(url, opts)).text();

// ──────────────────────────────────────────────────────────────── normalizing ──

const C2 = 0xc2; // Â — lead byte of a 2-byte UTF-8 sequence read as Latin-1
const C3 = 0xc3; // Ã
const E2 = 0xe2; // â — lead byte of a 3-byte sequence (curly quotes, dashes)
const CONT_LO = 0x80;
const CONT_HI = 0xbf;
const REPLACEMENT = '�';

/**
 * Repair double-encoded UTF-8 (the "Iâ€™m" → "I'm" problem). Several sources serve
 * text that was UTF-8 encoded twice; left alone it garbled ~25% of descriptions in
 * testing. Detection is byte-code based rather than a literal regex so this file
 * stays free of invisible high-byte characters.
 */
export function fixMojibake(text) {
  if (!text) return text;
  const str = String(text);

  let suspicious = false;
  for (let i = 0; i < str.length - 1; i++) {
    const c = str.charCodeAt(i);
    if (c === C2 || c === C3 || c === E2) {
      const next = str.charCodeAt(i + 1);
      if (next >= CONT_LO && next <= CONT_HI) {
        suspicious = true;
        break;
      }
    }
  }
  if (!suspicious) return str;

  try {
    const repaired = Buffer.from(str, 'latin1').toString('utf8');
    // If re-decoding produced U+FFFD the text wasn't double-encoded after all.
    if (!repaired.includes(REPLACEMENT)) return repaired;
  } catch {
    /* fall through and keep the original */
  }
  return str;
}

/** Turn HTML (or anything) into readable plain text. */
export function stripHtml(input) {
  if (!input) return '';
  return fixMojibake(String(input))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Clean a short field (title, company, location) without the HTML machinery. */
const clean = (s) => fixMojibake(String(s || '')).replace(/\s+/g, ' ').trim();

/** Best-effort ISO date from whatever a source hands us (epoch, seconds, string). */
export function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  let d;
  if (typeof value === 'number') {
    d = new Date(value < 1e11 ? value * 1000 : value); // seconds vs milliseconds
  } else {
    const s = String(value).trim();
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      d = new Date(n < 1e11 ? n * 1000 : n);
    } else {
      d = new Date(s);
    }
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pull a rough numeric floor out of a salary string. Deliberately crude — it only
 * feeds the optional `minSalary` filter, and unparseable salaries are never dropped.
 */
export function parseSalaryFloor(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/,/g, '');
  const nums = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n > 0);
  if (!nums.length) return null;
  let n = Math.min(...nums);
  if (/\d\s*k\b/i.test(cleaned) && n < 1000) n *= 1000; // "50k"
  return n;
}

const REMOTE_RE = /\b(remote|anywhere|work\s*from\s*home|wfh|distributed|worldwide|telecommute)\b/i;

/** Does this posting look remote, judging by whatever text we have? */
export function looksRemote(job) {
  if (job.remote === true) return true;
  if (job.remote === false) return false;
  const hay = [job.location, job.title, job.employmentType, (job.tags || []).join(' ')].join(' ');
  return REMOTE_RE.test(hay);
}

/** Coerce a source's raw mapping into the one shape the rest of the app knows. */
export function normalizeJob(partial) {
  return {
    source: partial.source,
    externalId: String(partial.externalId ?? partial.url ?? Math.random()),
    title: clean(partial.title),
    company: clean(partial.company) || 'Unknown',
    location: clean(partial.location).replace(/[,\s]+$/, '') || null,
    remote: partial.remote ?? null,
    employmentType: clean(partial.employmentType) || null,
    salary: clean(partial.salary) || null,
    url: partial.url || null,
    postedAt: toIso(partial.postedAt),
    description: stripHtml(partial.description),
    tags: Array.isArray(partial.tags)
      ? [...new Set(partial.tags.filter(Boolean).map((t) => clean(t)).filter(Boolean))]
      : [],
  };
}

// ───────────────────────────────────────────────────────────────────── dedupe ──

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|co|the|a|an)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Cross-source identity: the same posting on RemoteOK and WWR collapses to one. */
export const fuzzyKey = (job) => `${slug(job.company)}|${slug(job.title)}`;

export function dedupe(jobs) {
  const seenExact = new Set();
  const seenFuzzy = new Set();
  const out = [];
  for (const job of jobs) {
    const exact = `${job.source}:${job.externalId}`;
    if (seenExact.has(exact)) continue;
    const fuzzy = fuzzyKey(job);
    if (seenFuzzy.has(fuzzy)) continue;
    seenExact.add(exact);
    seenFuzzy.add(fuzzy);
    out.push(job);
  }
  return out;
}

// ────────────────────────────────────────────────────────────── score + filter ──

/**
 * Relevance with no LLM: a keyword in the title is worth 3, in the description 1.
 * A job needs at least one hit to survive.
 */
export function scoreJob(job, keywords) {
  if (!keywords?.length) return { relevance: 1, matchedKeywords: [] };
  const title = job.title.toLowerCase();
  const body = `${job.description} ${job.tags.join(' ')}`.toLowerCase();

  let relevance = 0;
  const matched = [];
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    let hit = 0;
    if (title.includes(k)) hit += 3;
    if (body.includes(k)) hit += 1;
    if (hit) {
      relevance += hit;
      matched.push(kw);
    }
  }
  return { relevance, matchedKeywords: matched };
}

/** Loose match of a posting against configured employment types. */
function matchesEmploymentType(job, types) {
  if (!types?.length) return true;
  const hay = [job.employmentType, job.title, job.tags.join(' '), job.description.slice(0, 600)]
    .join(' ')
    .toLowerCase();
  return types.some((t) => hay.includes(String(t).toLowerCase().trim()));
}

/**
 * Apply every configured filter. Returns kept jobs plus a tally of what was
 * dropped and why — a silent filter is as bad as a silent scraper.
 */
export function applyFilters(jobs, filters = {}) {
  const dropped = { notRemote: 0, excluded: 0, employmentType: 0, salary: 0, tooOld: 0, noMatch: 0 };
  const cutoff =
    filters.postedWithinDays != null ? Date.now() - filters.postedWithinDays * 86400000 : null;
  const excludes = (filters.excludeKeywords || []).map((k) => k.toLowerCase()).filter(Boolean);

  const kept = jobs.filter((job) => {
    if (job.relevance <= 0) return (dropped.noMatch++, false);

    if (filters.remoteOnly && !looksRemote(job)) return (dropped.notRemote++, false);

    if (excludes.length) {
      const hay = `${job.title} ${job.description}`.toLowerCase();
      if (excludes.some((k) => hay.includes(k))) return (dropped.excluded++, false);
    }

    if (!matchesEmploymentType(job, filters.employmentTypes)) {
      return (dropped.employmentType++, false);
    }

    if (filters.minSalary != null) {
      const floor = parseSalaryFloor(job.salary);
      if (floor !== null && floor < filters.minSalary) return (dropped.salary++, false);
    }

    if (cutoff && job.postedAt && new Date(job.postedAt).getTime() < cutoff) {
      return (dropped.tooOld++, false);
    }

    return true;
  });

  return { kept, dropped };
}

/** Most relevant first; ties broken by freshness. */
export function rank(jobs) {
  return [...jobs].sort(
    (a, b) =>
      b.relevance - a.relevance ||
      new Date(b.postedAt || 0).getTime() - new Date(a.postedAt || 0).getTime(),
  );
}
