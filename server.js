require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const query = require('samp-query');
const { WebhookClient, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SAMP_HOST = process.env.SAMP_HOST || '141.94.184.106';
const SAMP_PORT = parseInt(process.env.SAMP_PORT, 10) || 1381;
const QUERY_INTERVAL = parseInt(process.env.QUERY_INTERVAL, 10) || 300000;
const WEBSITE_URL = process.env.WEBSITE_URL || '';
const CURRENT_EVENT = process.env.CURRENT_EVENT || '';
const SELF_PING_URL = process.env.SELF_PING_URL || '';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let peakPlayers = 0;
let cachedData = null;
let lastFetch = 0;
const CACHE_DURATION = 10000;

let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL !== 'YOUR_WEBHOOK_URL_HERE') {
  webhook = new WebhookClient({ url: WEBHOOK_URL });
  console.log('[✅] Discord Webhook დაკავშირებულია');
} else {
  console.log('[⚠️] WEBHOOK_URL არ არის დაყენებული - Discord-ში გაგზავნა გამორთულია');
}

function queryServer() {
  return new Promise((resolve) => {
    const start = Date.now();
    query({ host: SAMP_HOST, port: SAMP_PORT, timeout: 5000 }, (err, res) => {
      const ping = Date.now() - start;
      if (err) {
        resolve({
          status: 'offline', hostname: 'Metro City RP', players: [],
          maxPlayers: 0, currentPlayers: 0, peakPlayers, ping: '--',
          map: 'N/A', gamemode: 'N/A',
          time: new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' }),
          lastUpdate: new Date().toISOString(), serverIp: SAMP_HOST + ':' + SAMP_PORT
        });
      } else {
        const cur = res.online || 0;
        const max = res.maxplayers || 0;
        if (cur > peakPlayers) peakPlayers = cur;
        resolve({
          status: 'online', hostname: res.hostname || 'Metro City RP',
          players: (res.players || []).map(p => p.name),
          maxPlayers: max, currentPlayers: cur, peakPlayers, ping,
          map: res.mapname || 'N/A', gamemode: res.gamemode || 'N/A',
          time: new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' }),
          lastUpdate: new Date().toISOString(), serverIp: SAMP_HOST + ':' + SAMP_PORT
        });
      }
    });
  });
}

// ── Discord Bot Logic ──

const bar = (cur, max, len = 12) => {
  if (!max) return '░'.repeat(len);
  const f = Math.round((cur / max) * len);
  return '█'.repeat(f) + '░'.repeat(len - f);
};

const embedColor = (ratio) => {
  if (ratio < 0.3) return 0x00d4ff;
  if (ratio < 0.7) return 0xf1c40f;
  return 0xe74c3c;
};

const formatPlayers = (players) => {
  if (!players || players.length === 0) return null;
  return players.slice(0, 20).map((p, i) => '`' + String(i + 1).padStart(2, '0') + '.` ' + p.name).join('\n');
};

const now = () => new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' });

const buttons = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setLabel('🎮 სერვერზე შესვლა').setStyle(ButtonStyle.Link).setURL('https://u.tezgate.com/' + SAMP_HOST + ':' + SAMP_PORT),
  new ButtonBuilder().setLabel('🌐 ვებსაიტი').setStyle(ButtonStyle.Link).setURL(WEBSITE_URL || 'http://localhost:' + PORT),
);

