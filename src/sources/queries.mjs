/**
 * Query sources: unlike feeds, these take a search term, so they cost one request
 * per keyword. Both are the sites' own internal JSON APIs — verified live, but
 * internal APIs move without notice, so each mapper is defensive.
 */

import { getJson, normalizeJob } from '../core.mjs';

const enc = encodeURIComponent;

/** Run a fetcher once per keyword and flatten, tolerating individual failures. */
async function perKeyword(keywords, fetchOne) {
  const terms = keywords?.length ? keywords : [''];
  const batches = await Promise.all(
    terms.map(async (term) => {
      try {
        return await fetchOne(term);
      } catch {
        return []; // one bad keyword shouldn't sink the whole source
      }
    }),
  );
  return batches.flat();
}

// ───────────────────────────────────────────────────────────────── JobStreet ──

export const jobstreet = {
  id: 'jobstreet',
  label: 'JobStreet PH',
  kind: 'query',
  async fetch({ keywords, opts, limits }) {
    const size = Math.min(limits?.perSource ?? 50, 100);

    return perKeyword(keywords, async (term) => {
      const url =
        'https://ph.jobstreet.com/api/jobsearch/v5/search' +
        `?siteKey=PH-Main&sourcesystem=houston&locale=en-PH&page=1&pageSize=${size}` +
        `&keywords=${enc(term)}`;
      const data = await getJson(url, opts);

      return (data.data || []).map((j) => {
        const arrangement = j.workArrangements?.displayText || '';
        // The list endpoint has no full description — teaser + bullets is what
        // exists without a second request. The URL carries the rest.
        const description = [j.teaser, ...(j.bulletPoints || [])].filter(Boolean).join('\n• ');

        return normalizeJob({
          source: 'jobstreet',
          externalId: j.id,
          title: j.title,
          company: j.advertiser?.description,
          location: (j.locations || []).map((l) => l.label).filter(Boolean).join(', '),
          remote: /remote/i.test(arrangement) ? true : /on-?site/i.test(arrangement) ? false : null,
          employmentType: [...(j.workTypes || []), arrangement].filter(Boolean).join(', '),
          salary: j.salaryLabel,
          url: `https://ph.jobstreet.com/job/${j.id}`,
          postedAt: j.listingDate,
          description,
          tags: (j.classifications || []).flatMap((c) =>
            [c.classification?.description, c.subclassification?.description].filter(Boolean),
          ),
        });
      });
    });
  },
};

// ─────────────────────────────────────────────────────────────────── Kalibrr ──

export const kalibrr = {
  id: 'kalibrr',
  label: 'Kalibrr',
  kind: 'query',
  async fetch({ keywords, opts, limits }) {
    const size = Math.min(limits?.perSource ?? 50, 100);

    return perKeyword(keywords, async (term) => {
      const url =
        'https://www.kalibrr.com/kjs/job_board/search' +
        `?limit=${size}&offset=0&text=${enc(term)}`;
      const data = await getJson(url, opts);

      return (data.jobs || []).map((j) => {
        const addr = j.google_location?.address_components || {};
        const location = [addr.city, addr.region, addr.country].filter(Boolean).join(', ');
        const salary =
          j.base_salary || j.maximum_salary
            ? [
                j.salary_currency || '',
                [j.base_salary, j.maximum_salary].filter(Boolean).join('–'),
                j.salary_interval ? `/ ${j.salary_interval}` : '',
              ]
                .filter(Boolean)
                .join(' ')
            : null;

        return normalizeJob({
          source: 'kalibrr',
          externalId: j.id,
          title: j.name,
          company: j.company_name || j.company?.name,
          location,
          remote: j.is_work_from_home === true ? true : j.is_hybrid === true ? null : false,
          employmentType: j.tenure,
          salary,
          // Company code + id + slug is Kalibrr's canonical posting URL.
          url:
            j.apply_redirect_url ||
            (j.company?.code
              ? `https://www.kalibrr.com/c/${j.company.code}/jobs/${j.id}/${j.slug || ''}`
              : `https://www.kalibrr.com/c/jobs/${j.id}`),
          postedAt: j.activation_date || j.created_at,
          description: j.description,
          tags: [j.function, j.education_level, j.work_experience].filter(Boolean),
        });
      });
    });
  },
};

export const querySources = [jobstreet, kalibrr];
