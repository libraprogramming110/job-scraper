/**
 * Remote Rocketship — a Next.js page, so the listings arrive as JSON embedded in
 * the __NEXT_DATA__ script tag. That's far more stable than scraping the rendered
 * markup, and needs no headless browser.
 *
 * Note: each item's `url` points at the employer's real ATS posting (Greenhouse,
 * Lever, …) rather than a Remote Rocketship page — which is the link you'd actually
 * apply through, so that's what we keep.
 */

import { getText, normalizeJob } from '../core.mjs';

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

export const remoterocketship = {
  id: 'remoterocketship',
  label: 'RemoteRocketship',
  kind: 'query',
  async fetch({ keywords, opts, limits }) {
    const terms = keywords?.length ? keywords : [''];
    const seen = new Set();
    const jobs = [];

    for (const term of terms) {
      try {
        const html = await getText(
          'https://www.remoterocketship.com/?page=1&sort=DateAdded' +
            `&searchQuery=${encodeURIComponent(term)}`,
          opts,
        );

        const raw = html.match(NEXT_DATA_RE)?.[1];
        if (!raw) throw new Error('__NEXT_DATA__ block not found (page structure changed)');

        const openings = JSON.parse(raw)?.props?.pageProps?.initialJobOpenings || [];

        for (const j of openings) {
          if (!j?.id || seen.has(j.id)) continue;
          seen.add(j.id);

          const seniority = [
            j.isEntryLevel && 'entry',
            j.isJunior && 'junior',
            j.isMidLevel && 'mid',
            j.isSenior && 'senior',
            j.isLead && 'lead',
          ].filter(Boolean);

          jobs.push(
            normalizeJob({
              source: 'remoterocketship',
              externalId: j.id,
              title: j.roleTitle,
              company: j.company?.name,
              location: [j.locationCity, j.location].filter(Boolean).join(', '),
              remote: /remote/i.test(j.locationType || '') ? true : null,
              employmentType: j.employmentType,
              salary: j.salaryRange,
              url: j.url,
              postedAt: j.created_at,
              description: j.jobDescriptionSummary || j.twoLineJobDescriptionSummary,
              tags: [j.categorizedJobFunction, j.categorizedJobTitle, ...seniority].filter(Boolean),
            }),
          );
        }
      } catch {
        /* one keyword failing shouldn't sink the source */
      }
    }

    return jobs.slice(0, limits?.perSource ?? 50);
  },
};
