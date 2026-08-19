/**
 * sync-seen.mjs — race-safe commit & push of data/seen.json.
 *
 * Why this exists: every workflow run checks out the repo at its DISPATCH SHA
 * (actions/checkout pins github.sha), so a run queued behind another can push
 * with a stale base and get "fetch first" rejected. A plain `git pull --rebase`
 * then conflicts, because seen.json is structured JSON and both runs touch the
 * same keys array — and taking either side LOSES keys, which means re-alerting
 * jobs already seen.
 *
 * This script merges seen.json SEMANTICALLY (keys = union, updatedAt = newest),
 * so the merge is well-defined and lossless no matter how many runs raced, then
 * re-parents onto the latest origin/main (git reset --soft) so the push is
 * always fast-forward, retrying for the last-writer window.
 *
 * Usage (from repo root): node scripts/sync-seen.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Run from the repo root (as the workflows do): all git and file paths are
// relative to the current working directory so they always stay in sync.
const SEEN = path.join(process.cwd(), 'data', 'seen.json');
const MAX_PUSH_ATTEMPTS = 5;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function parseState(text) {
  if (!text) return { updatedAt: '', keys: [] };
  try {
    const parsed = JSON.parse(text);
    return { updatedAt: parsed.updatedAt ?? '', keys: Array.isArray(parsed.keys) ? parsed.keys : [] };
  } catch {
    return { updatedAt: '', keys: [] };
  }
}

function readLocal() {
  try {
    return parseState(fs.readFileSync(SEEN, 'utf8'));
  } catch {
    return { updatedAt: '', keys: [] };
  }
}

function readRemote() {
  const text = tryGit(['show', 'origin/main:data/seen.json']);
  return parseState(text);
}

/** Union of keys; newest updatedAt. Deterministic ordering keeps diffs minimal. */
function mergeStates(local, remote) {
  const keys = [...new Set([...local.keys, ...remote.keys])].sort();
  const updatedAt = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().at(-1) ?? new Date().toISOString();
  return { updatedAt, keys };
}

function writeState(state) {
  fs.mkdirSync(path.dirname(SEEN), { recursive: true });
  fs.writeFileSync(SEEN, JSON.stringify({ updatedAt: state.updatedAt, keys: state.keys }, null, 2) + '\n');
}

git(['config', 'user.name', 'job-scraper bot']);
git(['config', 'user.email', 'actions@github.com']);

for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
  tryGit(['fetch', 'origin', 'main']);
  const merged = mergeStates(readLocal(), readRemote());
  writeState(merged);

  // Stage ONLY our state file, then re-parent onto the latest remote tip.
  git(['add', 'data/seen.json']);
  tryGit(['reset', '--soft', 'origin/main']);
  tryGit(['commit', '-m', 'chore: update seen.json', '--no-verify']);

  try {
    git(['push', 'origin', 'HEAD:main']);
    console.log('seen.json synced to origin/main');
    process.exit(0);
  } catch {
    if (attempt === MAX_PUSH_ATTEMPTS) {
      console.error(`seen.json push failed after ${MAX_PUSH_ATTEMPTS} attempts`);
      process.exit(1);
    }
    console.log(`push rejected (attempt ${attempt}/${MAX_PUSH_ATTEMPTS}); refetching…`);
  }
}