const getBgPath = () => {
  const candidates = [
    path.join(__dirname, 'public', 'images', 'background.png'),
    path.join(__dirname, 'MetroCityWebsite', 'public', 'images', 'background.png'),
    path.join(__dirname, 'images', 'background.png'),
    path.join(__dirname, 'background.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const buildOnline = async (r, ping) => {
  const cur = r.online || 0;
  const max = r.maxplayers || 0;
  const ratio = max ? cur / max : 0;
  if (cur > peakPlayers) peakPlayers = cur;

  const playerNames = formatPlayers(r.players);
  const bgPath = getBgPath();
  const files = bgPath ? [new AttachmentBuilder(bgPath, { name: 'background.png' })] : [];

  const websiteUrl = WEBSITE_URL || 'https://metro-city-rp.onrender.com';
  const desc = [
    '```fix\n' + SAMP_HOST + ':' + SAMP_PORT + '```',
    '', '> **🟢 სტატუსი:** `ონლაინ`',
    '> **👥 მოთამაშეები:** `' + cur + ' / ' + max + '`',
    '> **🌐 ვებსაიტი:** ' + websiteUrl,
  ];
  if (cur > 0) desc.push('> **📊 პიკი:** `' + peakPlayers + '`');
  desc.push('', '```' + bar(cur, max) + '  ' + cur + '/' + max + '```');
  if (CURRENT_EVENT) desc.push('> **⭐ აქცია:** `' + CURRENT_EVENT + '`');
  desc.push('', '━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const fields = [
    { name: '📡 პინგი', value: '`' + ping + 'ms`', inline: true },
    { name: '🗺️ რუკა', value: '`' + (r.mapname || 'N/A') + '`', inline: true },
    { name: '⏰ დრო', value: '`' + now() + '`', inline: true },
  ];
  if (playerNames) fields.push({ name: '▸ ონლაინ მოთამაშეები', value: playerNames, inline: false });

  const embed = {
    title: '▣ ' + (r.hostname || 'Metro City RP'),
    color: embedColor(ratio), description: desc.join('\n'), fields,
    footer: { text: 'Metro City RP • 2026' }, timestamp: new Date().toISOString(),
  };
  if (bgPath) embed.image = { url: 'attachment://background.png' };

  return { files, embeds: [embed], components: [buttons] };
};

const buildOffline = async () => {
  const bgPath = getBgPath();
  const files = bgPath ? [new AttachmentBuilder(bgPath, { name: 'background.png' })] : [];

  const embed = {
    title: '▣ Metro City RP', color: 0xe74c3c,
    description: [
      '```fix\n' + SAMP_HOST + ':' + SAMP_PORT + '```',
      '', '> **🔴 სტატუსი:** `ოფლაინ`',
      '> **❌ სერვერი მიუწვდომელია**',
      '> **🌐 ვებსაიტი:** ' + (WEBSITE_URL || 'https://metro-city-rp.onrender.com'),
      '', '━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n'),
    fields: [
      { name: '📡 პინგი', value: '`—`', inline: true },
      { name: '🗺️ რუკა', value: '`—`', inline: true },
      { name: '⏰ დრო', value: '`' + now() + '`', inline: true },
    ],
    footer: { text: 'Metro City RP • 2026' }, timestamp: new Date().toISOString(),
  };
  if (bgPath) embed.image = { url: 'attachment://background.png' };

  return { files, embeds: [embed], components: [buttons] };
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const sendToDiscord = async (payload, retries = 3) => {
  if (!webhook) return;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await webhook.send(payload);
      console.log('[✅ DISCORD] ' + now());
      return;
    } catch (e) {
      console.error('[❌ DISCORD] მცდელობა ' + attempt + '/' + retries + ':', e.message);
      if (attempt < retries) await sleep(5000 * attempt);
    }
  }
  console.error('[❌ DISCORD] ყველა მცდელობა წარუმატებელია');
};

const queryAndSend = async () => {
  console.log('[⏳ QUERY] ' + SAMP_HOST + ':' + SAMP_PORT + ' ...');
  try {
    const start = Date.now();
    query({ host: SAMP_HOST, port: SAMP_PORT, timeout: 5000 }, async (err, res) => {
      const ping = Date.now() - start;
      if (err) {
        console.log('[⚠️ OFFLINE]', err.message || err);
        await sendToDiscord(await buildOffline());
      } else {
        console.log('[📊 ONLINE] ' + (res.online || 0) + '/' + (res.maxplayers || 0) + ' | ' + (res.mapname || 'N/A') + ' | ' + ping + 'ms');
        await sendToDiscord(await buildOnline(res, ping));
      }
    });
  } catch (e) {
    console.error('[❌ QUERY ERROR]', e.message);
  }
};

// ── Self-Ping: Render free tier არ ჩაქრობა ──

const selfPing = () => {
  if (!SELF_PING_URL) return;
  const url = SELF_PING_URL;
  console.log('[🔄 SELF-PING] ' + url);
  http.get(url, (res) => {
    console.log('[✅ SELF-PING] ' + res.statusCode);
  }).on('error', (e) => {
    console.error('[❌ SELF-PING]', e.message);
  });
};

// ── API Routes ──

app.get('/api/server-info', async (req, res) => {
  try {
    const now2 = Date.now();
    if (cachedData && (now2 - lastFetch) < CACHE_DURATION) return res.json(cachedData);
    const data = await queryServer();
    cachedData = data;
    lastFetch = now2;
    res.json(data);
  } catch (e) {
    console.error('API Error:', e.message);
    res.json({ status: 'offline', hostname: 'Metro City RP', players: [], maxPlayers: 0, currentPlayers: 0, peakPlayers: 0, ping: '--', map: 'N/A', gamemode: 'N/A', time: new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' }), lastUpdate: new Date().toISOString(), serverIp: SAMP_HOST + ':' + SAMP_PORT });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Start ──

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║     Metro City RP                 ║');
  console.log('  ╠═══════════════════════════════════╣');
  console.log('  ║  Website:  http://localhost:' + PORT + '  ║');
  console.log('  ║  Server:   ' + SAMP_HOST + ':' + SAMP_PORT + '           ║');
  console.log('  ║  Bot:      ' + (webhook ? 'ON' : 'OFF') + '                         ║');
  console.log('  ║  Interval: ' + (QUERY_INTERVAL / 60000) + ' min                  ║');
  console.log('  ║  Self-Ping: ' + (SELF_PING_URL ? 'ON' : 'OFF') + '                        ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');

  queryServer().then(data => { cachedData = data; lastFetch = Date.now(); });

  queryAndSend();
  setInterval(queryAndSend, QUERY_INTERVAL);

  if (SELF_PING_URL) {
    selfPing();
    setInterval(selfPing, 10 * 60 * 1000);
  }
});

process.on('SIGINT', () => { console.log('[🛑] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[🛑] Shutting down...'); process.exit(0); });
process.on('uncaughtException', (e) => { console.error('[💥 UNCAUGHT]', e.message); });
process.on('unhandledRejection', (e) => { console.error('[ERR]', e); });
