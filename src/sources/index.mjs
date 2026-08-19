/**
 * Source registry + failure isolation.
 *
 * The rule this file exists to enforce: one broken source must never kill the run.
 * Every adapter is wrapped, every outcome is recorded, and the caller always gets a
 * per-source report — because a scraper that returns zero jobs silently is worse
 * than one that loudly says which source died.
 */

import { feedSources } from './feeds.mjs';
import { querySources } from './queries.mjs';
import { onlinejobsph } from './onlinejobsph.mjs';
import { remoterocketship } from './remoterocketship.mjs';
import { jobspresso } from './jobspresso.mjs';

/** Every adapter the system knows about. Add new ones here. */
export const ALL_SOURCES = [
  ...feedSources,
  ...querySources,
  onlinejobsph,
  remoterocketship,
  jobspresso,
];

export const sourceById = (id) => ALL_SOURCES.find((s) => s.id === id);

/** Enabled sources per config, preserving registry order. */
export function selectSources(config, only = null) {
  return ALL_SOURCES.filter((s) => {
    if (only?.length) return only.includes(s.id);
    return config.sources?.[s.id] !== false;
  });
}

/**
 * Run every source concurrently. Returns collected jobs plus a status row per
 * source — `ok` with a count, or `error` with the reason.
 */
export async function runSources(sources, { keywords = [], limits = {} } = {}) {
  const opts = { delayMs: limits.requestDelayMs ?? 300 };
  const perSource = limits.perSource ?? 50;

  const settled = await Promise.all(
    sources.map(async (source) => {
      const startedAt = Date.now();
      try {
        const jobs = await source.fetch({ keywords, opts, limits });
        const usable = (jobs || []).filter((j) => j && j.title && j.url);
        return {
          id: source.id,
          label: source.label,
          kind: source.kind,
          status: 'ok',
          fetched: jobs?.length ?? 0,
          kept: Math.min(usable.length, perSource),
          ms: Date.now() - startedAt,
          jobs: usable.slice(0, perSource),
        };
      } catch (error) {
        return {
          id: source.id,
          label: source.label,
          kind: source.kind,
          status: 'error',
          error: error?.message || String(error),
          ms: Date.now() - startedAt,
          jobs: [],
        };
      }
    }),
  );

  return {
    jobs: settled.flatMap((r) => r.jobs),
    report: settled.map(({ jobs, ...row }) => row),
  };
}
