/** Round 3 — additional PH + remote boards worth considering. Same read-only knock. */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TARGETS = [
  // PH-focused
  { name: 'Jobs180 (PH)', url: 'https://www.jobs180.com/jobs?q=executive+assistant' },
  { name: 'BestJobs PH', url: 'https://bestjobs.ph/jobs-of-executive-assistant' },
  { name: 'Foundit PH (ex-Monster)', url: 'https://www.foundit.com.ph/srp/results?query=executive%20assistant' },
  { name: 'Remote Staff PH', url: 'https://www.remotestaff.ph/jobseeker/jobs/' },
  { name: 'Virtual Coworker', url: 'https://virtualcoworker.com/jobs/' },

  // Remote boards
  { name: 'Jobspresso', url: 'https://jobspresso.co/?s=executive+assistant&post_type=job_listing' },
  { name: 'Remote.co', url: 'https://remote.co/remote-jobs/search?search_keywords=executive+assistant' },
  { name: 'NoDesk', url: 'https://nodesk.co/remote-jobs/' },
  { name: 'Dynamite Jobs', url: 'https://dynamitejobs.com/remote-jobs' },
  { name: 'JustRemote', url: 'https://justremote.co/remote-jobs' },
  { name: 'Wellfound', url: 'https://wellfound.com/role/r/executive-assistant' },
  { name: 'Remote Rocketship', url: 'https://www.remoterocketship.com/?page=1&sort=DateAdded' },
  { name: 'Otta / Welcome', url: 'https://app.otta.com/jobs' },
  { name: 'Hubstaff Talent', url: 'https://talent.hubstaff.com/search/jobs?search%5Bkeywords%5D=executive+assistant' },

  // Feeds worth a shot
  { name: 'Jobicy RSS', url: 'https://jobicy.com/?feed=job_feed' },
  { name: 'Remote.io API', url: 'https://www.remote.io/api/remote-jobs' },
];

const isWall = (s, b) =>
  [401, 403, 429].includes(s) ||
  /just a moment|checking your browser|security check|captcha|unusual traffic|verify you are human/i.test(b.slice(0, 3000));

const probe = async (t) => {
  try {
    const res = await fetch(t.url, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.text();
    const ct = (res.headers.get('content-type') || '').split(';')[0];

    if (isWall(res.status, body)) return { ...t, v: '🧱 WALLED', d: `HTTP ${res.status}` };
    if (res.status >= 400) return { ...t, v: `❌ HTTP ${res.status}`, d: '' };

    // JSON?
    if (ct.includes('json')) {
      try {
        const j = JSON.parse(body);
        const arr = Array.isArray(j) ? j : Object.values(j).find((v) => Array.isArray(v) && v.length) || [];
        return { ...t, v: '✅ JSON API', d: `${arr.length} records | ${Object.keys(arr[0] || {}).slice(0, 8).join(', ')}` };
      } catch {}
    }
    // RSS?
    const items = body.match(/<item[\s>]/gi)?.length || 0;
    if (items) return { ...t, v: '✅ RSS', d: `${items} items` };

    // HTML — do we see job links / cards?
    const links = body.match(/href="[^"]*\/(job|jobs|listing|position|vacancy|careers)[^"]*"/gi)?.length || 0;
    const nextData = /__NEXT_DATA__|window\.__NUXT__|application\/ld\+json/.test(body);
    const title = body.match(/<title[^>]*>([\s\S]{0,80}?)<\/title>/i)?.[1].trim().replace(/\s+/g, ' ');
    return {
      ...t,
      v: links > 5 ? '✅ HTML (parseable)' : links > 0 ? '⚠️  HTML (thin)' : '⚠️  JS-rendered?',
      d: `${links} job links${nextData ? ' | has embedded JSON (__NEXT_DATA__/ld+json)' : ''} | "${title}"`,
    };
  } catch (e) {
    return { ...t, v: '💀 ERROR', d: e.message.slice(0, 70) };
  }
};

const results = await Promise.all(TARGETS.map(probe));
console.log(`\n${'═'.repeat(80)}\n  ROUND 3 — additional boards\n${'═'.repeat(80)}\n`);
for (const r of results) {
  console.log(`${r.v.padEnd(22)} ${r.name}`);
  if (r.d) console.log(`${' '.repeat(22)} ${r.d.slice(0, 130)}`);
}
console.log();
