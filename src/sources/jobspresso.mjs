/**
 * Jobspresso — a WordPress Job Manager board. Server-rendered, so cheerio is enough.
 *
 * Two quirks handled below:
 *  - Company and location share one element, separated by a "⚲" pin glyph.
 *  - Dates are month/day only ("June 30") with no year, so the year is inferred.
 *
 * Its search results also carry some obvious low-quality listings ("$1000 Weekly
 * Remote Virtual Assistant"). We don't special-case those — `excludeKeywords` in
 * config is the right lever if they become noise.
 */

import * as cheerio from 'cheerio';
import { getText, normalizeJob } from '../core.mjs';

const PIN = '⚲'; // ⚲ — separates company from location in the author block

/**
 * "June 30" has no year. Assume the most recent occurrence: this year, unless that
 * lands in the future, in which case it was last year.
 */
function inferDate(text) {
  if (!text) return null;
  const now = new Date();
  const parsed = new Date(`${text} ${now.getFullYear()}`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() > now.getTime() + 7 * 86400000) {
    parsed.setFullYear(now.getFullYear() - 1);
  }
  return parsed.toISOString();
}

export const jobspresso = {
  id: 'jobspresso',
  label: 'Jobspresso',
  kind: 'query',
  async fetch({ keywords, opts, limits }) {
    const terms = keywords?.length ? keywords : [''];
    const seen = new Set();
    const jobs = [];

    for (const term of terms) {
      try {
        const html = await getText(
          `https://jobspresso.co/?s=${encodeURIComponent(term)}&post_type=job_listing`,
          opts,
        );
        const $ = cheerio.load(html);

        $('.job_listing').each((_, el) => {
          const card = $(el);

          // The title anchor is the reliable link; the date anchor is a fallback.
          const link =
            card.find('h2.entry-title a, h3.entry-title a').first().attr('href') ||
            card.find('.entry-date a').first().attr('href');
          if (!link || seen.has(link)) return;
          seen.add(link);

          const title = card.find('h2.entry-title, h3.entry-title').first().text().trim();
          if (!title) return;

          const authorText = card.find('.entry-author__link').first().text().replace(/\s+/g, ' ');
          const [company, location] = authorText.split(PIN).map((s) => s.trim());

          // WP exposes taxonomy as classes: job_listing_category-full-time, job-type-support
          const tags = (card.attr('class') || '')
            .split(/\s+/)
            .filter((c) => c.startsWith('job_listing_category-') || c.startsWith('job-type-'))
            .map((c) => c.replace(/^job_listing_category-|^job-type-/, '').replace(/-/g, ' '));

          jobs.push(
            normalizeJob({
              source: 'jobspresso',
              externalId: link,
              title,
              company,
              location,
              remote: true, // Jobspresso is a remote-only board
              employmentType: tags[0] || null,
              salary: null,
              url: link,
              postedAt: inferDate(card.find('.entry-date').first().attr('value')),
              description: card.find('.entry-summary').first().html() || '',
              tags,
            }),
          );
        });
      } catch {
        /* one keyword failing shouldn't sink the source */
      }
    }

    return jobs.slice(0, limits?.perSource ?? 50);
  },
};
