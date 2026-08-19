/**
 * Source reconnaissance.
 * Hits every candidate job source and reports: reachable? blocked? what shape is the data?
 * Read-only — nothing here is a scraper, it just knocks on the door once.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TARGETS = [
  // --- Tier 1: expected to be open machine-facing endpoints ---
  { tier: 1, name: 'RemoteOK', kind: 'json', url: 'https://remoteok.com/api' },
  { tier: 1, name: 'Remotive', kind: 'json', url: 'https://remotive.com/api/remote-jobs?limit=5' },
  { tier: 1, name: 'Jobicy', kind: 'json', url: 'https://jobicy.com/api/v2/remote-jobs?count=5' },
  { tier: 1, name: 'Himalayas', kind: 'json', url: 'https://himalayas.app/jobs/api?limit=5' },
  { tier: 1, name: 'Arbeitnow', kind: 'json', url: 'https://www.arbeitnow.com/api/job-board-api' },
  { tier: 1, name: 'WeWorkRemotely (RSS)', kind: 'xml', url: 'https://weworkremotely.com/remote-jobs.rss' },
  { tier: 1, name: 'WorkingNomads', kind: 'json', url: 'https://www.workingnomads.com/api/exposed_jobs/' },

  // --- Tier 2/3: the tricky ones ---
  {
    tier: 2,
    name: 'OnlineJobs.PH (search page)',
    kind: 'html',
    url: 'https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=executive+assistant',
  },
  {
    tier: 3,
    name: 'Indeed PH (search page)',
    kind: 'html',
    url: 'https://ph.indeed.com/jobs?q=executive+assistant',
  },
  {
    tier: 3,
    name: 'LinkedIn (guest jobs API)',
    kind: 'html',
    url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=executive%20assistant&location=Philippines&start=0',
  },
  {
    tier: 3,
    name: 'JobStreet PH (internal search API)',
    kind: 'json',
    url: 'https://ph.jobstreet.com/api/jobsearch/v5/search?siteKey=PH-Main&sourcesystem=houston&locale=en-PH&page=1&pageSize=5&keywords=executive%20assistant',
  },
  {
    tier: 3,
    name: 'Kalibrr (internal job board API)',
    kind: 'json',
    url: 'https://www.kalibrr.com/kjs/job_board/search?limit=5&offset=0&text=executive%20assistant',
  },
  {
    tier: 2,
    name: 'RemoteRocketship (search page)',
    kind: 'html',
    url: 'https://www.remoterocketship.com/?page=1&sort=DateAdded&searchQuery=executive%20assistant',
  },
  {
    tier: 2,
    name: 'Jobspresso (search page)',
    kind: 'html',
    url: 'https://jobspresso.co/?s=executive%20assistant&post_type=job_listing',
  },
];

// Fingerprints that mean "a bot wall answered, not the site".
const WALL_MARKERS = [
  ['cloudflare', /cloudflare|cf-browser-verification|cf_chl|__cf_bm/i],
  ['JS challenge', /just a moment|checking your browser|enable javascript and cookies/i],
  ['captcha', /captcha|recaptcha|hcaptcha|are you a robot|unusual traffic/i],
  ['access denied', /access denied|forbidden|blocked|not authorized/i],
];

function detectWall(status, headers, body) {
  const hits = [];
  // Body-only scan: the Server header (and cf-ray presence) fires on every
  // Cloudflare-fronted site regardless of blocking — a false positive.
  const hay = body.slice(0, 4000);
  for (const [label, re] of WALL_MARKERS) if (re.test(hay)) hits.push(label);
  if (headers['cf-mitigated']) hits.push('cf-mitigated header');
  if ([401, 403, 429].includes(status)) hits.push(`HTTP ${status}`);
  return [...new Set(hits)];
}

/** Describe what we actually got back, so we know if it's usable data. */
function describe(kind, body) {
  try {
    if (kind === 'json' || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
      const data = JSON.parse(body);
      // Find the array of postings wherever it lives.
      let arr = Array.isArray(data) ? data : null;
      let path = arr ? '(root)' : null;
      if (!arr) {
        for (const [k, v] of Object.entries(data)) {
          if (Array.isArray(v) && v.length) {
            arr = v;
            path = k;
            break;
          }
        }
      }
      if (!arr) return { ok: true, note: `JSON object, keys: ${Object.keys(data).slice(0, 8).join(', ')}` };
      const sample = arr.find((x) => x && typeof x === 'object') || {};
      return {
        ok: true,
        count: arr.length,
        note: `array at "${path}" — fields: ${Object.keys(sample).slice(0, 14).join(', ')}`,
      };
    }
    if (kind === 'xml') {
      const items = body.match(/<item[\s>]/gi)?.length || 0;
      return { ok: items > 0, count: items, note: `RSS <item> count: ${items}` };
    }
    // HTML: is there anything that smells like job listings?
    const title = body.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i)?.[1]?.trim().replace(/\s+/g, ' ');
    const jobishLinks = body.match(/href="[^"]*\/(job|jobs|jobseekers\/job|viewjob|jobview)[^"]*"/gi)?.length || 0;
    return { ok: jobishLinks > 0, count: jobishLinks, note: `title: "${title || 'n/a'}" | job-ish links: ${jobishLinks}` };
  } catch (e) {
    return { ok: false, note: `unparseable (${e.message.slice(0, 60)})` };
  }
}

async function probe(t) {
  const started = Date.now();
  try {
    const res = await fetch(t.url, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.text();
    const headers = Object.fromEntries(res.headers.entries());
    const wall = detectWall(res.status, headers, body);
    const shape = describe(t.kind, body);
    return {
      ...t,
      status: res.status,
      ms: Date.now() - started,
      bytes: body.length,
      contentType: (headers['content-type'] || '').split(';')[0],
      wall,
      shape,
      finalUrl: res.url !== t.url ? res.url : undefined,
    };
  } catch (e) {
    return { ...t, status: 0, ms: Date.now() - started, error: e.message, wall: [], shape: { ok: false, note: '—' } };
  }
}

const verdict = (r) => {
  if (r.error) return '💀 UNREACHABLE';
  if (r.wall.length) return '🧱 WALLED';
  if (r.status >= 400) return `❌ HTTP ${r.status}`;
  if (r.shape.ok) return '✅ OPEN';
  return '⚠️  REACHABLE, NO DATA';
};

console.log(`\nProbing ${TARGETS.length} sources...\n${'='.repeat(78)}`);
const results = await Promise.all(TARGETS.map(probe));

for (const tier of [1, 2, 3]) {
  const group = results.filter((r) => r.tier === tier);
  if (!group.length) continue;
  console.log(`\n──── TIER ${tier} ────`);
  for (const r of group) {
    console.log(`\n${verdict(r)}  ${r.name}`);
    console.log(`   ${r.url.slice(0, 100)}`);
    if (r.error) console.log(`   error: ${r.error}`);
    else {
      console.log(`   HTTP ${r.status} | ${r.contentType || '?'} | ${(r.bytes / 1024).toFixed(1)}kb | ${r.ms}ms`);
      if (r.finalUrl) console.log(`   redirected -> ${r.finalUrl.slice(0, 90)}`);
      if (r.wall.length) console.log(`   wall signals: ${r.wall.join(', ')}`);
      console.log(`   data: ${r.shape.count !== undefined ? `${r.shape.count} records | ` : ''}${r.shape.note}`);
    }
  }
}

console.log(`\n${'='.repeat(78)}\nSUMMARY`);
for (const r of results) console.log(`  ${verdict(r).padEnd(22)} ${r.name}`);
console.log();
