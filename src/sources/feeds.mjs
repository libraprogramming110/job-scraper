/**
 * Feed sources: they publish their whole recent listing set, so we fetch once and
 * filter locally. Keywords are ignored here — core.mjs does the matching.
 *
 * Field mappings below were verified against live responses (see SOURCES.md).
 * When one breaks, only its own mapper needs fixing.
 */

import { getJson, getText, normalizeJob, toIso } from '../core.mjs';

/** Build a readable salary string out of the min/max/currency/period fields sources use. */
function salaryRange(min, max, currency, period) {
  const lo = Number(min) || null;
  const hi = Number(max) || null;
  if (!lo && !hi) return null;
  const cur = currency || 'USD';
  const fmt = (n) => n.toLocaleString('en-US');
  const body = lo && hi ? `${fmt(lo)}–${fmt(hi)}` : fmt(lo || hi);
  return `${cur} ${body}${period ? ` / ${period}` : ''}`;
}

/** Pull the inner text of an XML tag out of a chunk of RSS. */
const xmlTag = (chunk, tag) => {
  const m = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
};

// ─────────────────────────────────────────────────────────────────────────────

export const remoteok = {
  id: 'remoteok',
  label: 'RemoteOK',
  kind: 'feed',
  async fetch({ opts }) {
    const rows = await getJson('https://remoteok.com/api', opts);
    // Element 0 is a legal notice, not a job — real postings have `position`.
    return rows
      .filter((r) => r && r.position)
      .map((r) =>
        normalizeJob({
          source: 'remoteok',
          externalId: r.id,
          title: r.position,
          company: r.company,
          location: r.location,
          remote: true,
          employmentType: null,
          salary: salaryRange(r.salary_min, r.salary_max, 'USD', 'year'),
          url: r.url || (r.slug ? `https://remoteok.com/remote-jobs/${r.slug}` : null),
          postedAt: r.epoch || r.date,
          description: r.description,
          tags: r.tags,
        }),
      );
  },
};

export const remotive = {
  id: 'remotive',
  label: 'Remotive',
  kind: 'feed',
  async fetch({ opts }) {
    const data = await getJson('https://remotive.com/api/remote-jobs?limit=200', opts);
    return (data.jobs || []).map((j) =>
      normalizeJob({
        source: 'remotive',
        externalId: j.id,
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location,
        remote: true,
        employmentType: j.job_type,
        salary: j.salary || null,
        url: j.url,
        postedAt: j.publication_date,
        description: j.description,
        tags: [...(j.tags || []), j.category].filter(Boolean),
      }),
    );
  },
};

export const jobicy = {
  id: 'jobicy',
  label: 'Jobicy',
  kind: 'feed',
  async fetch({ opts }) {
    const data = await getJson('https://jobicy.com/api/v2/remote-jobs?count=50', opts);
    return (data.jobs || []).map((j) =>
      normalizeJob({
        source: 'jobicy',
        externalId: j.id,
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo,
        remote: true,
        employmentType: Array.isArray(j.jobType) ? j.jobType.join(', ') : j.jobType,
        salary: salaryRange(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod),
        url: j.url,
        postedAt: j.pubDate,
        description: j.jobDescription || j.jobExcerpt,
        tags: [
          ...(Array.isArray(j.jobIndustry) ? j.jobIndustry : [j.jobIndustry]),
          j.jobLevel,
        ].filter(Boolean),
      }),
    );
  },
};

export const himalayas = {
  id: 'himalayas',
  label: 'Himalayas',
  kind: 'feed',
  async fetch({ opts }) {
    const data = await getJson('https://himalayas.app/jobs/api?limit=100', opts);
    return (data.jobs || []).map((j) =>
      normalizeJob({
        source: 'himalayas',
        // No numeric id in the payload — the canonical link is the stable identity.
        externalId: j.guid || j.applicationLink,
        title: j.title,
        company: j.companyName,
        location: Array.isArray(j.locationRestrictions)
          ? j.locationRestrictions.join(', ')
          : j.locationRestrictions,
        remote: true,
        employmentType: j.employmentType,
        salary: salaryRange(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod),
        url: j.applicationLink || j.guid,
        postedAt: j.pubDate, // unix seconds, as a string
        description: j.description || j.excerpt,
        tags: [
          ...(Array.isArray(j.categories) ? j.categories : []),
          j.seniority,
        ].filter(Boolean),
      }),
    );
  },
};

export const arbeitnow = {
  id: 'arbeitnow',
  label: 'Arbeitnow',
  kind: 'feed',
  async fetch({ opts }) {
    const data = await getJson('https://www.arbeitnow.com/api/job-board-api', opts);
    return (data.data || []).map((j) =>
      normalizeJob({
        source: 'arbeitnow',
        externalId: j.slug,
        title: j.title,
        company: j.company_name,
        location: j.location,
        remote: j.remote === true ? true : null,
        employmentType: (j.job_types || []).join(', ') || null,
        salary: null,
        url: j.url,
        postedAt: j.created_at,
        description: j.description,
        tags: j.tags,
      }),
    );
  },
};

export const weworkremotely = {
  id: 'weworkremotely',
  label: 'WeWorkRemotely',
  kind: 'feed',
  async fetch({ opts }) {
    const xml = await getText('https://weworkremotely.com/remote-jobs.rss', opts);
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    return items.map((item) => {
      // WWR packs "Company: Position" into a single <title>.
      const raw = xmlTag(item, 'title');
      const split = raw.indexOf(': ');
      const company = split > 0 ? raw.slice(0, split) : 'Unknown';
      const title = split > 0 ? raw.slice(split + 2) : raw;
      return normalizeJob({
        source: 'weworkremotely',
        externalId: xmlTag(item, 'guid') || xmlTag(item, 'link'),
        title,
        company,
        location: xmlTag(item, 'region') || xmlTag(item, 'country') || null,
        remote: true,
        employmentType: xmlTag(item, 'type') || null,
        salary: null,
        url: xmlTag(item, 'link'),
        postedAt: xmlTag(item, 'pubDate'),
        description: xmlTag(item, 'description'),
        tags: [xmlTag(item, 'category'), xmlTag(item, 'skills')].filter(Boolean),
      });
    });
  },
};

export const workingnomads = {
  id: 'workingnomads',
  label: 'WorkingNomads',
  kind: 'feed',
  async fetch({ opts }) {
    const rows = await getJson('https://www.workingnomads.com/api/exposed_jobs/', opts);
    return (Array.isArray(rows) ? rows : []).map((j) =>
      normalizeJob({
        source: 'workingnomads',
        externalId: j.url,
        title: j.title,
        company: j.company_name,
        location: j.location,
        remote: true,
        employmentType: null,
        salary: null,
        url: j.url,
        postedAt: j.pub_date,
        description: j.description,
        tags: [j.category_name, ...String(j.tags || '').split(',')].filter(Boolean),
      }),
    );
  },
};

export const feedSources = [
  remoteok,
  remotive,
  jobicy,
  himalayas,
  arbeitnow,
  weworkremotely,
  workingnomads,
];
