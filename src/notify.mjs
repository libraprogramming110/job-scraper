/**
 * Telegram notifications: push new-since-last-run jobs to a personal bot.
 *
 * Secrets live in telegram.json (gitignored) — { token, chatId }. The bot token
 * must never end up in version control; config.json only toggles behavior.
 *
 * Sending is one HTTP POST per message via the free Bot API. No dependency.
 */

const API = 'https://api.telegram.org';

const SOURCE_LABELS = {
  remoteok: 'RemoteOK',
  remotive: 'Remotive',
  jobicy: 'Jobicy',
  himalayas: 'Himalayas',
  arbeitnow: 'Arbeitnow',
  weworkremotely: 'WWR',
  workingnomads: 'WorkingNomads',
  jobstreet: 'JobStreet',
  kalibrr: 'Kalibrr',
  onlinejobsph: 'OnlineJobs.PH',
  jobspresso: 'Jobspresso',
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const snippet = (job, max = 160) => {
  const text = String(job.description || '').replace(/\s+/g, ' ').trim();
  // Slice by code point, not UTF-16 unit — cutting an emoji in half leaves a lone
  // surrogate, which Telegram rejects (HTTP 400) and blocks the whole message.
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
};

/** One sendMessage call. Throws with Telegram's own reason on any failure. */
async function post(token, chatId, text, { preview = false } = {}) {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: !preview,
      text,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram HTTP ${res.status}: ${body.description || 'send failed'}`);
  }
}

function renderChunk(jobs, header) {
  const L = [header, ''];
  jobs.forEach((job, i) => {
    const meta = [
      job.salary,
      SOURCE_LABELS[job.source] || job.source,
      job.postedAt ? `posted ${job.postedAt.slice(0, 10)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    L.push(
      `<b>${i + 1}. ${esc(job.title)}</b>`,
      esc(meta),
      esc(snippet(job)),
      `🔗 ${esc(job.url || '')}`,
      '',
    );
  });
  return L.join('\n');
}

/**
 * Send the given jobs to a chat. If a combined message fails, its jobs are retried
 * one per message, so a single bad posting can't block the rest. Returns the jobs
 * that still failed — the caller keeps those un-seen for the next run.
 */
export async function sendTelegram(token, chatId, jobs, { jobsPerMessage = 8 } = {}) {
  if (!jobs.length) return { sent: 0 };

  const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
  const header = `<b>🆕 ${jobs.length} new job match${jobs.length > 1 ? 'es' : ''} — ${when}</b>`;
  const chunks = [];
  for (let i = 0; i < jobs.length; i += jobsPerMessage) {
    chunks.push(jobs.slice(i, i + jobsPerMessage));
  }

  let sent = 0;
  const failed = [];
  let error = null;
  for (const chunk of chunks) {
    try {
      await post(token, chatId, renderChunk(chunk, header), { preview: true });
      sent += chunk.length;
      continue;
    } catch (e) {
      if (chunk.length === 1) {
        failed.push(chunk[0]);
        error = e.message;
        continue;
      }
    }
    for (const job of chunk) {
      try {
        await post(token, chatId, renderChunk([job], header), { preview: true });
        sent += 1;
      } catch (e) {
        failed.push(job);
        error = e.message;
      }
    }
  }
  return { sent, failed, error };
}

/**
 * Send a run-summary heartbeat — sources, counts, failures — even when nothing
 * new was found. Without this, a healthy quiet run and a dead pipeline are the
 * same observable event: no message. Throws on failure, like sendTelegram.
 */
export async function sendDigest(token, chatId, { report = [], counts = {}, dropped = {} } = {}) {
  const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
  const ok = report.filter((r) => r.status === 'ok');
  const failed = report.filter((r) => r.status !== 'ok');

  const L = [
    `<b>📊 Daily sweep — ${esc(when)}</b>`,
    `${counts.raw ?? 0} scraped → ${counts.matched ?? 0} matched → <b>${counts.fresh ?? 0} new</b>`,
    '',
  ];

  if (ok.length) {
    L.push(
      esc(ok.map((r) => `${SOURCE_LABELS[r.id] || r.label} ${r.fetched ?? 0}`).join(' · ')),
      '',
    );
  }

  for (const r of failed) {
    L.push(`⚠️ <b>FAILED</b>: ${esc(SOURCE_LABELS[r.id] || r.label)} — ${esc(r.error || 'unknown error')}`);
  }
  if (failed.length) L.push('');

  const bits = Object.entries(dropped)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`);
  if (bits.length) L.push(`<i>Filtered: ${esc(bits.join(', '))}</i>`);

  await post(token, chatId, L.join('\n'));
  return { sent: 1 };
}
