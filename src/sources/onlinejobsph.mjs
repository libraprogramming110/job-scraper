/**
 * OnlineJobs.PH — the strongest source for PH remote/VA work, and the only one
 * that needs two passes.
 *
 * The search page's cards proved unreliable to parse (duplicate and empty anchors),
 * but the *detail* pages are clean and structured: an <h1> title, <h3> label
 * headings for salary/type/hours, and a single #job-description block. So we take
 * the links from search and read everything from the detail pages.
 *
 * That costs one request per job, which is why it's gated behind
 * `limits.fetchDescriptions` and capped by `limits.maxDetailFetches`.
 */

import * as cheerio from 'cheerio';
import { getText, normalizeJob } from '../core.mjs';

const BASE = 'https://www.onlinejobs.ph';

/** Trailing digits of the slug are OnlineJobs.PH's post id. */
const idFromHref = (href) => href.match(/-(\d+)\/?$/)?.[1] || href;

/** Readable fallback title when we haven't fetched the detail page. */
const titleFromHref = (href) =>
  (href.split('/').pop() || '')
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** "500" → "$500", but "Negotiable" is left alone. */
function formatSalary(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  return /^[\d.,]/.test(text) ? `$${text.replace(/^\$/, '')}` : text;
}

/** Collect unique job links from one search results page. */
async function searchLinks(term, opts) {
  const html = await getText(
    `${BASE}/jobseekers/jobsearch?jobkeyword=${encodeURIComponent(term)}`,
    opts,
  );
  const $ = cheerio.load(html);
  const hrefs = new Set();
  $('a[href^="/jobseekers/job/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) hrefs.add(href.split('?')[0]);
  });
  return [...hrefs];
}

/** Read one posting. Returns null on failure so a single bad page can't break the run. */
async function fetchDetail(href, opts) {
  try {
    const html = await getText(`${BASE}${href}`, opts);
    const $ = cheerio.load(html);

    // Label/value pairs live as <h3>LABEL</h3> followed by the value element.
    const fields = {};
    $('h3').each((_, el) => {
      const label = $(el).text().replace(/\s+/g, ' ').trim().toUpperCase();
      const value = $(el).next().text().replace(/\s+/g, ' ').trim();
      if (label && value) fields[label] = value;
    });

    const description = $('#job-description').first().html() || '';

    return {
      title: $('h1').first().text().replace(/\s+/g, ' ').trim() || titleFromHref(href),
      salary: fields['WAGE / SALARY'] || fields['SALARY'] || null,
      employmentType: fields['TYPE OF WORK'] || null,
      hours: fields['HOURS PER WEEK'] || null,
      postedAt: fields['DATE UPDATED'] || fields['DATE POSTED'] || null,
      description,
    };
  } catch {
    return null;
  }
}

export const onlinejobsph = {
  id: 'onlinejobsph',
  label: 'OnlineJobs.PH',
  kind: 'query',
  async fetch({ keywords, opts, limits }) {
    const terms = keywords?.length ? keywords : [''];

    // Gather links across every keyword first, so the detail-fetch budget is spent
    // on a deduplicated set rather than the same posting twice.
    const hrefs = new Set();
    for (const term of terms) {
      try {
        for (const href of await searchLinks(term, opts)) hrefs.add(href);
      } catch {
        /* one bad keyword shouldn't sink the source */
      }
    }

    const links = [...hrefs].slice(0, limits?.perSource ?? 50);
    const wantDetails = limits?.fetchDescriptions !== false;
    const budget = wantDetails ? (limits?.maxDetailFetches ?? 40) : 0;

    const jobs = [];
    for (const [i, href] of links.entries()) {
      const detail = i < budget ? await fetchDetail(href, opts) : null;

      jobs.push(
        normalizeJob({
          source: 'onlinejobsph',
          externalId: idFromHref(href),
          title: detail?.title || titleFromHref(href),
          // OnlineJobs.PH hides the employer behind a login, so there is no
          // company name to read on a public page.
          company: 'OnlineJobs.PH employer',
          location: 'Philippines (remote)',
          remote: true, // the entire board is remote work
          employmentType: [detail?.employmentType, detail?.hours ? `${detail.hours} hrs/wk` : null]
            .filter(Boolean)
            .join(', '),
          // Values are bare numbers ("500") or free text ("Negotiable") — only
          // the numeric form should get a currency prefix.
          salary: formatSalary(detail?.salary),
          url: `${BASE}${href}`,
          postedAt: detail?.postedAt,
          description: detail?.description || '',
          tags: [],
        }),
      );
    }

    return jobs;
  },
};
