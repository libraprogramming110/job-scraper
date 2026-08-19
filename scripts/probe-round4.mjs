/** Round 4 — untested sources, incl. new CATEGORIES: ATS APIs, aggregator APIs, PH-local, freelance. */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TARGETS = [
  // ── Aggregator / public APIs (no key) ──
  { g: 'API', name: 'The Muse (public API)', url: 'https://www.themuse.com/api/public/jobs?page=1&category=Administration' },
  { g: 'API', name: 'HN Who-Is-Hiring (Algolia)', url: 'https://hn.algolia.com/api/v1/search?query=executive%20assistant&tags=comment&hitsPerPage=5' },
  { g: 'API', name: 'Remote4Me', url: 'https://remote4me.com/api/jobs' },
  { g: 'API', name: 'Jobgether', url: 'https://jobgether.com/api/v1/offers?limit=5' },
  { g: 'API', name: 'Findwork.dev', url: 'https://findwork.dev/api/jobs/' },
  { g: 'API', name: 'Adzuna (needs free key)', url: 'https://api.adzuna.com/v1/api/jobs/ph/search/1?results_per_page=5' },

  // ── ATS platforms: per-company boards, extremely stable JSON ──
  { g: 'ATS', name: 'Greenhouse (sample co)', url: 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs' },
  { g: 'ATS', name: 'Lever (sample co)', url: 'https://api.lever.co/v0/postings/netflix?mode=json' },
  { g: 'ATS', name: 'Ashby (sample co)', url: 'https://api.ashbyhq.com/posting-api/job-board/ramp' },
  { g: 'ATS', name: 'SmartRecruiters (search)', url: 'https://api.smartrecruiters.com/v1/companies/smartrecruiters/postings' },
  { g: 'ATS', name: 'Workable (sample co)', url: 'https://apply.workable.com/api/v1/widget/accounts/adaptavist?details=true' },
  { g: 'ATS', name: 'Recruitee (sample co)', url: 'https://mycompany.recruitee.com/api/offers/' },

  // ── PH-local ──
  { g: 'PH', name: 'Bossjob PH', url: 'https://api.bossjob.ph/api/v1/job/search?query=executive%20assistant&size=5' },
  { g: 'PH', name: 'Glints PH', url: 'https://glints.com/api/v2/job/search?keyword=executive%20assistant&country=PH&limit=5' },
  { g: 'PH', name: 'Jora PH', url: 'https://ph.jora.com/j?q=executive+assistant' },
  { g: 'PH', name: 'Mynimo (Cebu)', url: 'https://www.mynimo.com/philippines/jobs?keyword=executive+assistant' },
  { g: 'PH', name: 'Trabaho.com.ph', url: 'https://www.trabaho.com.ph/jobs/search?keyword=executive+assistant' },
  { g: 'PH', name: 'WorkAbroad.ph', url: 'https://www.workabroad.ph/job_search.php?jobsearch=executive+assistant' },
  { g: 'PH', name: 'JobsDB PH (v5)', url: 'https://ph.jobsdb.com/api/jobsearch/v5/search?siteKey=PH-Main&sourcesystem=houston&keywords=executive+assistant&pageSize=5' },

  // ── Freelance / gig (EA + Meta Ads live here too) ──
  { g: 'GIG', name: 'Upwork RSS', url: 'https://www.upwork.com/ab/feed/jobs/rss?q=executive+assistant' },
  { g: 'GIG', name: 'Workana', url: 'https://www.workana.com/en/jobs?language=en&query=executive+assistant' },
  { g: 'GIG', name: 'PeoplePerHour', url: 'https://www.peopleperhour.com/freelance-jobs?q=executive+assistant' },

  // ── Marketing/Meta-Ads leaning ──
  { g: 'MKT', name: 'MarketerHire', url: 'https://marketerhire.com/jobs' },
  { g: 'MKT', name: 'Growth Hub / GrowthHackers', url: 'https://growthhackers.com/jobs' },
];

const isWall = (s, b) =>
  [401, 402, 403, 429].includes(s) ||
  /just a moment|checking your browser|security check|captcha|unusual traffic|verify you are human|access denied/i.test(
    b.slice(0, 2500)
  );

const probe = async (t) => {
  try {
    const res = await fetch(t.url, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.text();
    const ct = (res.headers.get('content-type') || '').split(';')[0];

    if (isWall(res.status, body)) return { ...t, v: `🧱 WALLED (${res.status})`, d: '' };
    if (res.status >= 400) return { ...t, v: `❌ HTTP ${res.status}`, d: '' };

    if (ct.includes('json')) {
      try {
        const j = JSON.parse(body);
        const arr = Array.isArray(j) ? j : Object.values(j).find((v) => Array.isArray(v) && v.length) || [];
        const s = arr[0] || {};
        const title = s.name || s.title || s.text || s.jobTitle || s.position || '';
        return {
          ...t,
          v: '✅ JSON API',
          d: `${arr.length} recs | ${Object.keys(s).slice(0, 7).join(', ')}${title ? ` | e.g. "${String(title).slice(0, 45)}"` : ''}`,
        };
      } catch {}
    }
    const items = body.match(/<item[\s>]/gi)?.length || 0;
    if (items) return { ...t, v: '✅ RSS', d: `${items} items` };

    const links = body.match(/href="[^"]*\/(job|jobs|listing|position|vacancy|careers|offer)[^"]*"/gi)?.length || 0;
    const embedded = /__NEXT_DATA__|window\.__NUXT__|application\/ld\+json/.test(body);
    const title = body.match(/<title[^>]*>([\s\S]{0,70}?)<\/title>/i)?.[1].trim().replace(/\s+/g, ' ');
    return {
      ...t,
      v: links > 5 ? '✅ HTML' : links > 0 ? '⚠️  HTML (thin)' : '⚠️  JS-rendered',
      d: `${links} links${embedded ? ' | embedded JSON' : ''} | "${title}"`,
    };
  } catch (e) {
    return { ...t, v: '💀 ERROR', d: e.message.slice(0, 60) };
  }
};

const results = await Promise.all(TARGETS.map(probe));
console.log(`\n${'═'.repeat(82)}\n  ROUND 4 — new sources & new source TYPES\n${'═'.repeat(82)}`);
for (const g of ['API', 'ATS', 'PH', 'GIG', 'MKT']) {
  console.log(`\n──── ${g} ────`);
  for (const r of results.filter((x) => x.g === g)) {
    console.log(`${r.v.padEnd(20)} ${r.name}`);
    if (r.d) console.log(`${' '.repeat(20)} ${r.d.slice(0, 125)}`);
  }
}
console.log();
