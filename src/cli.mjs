#!/usr/bin/env node
/**
 * Entry point. Reads config.json, asks what to search for, runs every enabled
 * source, then writes out/jobs-latest.{json,md}.
 *
 * Flags (all optional — they skip the prompt):
 *   --keywords "a,b"    search for these instead of the config's searches
 *   --source remoteok   only this source (repeatable)
 *   --all               use config as-is, no prompt
 *   --limit 25          cap jobs taken per source
 *   --no-descriptions   skip the extra per-job detail requests
 *   --fresh             ignore the seen-cache; treat every job as new
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applyFilters, dedupe, fuzzyKey, rank, scoreJob } from './core.mjs';
import { loadSeen, saveSeen, splitNew, writeOutputs } from './output.mjs';
import { runSources, selectSources, ALL_SOURCES } from './sources/index.mjs';
import { sendTelegram } from './notify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { sources: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keywords') args.keywords = argv[++i];
    else if (a === '--source') args.sources.push(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--all') args.all = true;
    else if (a === '--fresh') args.fresh = true;
    else if (a === '--no-descriptions') args.noDescriptions = true;
  }
  return args;
}

const splitKeywords = (s) =>
  String(s || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

/** Load the Telegram secret file. Missing/incomplete = notifications off. */
async function loadTelegramConfig(root) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, 'telegram.json'), 'utf8'));
    return raw?.token && raw?.chatId ? raw : null;
  } catch {
    return null;
  }
}

/** Keywords from every enabled search block in config. */
const configKeywords = (config) =>
  (config.searches || [])
    .filter((s) => s.enabled !== false)
    .flatMap((s) => s.keywords || [])
    .filter(Boolean);

async function resolveKeywords(config, args) {
  if (args.keywords) return splitKeywords(args.keywords);

  const fromConfig = configKeywords(config);
  if (args.all || !process.stdin.isTTY) return fromConfig;

  console.log('\nSearches enabled in config.json:');
  for (const s of config.searches || []) {
    const mark = s.enabled === false ? ' (off)' : '';
    console.log(`  • ${s.label}${mark}: ${(s.keywords || []).join(', ')}`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    '\nPress Enter to use these, or type keywords (comma-separated) to override: ',
  );
  rl.close();

  const typed = splitKeywords(answer);
  return typed.length ? typed : fromConfig;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const configPath = path.join(ROOT, 'config.json');
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (e) {
    console.error(`Could not read config.json — ${e.message}`);
    process.exit(1);
  }

  const keywords = await resolveKeywords(config, args);
  const filters = config.filters || {};
  const limits = { ...(config.limits || {}) };
  if (args.limit) limits.perSource = args.limit;
  if (args.noDescriptions) limits.fetchDescriptions = false;

  const unknown = args.sources.filter((id) => !ALL_SOURCES.some((s) => s.id === id));
  if (unknown.length) {
    console.error(`Unknown source(s): ${unknown.join(', ')}`);
    console.error(`Available: ${ALL_SOURCES.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }

  const sources = selectSources(config, args.sources);
  if (!sources.length) {
    console.error('No sources enabled — check the "sources" block in config.json.');
    process.exit(1);
  }

  console.log(`\nSearching ${sources.length} source(s) for: ${keywords.join(', ') || '(everything)'}\n`);

  const { jobs: raw, report } = await runSources(sources, { keywords, limits });

  // score → sort → dedupe (keeps the highest-scoring copy) → filter → rank
  const scored = raw.map((job) => ({ ...job, ...scoreJob(job, keywords) }));
  scored.sort((a, b) => b.relevance - a.relevance);
  const unique = dedupe(scored);
  const { kept, dropped } = applyFilters(unique, filters);
  const jobs = rank(kept);

  const seenPath = path.join(ROOT, 'data', 'seen.json');
  const seen = args.fresh ? new Set() : await loadSeen(seenPath);
  const { fresh } = splitNew(jobs, seen);

  const outDir = path.join(ROOT, 'out');
  const written = await writeOutputs(outDir, { jobs, fresh, report, keywords, filters, dropped });

  // ── Telegram ──────────────────────────────────────────────────────────────
  // A failed delivery must not bury jobs: fresh keys only enter the seen-cache
  // once they've been successfully notified (or notifications are off entirely).
  const telegram = await loadTelegramConfig(ROOT);
  const notifyOn = config.notify?.enabled !== false && telegram;
  let notify = { failed: false, detail: 'not configured' };
  if (notifyOn && fresh.length) {
    try {
      const r = await sendTelegram(telegram.token, telegram.chatId, fresh, {
        jobsPerMessage: config.notify?.jobsPerMessage ?? 8,
      });
      notify = { failed: false, detail: `${r.sent} job(s) sent` };
    } catch (e) {
      notify = { failed: true, detail: e?.message || String(e) };
    }
  } else if (notifyOn && !fresh.length) {
    notify = { failed: false, detail: 'no new jobs' };
  }

  const freshKeys = new Set(fresh.map(fuzzyKey));
  for (const key of jobs.map(fuzzyKey)) {
    if (!(notify.failed && freshKeys.has(key))) seen.add(key);
  }
  await saveSeen(seenPath, seen);

  // ── run summary ──
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('SOURCE', 18)}${pad('STATUS', 10)}${pad('FETCHED', 9)}${pad('KEPT', 7)}TIME`);
  console.log('─'.repeat(56));
  for (const r of report) {
    const status = r.status === 'ok' ? 'ok' : 'FAILED';
    console.log(`${pad(r.label, 18)}${pad(status, 10)}${pad(r.fetched ?? 0, 9)}${pad(r.kept ?? 0, 7)}${r.ms}ms`);
    if (r.status === 'error') console.log(`${' '.repeat(18)}└─ ${r.error}`);
  }

  const filtered = Object.entries(dropped).filter(([, n]) => n > 0);
  console.log('─'.repeat(56));
  console.log(`Collected ${raw.length} → ${unique.length} unique → ${jobs.length} matched`);
  if (filtered.length) console.log(`Filtered out: ${filtered.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`New since last run: ${fresh.length}`);
  console.log(`Telegram: ${notify.failed ? 'FAILED — ' + notify.detail : notify.detail}`);
  console.log(`\n  ${path.relative(ROOT, written.mdPath)}   ← skim this`);
  console.log(`  ${path.relative(ROOT, written.jsonPath)} ← full data for tailoring\n`);
}

main().catch((e) => {
  console.error('\nRun failed:', e?.stack || e);
  process.exit(1);
});
