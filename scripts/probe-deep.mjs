/**
 * Pass 2 — corrected verdicts + drill into the tricky sources.
 *
 * Pass 1's bug: it treated the Cloudflare CDN header as "blocked". Cloudflare fronts half the
 * internet; being behind it means nothing. The only question that matters is:
 * DID WE GET USABLE JOB DATA BACK? Data present wins over any header.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const get = async (url, extra = {}) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...extra },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  return { status: res.status, body: await res.text(), url: res.url, headers: Object.fromEntries(res.headers.entries()) };
};

/** A real wall serves a challenge/denial page INSTEAD of content. Data present = not walled. */
const isRealWall = (status, body) =>
  [401, 403, 429].includes(status) ||
  /just a moment|checking your browser|security check|captcha|unusual traffic|enable javascript and cookies/i.test(
    body.slice(0, 3000)
  );

const line = (s) => console.log(s);
const hr = (t) => line(`\n${'═'.repeat(76)}\n  ${t}\n${'═'.repeat(76)}`);

// ─────────────────────────────────────────────────────────────────────────────
hr('1. REMOTEOK — verify actual job records (element 0 is a legal notice)');
try {
  const r = await get('https://remoteok.com/api');
  const data = JSON.parse(r.body);
  const jobs = data.filter((x) => x && x.position);
  line(`  HTTP ${r.status} | ${jobs.length} real jobs (of ${data.length} elements)`);
  line(`  fields: ${Object.keys(jobs[0] || {}).join(', ')}`);
  const j = jobs[0];
  line(`  sample: "${j.position}" @ ${j.company} | ${j.location || 'n/a'} | ${j.url}`);
  line(`  has full description HTML: ${!!j.description} (${(j.description || '').length} chars)`);
} catch (e) {
  line(`  FAILED: ${e.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
hr('2. ONLINEJOBS.PH — can we read a job DETAIL page without logging in?');
try {
  const search = await get('https://www.onlinejobs.ph/jobseekers/jobsearch?jobkeyword=executive+assistant');
  line(`  search page: HTTP ${search.status} | walled: ${isRealWall(search.status, search.body)}`);

  // Pull job detail links out of the search results.
  const links = [...new Set([...search.body.matchAll(/href="(\/jobseekers\/job\/[^"]+)"/gi)].map((m) => m[1]))];
  line(`  job detail links found: ${links.length}`);
  const titles = [...search.body.matchAll(/<h4[^>]*>\s*([^<]{5,90}?)\s*<\/h4>/gi)].map((m) => m[1].trim());
  line(`  titles parsed from search results: ${titles.length}`);
  titles.slice(0, 5).forEach((t) => line(`     • ${t}`));

  if (links.length) {
    const detailUrl = `https://www.onlinejobs.ph${links[0]}`;
    const d = await get(detailUrl);
    const walled = isRealWall(d.status, d.body);
    const loginGate = /please\s+log\s?in|sign\s?in to (view|see)|register to view|create an account to/i.test(d.body);
    line(`\n  detail page: ${detailUrl.slice(0, 88)}`);
    line(`  HTTP ${d.status} | ${(d.body.length / 1024).toFixed(1)}kb | walled: ${walled} | login-gated: ${loginGate}`);
    const dTitle = d.body.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i)?.[1].trim().replace(/\s+/g, ' ');
    line(`  title: "${dTitle}"`);
    // Does the public detail page carry the actual job description text?
    const salary = d.body.match(/(?:SALARY|Salary)[\s\S]{0,160}?([₱$][\d,\.]+|[\d,]{3,})/)?.[0]?.replace(/\s+/g, ' ').slice(0, 90);
    line(`  salary block visible: ${salary ? `yes — "${salary}"` : 'not detected'}`);
    const jobDesc = d.body.match(/JOB DESCRIPTION|Job Description|job-description/i);
    line(`  description section present: ${!!jobDesc}`);
    line(`  employer contact hidden behind login: ${/log ?in to (contact|apply|view)/i.test(d.body)}`);
  }
} catch (e) {
  line(`  FAILED: ${e.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
hr('3. JOBSTREET PH — find the working search endpoint (pass 1 got a 404)');
const jsVariants = [
  'https://ph.jobstreet.com/api/chalice-search/v4/search?siteKey=PH-Main&sourcesystem=houston&keywords=executive+assistant&pageSize=5',
  'https://ph.jobstreet.com/api/chalice-search/v4/search?siteKey=PH-Main&sourcesystem=houston&keywords=executive%20assistant&page=1&pageSize=5&locale=en-PH',
  'https://ph.jobstreet.com/api/jobsearch/v5/search?siteKey=PH-Main&sourcesystem=houston&keywords=executive+assistant&pageSize=5&locale=en-PH',
];
for (const url of jsVariants) {
  try {
    const r = await get(url, { Accept: 'application/json' });
    let note = '';
    try {
      const d = JSON.parse(r.body);
      const arr = d.data || d.jobs || d.results || [];
      note = `JSON ok — ${Array.isArray(arr) ? arr.length : 0} jobs | keys: ${Object.keys(d).slice(0, 8).join(', ')}`;
      if (arr[0]) note += `\n       sample: "${arr[0].title}" @ ${arr[0].advertiser?.description || arr[0].companyName || '?'}`;
    } catch {
      note = `not JSON (${r.body.slice(0, 60).replace(/\s+/g, ' ')}…)`;
    }
    line(`  HTTP ${r.status} | ${url.match(/\/(v\d)\//)?.[1] || '?'} ${url.includes('jobsearch') ? 'jobsearch' : 'chalice'} → ${note}`);
  } catch (e) {
    line(`  ERROR ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
hr('4. KALIBRR — confirm real usable job data');
try {
  const r = await get('https://www.kalibrr.com/kjs/job_board/search?limit=5&offset=0&text=executive%20assistant');
  const d = JSON.parse(r.body);
  const jobs = d.jobs || [];
  line(`  HTTP ${r.status} | ${jobs.length} jobs | total available: ${d.total ?? '?'}`);
  jobs.slice(0, 3).forEach((j) =>
    line(`     • "${j.name || j.title}" @ ${j.company?.name || j.company_name} | ${j.google_location?.address_components?.city || j.location || 'n/a'}`)
  );
  line(`  description field present: ${!!jobs[0]?.description} | salary: ${!!jobs[0]?.base_salary}`);
} catch (e) {
  line(`  FAILED: ${e.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
hr('5. INDEED — confirm it is genuinely blocked (not a fluke)');
for (const u of ['https://ph.indeed.com/jobs?q=executive+assistant', 'https://www.indeed.com/jobs?q=executive+assistant&l=remote']) {
  try {
    const r = await get(u);
    line(`  ${u.slice(0, 60)} → HTTP ${r.status} | walled: ${isRealWall(r.status, r.body)} | "${r.body.match(/<title[^>]*>([\s\S]{0,60}?)<\/title>/i)?.[1].trim()}"`);
  } catch (e) {
    line(`  ${u.slice(0, 60)} → ERROR ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
hr('6. LINKEDIN guest endpoint — what does it actually return?');
try {
  const r = await get(
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=executive%20assistant&location=Philippines&f_WT=2&start=0'
  );
  const cards = r.body.match(/<li>/g)?.length || 0;
  const titles = [...r.body.matchAll(/<h3[^>]*>\s*([^<]{4,90}?)\s*<\/h3>/g)].map((m) => m[1].trim());
  line(`  HTTP ${r.status} | ${(r.body.length / 1024).toFixed(1)}kb | walled: ${isRealWall(r.status, r.body)}`);
  line(`  job cards: ${cards} | titles parsed: ${titles.length}`);
  titles.slice(0, 5).forEach((t) => line(`     • ${t}`));
  line(`  NOTE: returns HTML fragments, no descriptions — needs a 2nd fetch per job, rate-limits hard.`);
} catch (e) {
  line(`  FAILED: ${e.message}`);
}

line('\n');
