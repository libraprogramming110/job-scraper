/**
 * Output: the cross-run "seen" cache, plus the two files this whole system exists
 * to produce.
 *
 *   out/jobs-latest.json  — full records incl. descriptions. Claude reads this.
 *   out/jobs-latest.md    — new-since-last-run, ranked, linked. You skim this.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fuzzyKey } from './core.mjs';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ───────────────────────────────────────────────────────── cross-run dedupe ──

/** Keys of every job surfaced in a previous run. Missing/corrupt file = start clean. */
export async function loadSeen(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return new Set(Array.isArray(parsed.keys) ? parsed.keys : []);
  } catch {
    return new Set();
  }
}

export async function saveSeen(file, seen) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ updatedAt: new Date().toISOString(), keys: [...seen] }, null, 2),
    'utf8',
  );
}

/** Split ranked jobs into those never surfaced before and the rest. */
export function splitNew(jobs, seen) {
  const fresh = [];
  const previously = [];
  for (const job of jobs) (seen.has(fuzzyKey(job)) ? previously : fresh).push(job);
  return { fresh, previously };
}

// ────────────────────────────────────────────────────────────────── writers ──

function renderMarkdown({ jobs, fresh, report, keywords, filters, dropped }) {
  const L = [];
  const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  L.push(`# Job scrape — ${when}`, '');
  L.push(`**Keywords:** ${keywords.length ? keywords.map((k) => `\`${k}\``).join(', ') : '_none (everything)_'}`);
  L.push(
    `**Filters:** remote-only \`${!!filters.remoteOnly}\`` +
      (filters.employmentTypes?.length ? ` · types \`${filters.employmentTypes.join(', ')}\`` : '') +
      (filters.postedWithinDays != null ? ` · posted within \`${filters.postedWithinDays}d\`` : '') +
      (filters.minSalary != null ? ` · min salary \`${filters.minSalary}\`` : ''),
  );
  L.push('', `**${jobs.length} matches** · **${fresh.length} new since last run**`, '');

  // Per-source accounting — a zero must always be attributable.
  L.push('## Sources', '', '| Source | Status | Fetched | Kept | Time |', '|---|---|---:|---:|---:|');
  for (const r of report) {
    const status = r.status === 'ok' ? 'ok' : `**FAILED** — ${r.error}`;
    L.push(`| ${r.label} | ${status} | ${r.fetched ?? 0} | ${r.kept ?? 0} | ${r.ms}ms |`);
  }
  L.push('');

  if (dropped) {
    const bits = Object.entries(dropped).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`);
    if (bits.length) L.push(`_Filtered out — ${bits.join(', ')}_`, '');
  }

  const section = (heading, list) => {
    L.push(`## ${heading}`, '');
    if (!list.length) {
      L.push('_Nothing here._', '');
      return;
    }
    list.forEach((job, i) => {
      L.push(`### ${i + 1}. ${job.title}`);
      const meta = [
        `**${job.company}**`,
        job.location,
        job.salary,
        job.employmentType,
        `\`${job.source}\``,
        `relevance ${job.relevance}`,
      ].filter(Boolean);
      L.push(meta.join(' · '));
      if (job.postedAt) L.push(`Posted: ${job.postedAt.slice(0, 10)}`);
      L.push('', `🔗 ${job.url}`, '');
      const snippet = job.description.replace(/\s+/g, ' ').slice(0, 260).trim();
      if (snippet) L.push(`> ${snippet}${job.description.length > 260 ? '…' : ''}`, '');
    });
  };

  section(`New since last run (${fresh.length})`, fresh);

  const older = jobs.filter((j) => !fresh.includes(j));
  if (older.length) {
    L.push('---', '', `<details><summary>Previously seen (${older.length})</summary>`, '');
    older.forEach((job) => {
      L.push(`- **${job.title}** — ${job.company} · \`${job.source}\` · ${job.url}`);
    });
    L.push('', '</details>', '');
  }

  L.push('---', '', '_Full records with complete job descriptions: `out/jobs-latest.json`_', '');
  return L.join('\n');
}

/** Write the JSON payload, the Markdown digest, and a timestamped archive copy. */
export async function writeOutputs(outDir, payload) {
  const { jobs, fresh, report, keywords, filters, dropped } = payload;
  await fs.mkdir(path.join(outDir, 'runs'), { recursive: true });

  const json = {
    generatedAt: new Date().toISOString(),
    keywords,
    filters,
    counts: { matched: jobs.length, new: fresh.length },
    sources: report,
    droppedByFilter: dropped,
    jobs,
  };

  const jsonPath = path.join(outDir, 'jobs-latest.json');
  const mdPath = path.join(outDir, 'jobs-latest.md');
  const archivePath = path.join(outDir, 'runs', `jobs-${stamp()}.json`);
  const body = JSON.stringify(json, null, 2);

  await fs.writeFile(jsonPath, body, 'utf8');
  await fs.writeFile(archivePath, body, 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(payload), 'utf8');

  return { jsonPath, mdPath, archivePath };
}
