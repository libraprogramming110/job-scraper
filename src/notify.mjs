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
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

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
 * Send the given jobs to a chat. Throws on any failure — the caller decides
 * whether that means "keep them un-seen".
 */
export async function sendTelegram(token, chatId, jobs, { jobsPerMessage = 8 } = {}) {
  if (!jobs.length) return { sent: 0 };

  const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const header = `<b>🆕 ${jobs.length} new job match${jobs.length > 1 ? 'es' : ''} — ${when}</b>`;
  const chunks = [];
  for (let i = 0; i < jobs.length; i += jobsPerMessage) {
    chunks.push(jobs.slice(i, i + jobsPerMessage));
  }

  let sent = 0;
  for (const chunk of chunks) {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        text: renderChunk(chunk, header),
      }),
    });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.description || 'Telegram send failed');
    sent += chunk.length;
  }
  return { sent };
}