require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const query = require('samp-query');
const { Client, GatewayIntentBits, WebhookClient, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Status Bot Env ──
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SAMP_HOST = process.env.SAMP_HOST || '141.94.184.106';
const SAMP_PORT = parseInt(process.env.SAMP_PORT, 10) || 1381;
const QUERY_INTERVAL = parseInt(process.env.QUERY_INTERVAL, 10) || 300000;
const WEBSITE_URL = process.env.WEBSITE_URL || '';
const CURRENT_EVENT = process.env.CURRENT_EVENT || '';
const SELF_PING_URL = process.env.SELF_PING_URL || '';

// ── Welcome/Leave Bot Env ──
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const WELCOME_WEBHOOK_URL = process.env.WELCOME_WEBHOOK;
const LEAVE_WEBHOOK_URL = process.env.LEAVE_WEBHOOK;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════
//  STATUS BOT (SA-MP Query + Webhook)
// ══════════════════════════════════════

let peakPlayers = 0;
let cachedData = null;
let lastFetch = 0;
const CACHE_DURATION = 10000;

let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL !== 'YOUR_WEBHOOK_URL_HERE') {
  webhook = new WebhookClient({ url: WEBHOOK_URL });
  console.log('[✅] Status Webhook დაკავშირებულია');
} else {
  console.log('[⚠️] WEBHOOK_URL არ არის დაყენებული');
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
        const players = res.players || [];
        const avgPing = players.length > 0
          ? Math.round(players.reduce((sum, p) => sum + (p.ping || 0), 0) / players.length) : 0;
        resolve({
          status: 'online', hostname: res.hostname || 'Metro City RP',
          players: players.map(p => p.name),
          playerPings: players.map(p => p.ping || 0),
          avgPing, maxPlayers: max, currentPlayers: cur, peakPlayers, ping,
          map: res.mapname || 'N/A', gamemode: res.gamemode || 'N/A',
          time: new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' }),
          lastUpdate: new Date().toISOString(), serverIp: SAMP_HOST + ':' + SAMP_PORT
        });
      }
    });
  });
}

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
  return players.slice(0, 20).map((p, i) => {
    const pingStr = p.ping ? ' `[' + p.ping + ']`' : '';
    return '`' + String(i + 1).padStart(2, '0') + '.` ' + p.name + pingStr;
  }).join('\n');
};

const now = () => new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' });

const buttons = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setLabel('🎮 სერვერზე შესვლა').setStyle(ButtonStyle.Link).setURL('https://u.tezgate.com/' + SAMP_HOST + ':' + SAMP_PORT),
  new ButtonBuilder().setLabel('🌐 ვებსაიტი').setStyle(ButtonStyle.Link).setURL(WEBSITE_URL || 'http://localhost:' + PORT),
);

const getBgPath = () => {
  const candidates = [
    path.join(__dirname, 'public', 'images', 'background.png'),
    path.join(__dirname, 'images', 'background.png'),
    path.join(__dirname, 'background.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const buildOnline = async (r, queryPing) => {
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
      console.log('[✅ STATUS] ' + now());
      return;
    } catch (e) {
      console.error('[❌ STATUS] მცდელობა ' + attempt + '/' + retries + ':', e.message);
      if (attempt < retries) await sleep(5000 * attempt);
    }
  }
};

const queryAndSend = async () => {
  console.log('[⏳ QUERY] ' + SAMP_HOST + ':' + SAMP_PORT + ' ...');
  try {
    const start = Date.now();
    query({ host: SAMP_HOST, port: SAMP_PORT, timeout: 5000 }, async (err, res) => {
      const queryPing = Date.now() - start;
      if (err) {
        console.log('[⚠️ OFFLINE]', err.message || err);
        await sendToDiscord(await buildOffline());
      } else {
        const cur = res.online || 0;
        const players = res.players || [];
        const avgPing = players.length > 0
          ? Math.round(players.reduce((sum, p) => sum + (p.ping || 0), 0) / players.length) : 0;
        console.log('[📊 ONLINE] ' + cur + '/' + (res.maxplayers || 0) + ' | ' + (res.mapname || 'N/A'));
        await sendToDiscord(await buildOnline({ ...res, avgPing }, queryPing));
      }
    });
  } catch (e) {
    console.error('[❌ QUERY ERROR]', e.message);
  }
};

// ══════════════════════════════════════
//  WELCOME/LEAVE BOT (Discord Client)
// ══════════════════════════════════════

const NEON_WELCOME = [0x00FFFF, 0x00D4FF, 0x00FF88, 0x00D4FF, 0x00FFFF, 0x7B68EE, 0x00D4FF];
const NEON_LEAVE = [0xFF00FF, 0xFF4444, 0xFF0088, 0xFF4444, 0xFF00FF, 0xFF1493, 0xE74C3C];

let welcomeWebhook = null;
let leaveWebhook = null;
let discordBot = null;

if (WELCOME_WEBHOOK_URL) {
  welcomeWebhook = new WebhookClient({ url: WELCOME_WEBHOOK_URL });
  console.log('[✅] Welcome Webhook დაკავშირებულია');
}
if (LEAVE_WEBHOOK_URL) {
  leaveWebhook = new WebhookClient({ url: LEAVE_WEBHOOK_URL });
  console.log('[✅] Leave Webhook დაკავშირებულია');
}

