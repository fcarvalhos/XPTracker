// Reads Discord and sends new characters to the Apps Script web app.
// Runs on GitHub Actions (see .github/workflows/discord-sync.yml). Node 20+, no dependencies.
const E = process.env;
for (const k of ['DISCORD_BOT_TOKEN', 'GUILD_ID', 'API_URL'])
  if (!E[k]) { console.error('Missing secret: ' + k); process.exit(1); }

const discord = async path => {
  const r = await fetch('https://discord.com/api/v10' + path, {
    headers: { Authorization: 'Bot ' + E.DISCORD_BOT_TOKEN, 'User-Agent': 'DiscordBot (https://github.com, 1.0)' } });
  const text = await r.text();
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status + ' ' + text.slice(0, 200));
  return JSON.parse(text);
};

const state = await (await fetch(E.API_URL)).json();
if (state.error) throw new Error('Apps Script: ' + state.error);
const knownThreads = new Set((state.people || []).map(p => p.thread).filter(Boolean));
const characters = [];
let lastMsgId = (state.meta || {}).lastMsgId || '';
let newLast = '';

// Mode 1: forum channel. Each new post is a character; the post title is its name.
if (E.CHARACTER_FORUM_ID) {
  const { threads = [] } = await discord(`/guilds/${E.GUILD_ID}/threads/active`);
  for (const t of threads)
    if (t.parent_id === E.CHARACTER_FORUM_ID && !knownThreads.has(t.id))
      characters.push({ name: t.name.trim(), thread: t.id, user: t.owner_id, level: 1 });
}

// Mode 2: one thread; players type  !character Name | level 3
if (E.CHARACTER_THREAD_ID) {
  const msgs = await discord(`/channels/${E.CHARACTER_THREAD_ID}/messages?limit=100` + (lastMsgId ? `&after=${lastMsgId}` : ''));
  msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const m of msgs) {
    newLast = m.id;
    const x = /^!(?:char(?:acter)?|newchar)\s+(.+?)(?:\s*\|\s*(?:lvl|level)\s*(\d+))?\s*$/i.exec((m.content || '').trim());
    if (x) characters.push({ name: x[1].trim(), user: m.author.id, level: x[2] ? +x[2] : 1 });
  }
}

console.log(`Found ${characters.length} new character(s)` + (characters.length ? ': ' + characters.map(c => c.name).join(', ') : ''));
if (characters.length || newLast) {
  const r = await fetch(E.API_URL, { method: 'POST', body: JSON.stringify({
    key: E.EDIT_KEY || '', action: 'discordSync', characters, lastMsgId: newLast }) });
  const j = await r.json();
  if (j.error) throw new Error('Apps Script: ' + j.error);
  console.log('Sent to the tracker.');
}