function buildWelcomeEmbed(member) {
  const memberCount = member.guild.memberCount;
  return new EmbedBuilder()
    .setTitle('𝖂𝖊𝖑𝖈𝖔𝖒𝖊 🌴')
    .setDescription([
      '> 🏙️ **მოგესალმებით Metro City RP-ში!**',
      '',
      `\`\`\`მომხმარებელი: ${member.user.tag}\`\`\``,
      '',
      '> **📊 სტატისტიკა:**',
      `> \`\`\`მოთამაშეები: ${memberCount}\`\`\``,
      '',
      '> 🚔 **დაიცავი წესები და ისიამოვნე თამაშით!**',
    ].join('\n'))
    .setColor(NEON_WELCOME[0])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Metro City RP • 2026' })
    .setTimestamp();
}

function buildLeaveEmbed(member) {
  const memberCount = member.guild.memberCount;
  return new EmbedBuilder()
    .setTitle('𝕷𝖊𝖆𝖛𝖊 🏙️')
    .setDescription([
      '> 💨 **მომხმარებელმა დატოვა სერვერი**',
      '',
      `\`\`\`მომხმარებელი: ${member.user.tag}\`\`\``,
      '',
      '> **📊 სტატისტიკა:**',
      `> \`\`\`დარჩენილი: ${memberCount}\`\`\``,
    ].join('\n'))
    .setColor(NEON_LEAVE[0])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Metro City RP • 2026' })
    .setTimestamp();
}

async function neonFlash(webhookClient, embed, colors, label) {
  try {
    const msg = await webhookClient.send({ embeds: [embed] });
    console.log('[✅ ' + label + '] გაიგზავნა ' + now());
    for (const color of colors) {
      await sleep(400);
      try {
        await webhookClient.editMessage(msg, { embeds: [EmbedBuilder.from(embed).setColor(color)] });
      } catch (e) { break; }
    }
    console.log('[✨ ' + label + '] neon flash დასრულდა');
  } catch (error) {
    console.error('[❌ ' + label + '] ' + error.message);
  }
}

function startWelcomeBot() {
  if (!BOT_TOKEN) {
    console.log('[⚠️] DISCORD_BOT_TOKEN არ არის - Welcome/Leave bot გამორთულია');
    return;
  }

  discordBot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  discordBot.on('guildMemberAdd', async (member) => {
    console.log('[👋 JOIN] ' + member.user.tag + ' | ' + member.guild.name);
    if (welcomeWebhook) {
      await neonFlash(welcomeWebhook, buildWelcomeEmbed(member), NEON_WELCOME, 'WELCOME');
    }
  });

  discordBot.on('guildMemberRemove', async (member) => {
    console.log('[👋 LEAVE] ' + member.user.tag + ' | ' + member.guild.name);
    if (leaveWebhook) {
      await neonFlash(leaveWebhook, buildLeaveEmbed(member), NEON_LEAVE, 'LEAVE');
    }
  });

  discordBot.once('ready', () => {
    console.log('[✅] Welcome/Leave Bot: ' + discordBot.user.tag + ' | Servers: ' + discordBot.guilds.cache.size);
  });

  discordBot.login(BOT_TOKEN).catch(e => {
    console.error('[❌] Bot Login Error:', e.message);
  });
}

// ══════════════════════════════════════
//  SELF-PING
// ══════════════════════════════════════

const selfPing = () => {
  if (!SELF_PING_URL) return;
  http.get(SELF_PING_URL, (res) => {
    console.log('[✅ SELF-PING] ' + res.statusCode);
  }).on('error', (e) => {
    console.error('[❌ SELF-PING]', e.message);
  });
};

// ══════════════════════════════════════
//  API Routes
// ══════════════════════════════════════

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
    res.json({ status: 'offline', hostname: 'Metro City RP', players: [], maxPlayers: 0, currentPlayers: 0, peakPlayers: 0, ping: '--', map: 'N/A', gamemode: 'N/A', time: now(), lastUpdate: new Date().toISOString(), serverIp: SAMP_HOST + ':' + SAMP_PORT });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ══════════════════════════════════════
//  START
// ══════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║       Metro City RP - All in One      ║');
  console.log('  ╠═══════════════════════════════════════╣');
  console.log('  ║  Website:   http://localhost:' + PORT + '      ║');
  console.log('  ║  Server:    ' + SAMP_HOST + ':' + SAMP_PORT + '              ║');
  console.log('  ║  Status:    ' + (webhook ? '✅' : '❌') + '                          ║');
  console.log('  ║  Welcome:   ' + (welcomeWebhook ? '✅' : '❌') + '                          ║');
  console.log('  ║  Leave:     ' + (leaveWebhook ? '✅' : '❌') + '                          ║');
  console.log('  ║  Bot:       ' + (BOT_TOKEN ? '✅' : '❌') + '                          ║');
  console.log('  ║  Self-Ping: ' + (SELF_PING_URL ? '✅' : '❌') + '                          ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');

  queryServer().then(data => { cachedData = data; lastFetch = Date.now(); });
  queryAndSend();
  setInterval(queryAndSend, QUERY_INTERVAL);

  if (SELF_PING_URL) {
    selfPing();
    setInterval(selfPing, 10 * 60 * 1000);
  }

  startWelcomeBot();
});

process.on('SIGINT', () => {
  console.log('[🛑] Shutting down...');
  if (discordBot) discordBot.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[🛑] Shutting down...');
  if (discordBot) discordBot.destroy();
  process.exit(0);
});
process.on('uncaughtException', (e) => { console.error('[💥 UNCAUGHT]', e.message); });
process.on('unhandledRejection', (e) => { console.error('[ERR]', e); });
