require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const query = require('samp-query');
const { Client, GatewayIntentBits, WebhookClient, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const https = require('https');
const sharp = require('sharp');
const mysql = require('mysql2/promise');

const PREFIX = '!';

const app = express();
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SAMP_HOST = process.env.SAMP_HOST || '141.94.184.106';
const SAMP_PORT = parseInt(process.env.SAMP_PORT, 10) || 1381;
const QUERY_INTERVAL = parseInt(process.env.QUERY_INTERVAL, 10) || 300000;
const WEBSITE_URL = process.env.WEBSITE_URL || '';
const CURRENT_EVENT = process.env.CURRENT_EVENT || '';
const SELF_PING_URL = process.env.SELF_PING_URL || '';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const WELCOME_WEBHOOK_URL = process.env.WELCOME_WEBHOOK;
const LEAVE_WEBHOOK_URL = process.env.LEAVE_WEBHOOK;
const REACTION_ROLES_CHANNEL = process.env.REACTION_ROLES_CHANNEL || '1520182858583375892';
const TICKET_PANEL_CHANNEL = process.env.TICKET_PANEL_CHANNEL || '1520368523120214136';

const RICH_LIST_CHANNEL = process.env.RICH_LIST_CHANNEL || '1520919721799585883';
const RICH_LIST_INTERVAL = 60 * 60 * 1000;

const dbConfig = {
  host: process.env.DB_HOST || '164.132.206.179',
  user: process.env.DB_USER || 'gs333946',
  password: process.env.DB_PASSWORD || 'JQNcMTD86Pki',
  database: process.env.DB_NAME || 'gs333946',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  connectTimeout: 10000,
};

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.includes('.') || req.path === '/api/health') {
    return next();
  }
  trackVisitor(req);
  next();
});

let peakPlayers = 0;
let cachedData = null;
let lastFetch = 0;
const CACHE_DURATION = 10000;

let dailyActivePlayers = new Set();
let dailyPeakPlayers = 0;
let dailyDate = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Tbilisi' });

function trackDailyPlayers(players) {
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Tbilisi' });
  if (today !== dailyDate) {
    dailyActivePlayers = new Set();
    dailyPeakPlayers = 0;
    dailyDate = today;
    console.log('[📅 DAILY] Reset counters for ' + today);
  }
  for (const p of players) {
    if (p.name) dailyActivePlayers.add(p.name);
  }
  const cur = players.length;
  if (cur > dailyPeakPlayers) dailyPeakPlayers = cur;
}

function getDailyStats() {
  return {
    date: dailyDate,
    activePlayers: dailyActivePlayers.size,
    peakOnline: dailyPeakPlayers,
    playerNames: Array.from(dailyActivePlayers).slice(0, 30),
  };
}

// ══════════════════════════════════════
//  VISITOR TRACKING
// ══════════════════════════════════════

let dailyVisitors = new Set();
let dailyPageViews = 0;
let dailyVisitorPeak = 0;
let dailyVisitorDate = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Tbilisi' });

function trackVisitor(req) {
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Tbilisi' });
  if (today !== dailyVisitorDate) {
    console.log('[📅 VISITORS] Reset for ' + today + ' | Was: ' + dailyVisitors.size + ' visitors, ' + dailyPageViews + ' views');
    dailyVisitors = new Set();
    dailyPageViews = 0;
    dailyVisitorPeak = 0;
    dailyVisitorDate = today;
  }

  dailyPageViews++;

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const cleanIp = ip.split(',')[0].trim();
  const isNew = !dailyVisitors.has(cleanIp);
  dailyVisitors.add(cleanIp);

  const current = dailyVisitors.size;
  if (current > dailyVisitorPeak) dailyVisitorPeak = current;

  return { isNew, total: current };
}

function getVisitorStats() {
  return {
    date: dailyVisitorDate,
    uniqueVisitors: dailyVisitors.size,
    totalPageViews: dailyPageViews,
    peakVisitors: dailyVisitorPeak,
  };
}

let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL !== 'YOUR_WEBHOOK_URL_HERE') {
  webhook = new WebhookClient({ url: WEBHOOK_URL });
  console.log('[✅] Status Webhook connected');
} else {
  console.log('[⚠️] WEBHOOK_URL not set');
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
        trackDailyPlayers(players);
        const avgPing = players.length > 0
          ? Math.round(players.reduce((sum, p) => sum + (p.ping || 0), 0) / players.length) : 0;
        resolve({
          status: 'online', hostname: res.hostname || 'Metro City RP',
          players: players.map(p => p.name),
          playerPings: players.map(p => p.ping || 0),
          avgPing, maxPlayers: max, currentPlayers: cur, peakPlayers, ping,
          map: res.mapname || 'N/A', gamemode: res.gamemode || 'N/A',
          time: new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' }),
          lastUpdate: new Date().toISOString(), serverIp: SAMP_HOST + ':' + SAMP_PORT,
          dailyActive: dailyActivePlayers.size,
        });
      }
    });
  });
}

const bar = (cur, max, len = 12) => {
  if (!max) return '\u2591'.repeat(len);
  const f = Math.round((cur / max) * len);
  return '\u2588'.repeat(f) + '\u2591'.repeat(len - f);
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
    title: '\u25A3 ' + (r.hostname || 'Metro City RP'),
    color: embedColor(ratio), description: desc.join('\n'), fields,
    footer: { text: 'Metro City RP \u2022 2026' }, timestamp: new Date().toISOString(),
  };
  if (bgPath) embed.image = { url: 'attachment://background.png' };
  return { files, embeds: [embed], components: [buttons] };
};

const buildOffline = async () => {
  const bgPath = getBgPath();
  const files = bgPath ? [new AttachmentBuilder(bgPath, { name: 'background.png' })] : [];
  const embed = {
    title: '\u25A3 Metro City RP', color: 0xe74c3c,
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
    footer: { text: 'Metro City RP \u2022 2026' }, timestamp: new Date().toISOString(),
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
      console.error('[❌ STATUS] attempt ' + attempt + '/' + retries + ':', e.message);
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
        trackDailyPlayers(players);
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

const REACTION_ROLES = {
  '\uD83C\uDFAE': 'Player',
};

function buildReactionRoleEmbed() {
  return new EmbedBuilder()
    .setTitle('🎭 როლების არჩევი')
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '🏙️ **მოგესალმებით Metro City RP-ში!**',
      '',
      '▶ აიღეთ როლი რომ შემოგვიერთდეთ',
      '▶ ოფიციალურ დისქორდ სერვერზე!',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '🎮 **Player** — დაიწყე თამაში',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '⬇️ აიღეთ როლი რეაქციით ⬇️',
    ].join('\n'))
    .setColor(0x00d4ff)
    .setFooter({ text: 'Metro City RP • 2026' })
    .setTimestamp();
}

async function setupReactionRoles(guild) {
  try {
    console.log('[🔍 REACTION ROLES] Setting up for guild: ' + guild.name);

    const botMember = await guild.members.fetch(discordBot.user.id);
    const botRole = botMember.roles.highest;
    const botPerms = botMember.permissions;

    console.log('[🔍 REACTION ROLES] Bot Manage Roles: ' + botPerms.has('ManageRoles'));

    let playerRole = guild.roles.cache.find(r => r.name === 'Player');
    if (!playerRole) {
      console.log('[🔧 REACTION ROLES] Creating Player role...');
      playerRole = await guild.roles.create({
        name: 'Player',
        color: 0x00d4ff,
        reason: 'Auto-created by MCRP BOT for reaction roles',
      });
      console.log('[✅ REACTION ROLES] Player role created');
    }

    if (botPerms.has('ManageRoles') && playerRole.position >= botRole.position) {
      console.log('[🔧 REACTION ROLES] Moving bot role above Player...');
      try {
        await botRole.setPosition(playerRole.position + 1);
        console.log('[✅ REACTION ROLES] Bot role positioned above Player');
      } catch (e) {
        console.error('[⚠️ REACTION ROLES] Could not move bot role: ' + e.message);
        console.error('[💡] Manually move MCRP BOT role ABOVE Player in Server Settings > Roles');
      }
    }

    const channel = await guild.channels.fetch(REACTION_ROLES_CHANNEL);
    if (!channel) {
      console.error('[❌ REACTION ROLES] Channel not found: ' + REACTION_ROLES_CHANNEL);
      return;
    }
    console.log('[✅ REACTION ROLES] Channel: ' + channel.name);

    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true });
      await channel.permissionOverwrites.edit(playerRole.id, { ViewChannel: false });
      await channel.permissionOverwrites.edit(discordBot.user.id, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AddReactions: true,
      });
      console.log('[✅ REACTION ROLES] Channel permissions set');
    } catch (e) {
      console.error('[⚠️ REACTION ROLES] Could not set channel permissions: ' + e.message);
    }

    console.log('[🔍 REACTION ROLES] Fetching messages...');
    const messages = await channel.messages.fetch({ limit: 50 });
    const existing = messages.find(m => m.author.id === discordBot.user.id && m.embeds.length > 0 && m.embeds[0].title);

    if (existing) {
      console.log('[🔄 REACTION ROLES] Deleting old message: ' + existing.id);
      await existing.delete().catch(() => {});
    }

    console.log('[🔍 REACTION ROLES] Sending embed...');
    const embed = buildReactionRoleEmbed();
    const msg = await channel.send({ embeds: [embed] });

    for (const emoji of Object.keys(REACTION_ROLES)) {
      await msg.react(emoji);
    }

    console.log('[✅ REACTION ROLES] Done! Message sent to #' + channel.name);
  } catch (e) {
    console.error('[❌ REACTION ROLES] Error: ' + e.message);
    console.error('[❌ REACTION ROLES] Stack: ' + e.stack);
  }
}

async function handleReactionAdd(reaction, user) {
  if (user.bot) return;
  if (reaction.message.channel.id !== REACTION_ROLES_CHANNEL) return;

  const emoji = reaction.emoji.name;
  const roleName = REACTION_ROLES[emoji];
  if (!roleName) return;

  try {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
      console.error('[❌ REACTION ROLES] Role not found: ' + roleName);
      return;
    }

    const botMember = await guild.members.fetch(discordBot.user.id);
    if (role.position >= botMember.roles.highest.position) {
      console.error('[❌ REACTION ROLES] Bot role is too low! Move MCRP BOT above ' + roleName + ' in role hierarchy');
      return;
    }

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      console.log('[✅ REACTION ROLES] ' + user.tag + ' <- ' + roleName);
    }
  } catch (e) {
    console.error('[❌ REACTION ROLES] role add: ' + e.message);
    if (e.message.includes('Missing Permissions')) {
      console.error('[💡] Bot needs Manage Roles permission and must be higher than Player role');
    }
  }
}

async function handleReactionRemove(reaction, user) {
  if (user.bot) return;
  if (reaction.message.channel.id !== REACTION_ROLES_CHANNEL) return;

  const emoji = reaction.emoji.name;
  const roleName = REACTION_ROLES[emoji];
  if (!roleName) return;

  try {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) return;

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      console.log('[✅ REACTION ROLES] ' + user.tag + ' x ' + roleName);
    }
  } catch (e) {
    console.error('[❌ REACTION ROLES] role remove:', e.message);
  }
}

const NEON_WELCOME = [0x00FFFF, 0x00D4FF, 0x00FF88, 0x00D4FF, 0x00FFFF, 0x7B68EE, 0x00D4FF];
const NEON_LEAVE = [0xFF00FF, 0xFF4444, 0xFF0088, 0xFF4444, 0xFF00FF, 0xFF1493, 0xE74C3C];

let welcomeWebhook = null;
let leaveWebhook = null;
let discordBot = null;

if (WELCOME_WEBHOOK_URL) {
  welcomeWebhook = new WebhookClient({ url: WELCOME_WEBHOOK_URL });
  console.log('[✅] Welcome Webhook connected');
}
if (LEAVE_WEBHOOK_URL) {
  leaveWebhook = new WebhookClient({ url: LEAVE_WEBHOOK_URL });
  console.log('[✅] Leave Webhook connected');
}

function buildWelcomeEmbed(member) {
  const memberCount = member.guild.memberCount;
  return new EmbedBuilder()
    .setTitle('𝖂𝖊𝖑𝖈𝖔𝖒𝖊 🌴')
    .setDescription([
      '> 🏙️ **მოგესალმებით Metro City RP-ში!**',
      '',
      '```მომხმარებელი: ' + member.user.tag + '```',
      '',
      '> **📊 სტატისტიკა:**',
      '> ```მოთამაშეები: ' + memberCount + '```',
      '',
      '> 🚔 **დაიცავი წესები და ისიამოვნე თამაშით!**',
    ].join('\n'))
    .setColor(NEON_WELCOME[0])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Metro City RP • 2026' })
    .setTimestamp();
}

async function generateWelcomeCard(member) {
  try {
    const fetch = (await import('node-fetch')).default;
    const GIFEncoder = require('gifencoder');
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarRes = await fetch(avatarURL);
    const avatarBuffer = Buffer.from(await avatarRes.arrayBuffer());

    const width = 933;
    const height = 280;
    const encoder = new GIFEncoder(width, height);
    const chunks = [];
    encoder.createReadStream().on('data', (chunk) => chunks.push(chunk));

    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(300);
    encoder.setQuality(10);

    const neonFrames = [
      { r: 0, g: 212, b: 255 },
      { r: 0, g: 255, b: 136 },
      { r: 123, g: 104, b: 238 },
      { r: 0, g: 200, b: 255 },
      { r: 0, g: 255, b: 200 },
      { r: 80, g: 120, b: 255 },
      { r: 0, g: 212, b: 255 },
    ];

    const avatarBase64 = avatarBuffer.toString('base64');
    const username = member.user.username.length > 18
      ? member.user.username.substring(0, 16) + '..'
      : member.user.username;
    const dateStr = new Date().toLocaleDateString('en-GB');

    for (let i = 0; i < neonFrames.length; i++) {
      const c = neonFrames[i];
      const cn = `rgb(${c.r},${c.g},${c.b})`;
      const cr = Math.floor(c.r * 0.12);
      const cg = Math.floor(c.g * 0.12);
      const cb = Math.floor(c.b * 0.12);
      const cr2 = Math.floor(c.r * 0.04);
      const cg2 = Math.floor(c.g * 0.04);
      const cb2 = Math.floor(c.b * 0.04);

      const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="rgb(${cr},${cg},${cb})"/>
            <stop offset="50%" stop-color="rgb(${Math.floor(cr * 0.4)},${Math.floor(cg * 0.4)},${Math.floor(cb * 0.4)})"/>
            <stop offset="100%" stop-color="rgb(${cr2},${cg2},${cb2})"/>
          </linearGradient>
          <radialGradient id="rglow" cx="15%" cy="50%" r="35%">
            <stop offset="0%" stop-color="${cn}" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="${cn}" stop-opacity="0"/>
          </radialGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="glow"/>
            <feMerge>
              <feMergeNode in="glow"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="tglow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="glow"/>
            <feMerge>
              <feMergeNode in="glow"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="aglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -5" result="glow"/>
            <feMerge>
              <feMergeNode in="glow"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <clipPath id="ac">
            <circle cx="110" cy="140" r="56"/>
          </clipPath>
        </defs>

        <rect width="${width}" height="${height}" fill="url(#bg)" rx="16"/>
        <rect width="${width}" height="${height}" fill="url(#rglow)" rx="16"/>

        <rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="${cn}" stroke-width="2" rx="13" opacity="0.4"/>
        <line x1="30" y1="30" x2="30" y2="${height - 30}" stroke="${cn}" stroke-width="1" opacity="0.08"/>
        <line x1="60" y1="20" x2="60" y2="${height - 20}" stroke="${cn}" stroke-width="1" opacity="0.05"/>
        <line x1="${width - 30}" y1="30" x2="${width - 30}" y2="${height - 30}" stroke="${cn}" stroke-width="1" opacity="0.08"/>
        <line x1="${width - 60}" y1="20" x2="${width - 60}" y2="${height - 20}" stroke="${cn}" stroke-width="1" opacity="0.05"/>

        <circle cx="110" cy="140" r="62" fill="none" stroke="${cn}" stroke-width="3" filter="url(#aglow)" opacity="0.7"/>
        <circle cx="110" cy="140" r="58" fill="none" stroke="${cn}" stroke-width="1.5" opacity="0.9"/>
        <image href="data:image/png;base64,${avatarBase64}" x="54" y="84" width="112" height="112" clip-path="url(#ac)"/>

        <text x="200" y="90" font-family="Georgia, 'Times New Roman', serif" font-size="48" font-weight="bold" fill="#ffffff" filter="url(#tglow)" letter-spacing="2">WELCOME</text>

        <text x="200" y="132" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="28" font-weight="600" fill="${cn}" filter="url(#tglow)" letter-spacing="1">${username}</text>

        <text x="200" y="168" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="16" fill="#8899aa" letter-spacing="3">MEMBER  #${member.guild.memberCount}</text>

        <line x1="200" y1="185" x2="420" y2="185" stroke="${cn}" stroke-width="1" opacity="0.3"/>

        <text x="200" y="215" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="13" fill="#556677" letter-spacing="5">METRO  CITY  RP</text>

        <text x="${width - 40}" y="${height - 20}" font-family="monospace" font-size="11" fill="${cn}" opacity="0.35" text-anchor="end">${dateStr}</text>
      </svg>`;

      const frame = await sharp(Buffer.from(svg))
        .resize(width, height)
        .raw()
        .toBuffer();

      encoder.addFrame(frame);
    }

    encoder.finish();
    return Buffer.concat(chunks);
  } catch (e) {
    console.error('[WELCOME CARD GIF] Error: ' + e.message);
    return null;
  }
}

async function generateLeaveCard(member) {
  try {
    const fetch = (await import('node-fetch')).default;
    const GIFEncoder = require('gifencoder');
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarRes = await fetch(avatarURL);
    const avatarBuffer = Buffer.from(await avatarRes.arrayBuffer());

    const width = 933;
    const height = 280;
    const encoder = new GIFEncoder(width, height);
    const chunks = [];
    encoder.createReadStream().on('data', (chunk) => chunks.push(chunk));

    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(300);
    encoder.setQuality(10);

    const leaveFrames = [
      { r: 255, g: 0, b: 255 },
      { r: 255, g: 68, b: 68 },
      { r: 255, g: 0, b: 136 },
      { r: 255, g: 68, b: 68 },
      { r: 255, g: 0, b: 255 },
      { r: 255, g: 20, b: 147 },
      { r: 231, g: 76, b: 60 },
    ];

    const avatarBase64 = avatarBuffer.toString('base64');
    const username = member.user.username.length > 18
      ? member.user.username.substring(0, 16) + '..'
      : member.user.username;
    const dateStr = new Date().toLocaleDateString('en-GB');

    for (let i = 0; i < leaveFrames.length; i++) {
      const c = leaveFrames[i];
      const cn = `rgb(${c.r},${c.g},${c.b})`;
      const cr = Math.floor(c.r * 0.10);
      const cg = Math.floor(c.g * 0.10);
      const cb = Math.floor(c.b * 0.10);
      const cr2 = Math.floor(c.r * 0.03);
      const cg2 = Math.floor(c.g * 0.03);
      const cb2 = Math.floor(c.b * 0.03);

      const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="rgb(${cr},${cg},${cb})"/>
            <stop offset="50%" stop-color="rgb(${Math.floor(cr * 0.4)},${Math.floor(cg * 0.4)},${Math.floor(cb * 0.4)})"/>
            <stop offset="100%" stop-color="rgb(${cr2},${cg2},${cb2})"/>
          </linearGradient>
          <radialGradient id="rglow" cx="15%" cy="50%" r="35%">
            <stop offset="0%" stop-color="${cn}" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="${cn}" stop-opacity="0"/>
          </radialGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="glow"/>
            <feMerge>
              <feMergeNode in="glow"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="tglow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="glow"/>
            <feMerge>
              <feMergeNode in="glow"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="aglow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -5" result="glow"/>
            <feMerge>
              <feMergeNode in="glow"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <clipPath id="ac">
            <circle cx="110" cy="140" r="56"/>
          </clipPath>
          <filter id="desat" x="0%" y="0%" width="100%" height="100%">
            <feColorMatrix type="saturate" values="0.3"/>
          </filter>
        </defs>

        <rect width="${width}" height="${height}" fill="url(#bg)" rx="16"/>
        <rect width="${width}" height="${height}" fill="url(#rglow)" rx="16"/>

        <rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="${cn}" stroke-width="2" rx="13" opacity="0.35"/>
        <line x1="30" y1="30" x2="30" y2="${height - 30}" stroke="${cn}" stroke-width="1" opacity="0.06"/>
        <line x1="60" y1="20" x2="60" y2="${height - 20}" stroke="${cn}" stroke-width="1" opacity="0.04"/>
        <line x1="${width - 30}" y1="30" x2="${width - 30}" y2="${height - 30}" stroke="${cn}" stroke-width="1" opacity="0.06"/>
        <line x1="${width - 60}" y1="20" x2="${width - 60}" y2="${height - 20}" stroke="${cn}" stroke-width="1" opacity="0.04"/>

        <circle cx="110" cy="140" r="62" fill="none" stroke="${cn}" stroke-width="3" filter="url(#aglow)" opacity="0.5"/>
        <circle cx="110" cy="140" r="58" fill="none" stroke="${cn}" stroke-width="1.5" opacity="0.7"/>
        <image href="data:image/png;base64,${avatarBase64}" x="54" y="84" width="112" height="112" clip-path="url(#ac)" filter="url(#desat)"/>

        <text x="200" y="90" font-family="Georgia, 'Times New Roman', serif" font-size="48" font-weight="bold" fill="#ffffff" filter="url(#tglow)" letter-spacing="2">GOODBYE</text>

        <text x="200" y="132" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="28" font-weight="600" fill="${cn}" filter="url(#tglow)" letter-spacing="1">${username}</text>

        <text x="200" y="168" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="16" fill="#8899aa" letter-spacing="3">MEMBERS LEFT  ${member.guild.memberCount}</text>

        <line x1="200" y1="185" x2="420" y2="185" stroke="${cn}" stroke-width="1" opacity="0.3"/>

        <text x="200" y="215" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="13" fill="#556677" letter-spacing="5">METRO  CITY  RP</text>

        <text x="${width - 40}" y="${height - 20}" font-family="monospace" font-size="11" fill="${cn}" opacity="0.35" text-anchor="end">${dateStr}</text>
      </svg>`;

      const frame = await sharp(Buffer.from(svg))
        .resize(width, height)
        .raw()
        .toBuffer();

      encoder.addFrame(frame);
    }

    encoder.finish();
    return Buffer.concat(chunks);
  } catch (e) {
    console.error('[LEAVE CARD GIF] Error: ' + e.message);
    return null;
  }
}

function buildLeaveEmbed(member) {
  const memberCount = member.guild.memberCount;
  return new EmbedBuilder()
    .setTitle('𝕷𝖊𝖆𝖛𝖊 🏙️')
    .setDescription([
      '> 💨 **მომხმარებელმა დატოვა სერვერი**',
      '',
      '```მომხმარებელი: ' + member.user.tag + '```',
      '',
      '> **📊 სტატისტიკა:**',
      '> ```დარჩენილი: ' + memberCount + '```',
    ].join('\n'))
    .setColor(NEON_LEAVE[0])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Metro City RP • 2026' })
    .setTimestamp();
}

async function neonFlash(webhookClient, embed, colors, label) {
  try {
    const msg = await webhookClient.send({ embeds: [embed] });
    console.log('[✅ ' + label + '] sent ' + now());
    for (const color of colors) {
      await sleep(400);
      try {
        await webhookClient.editMessage(msg, { embeds: [EmbedBuilder.from(embed).setColor(color)] });
      } catch (e) { break; }
    }
    console.log('[✨ ' + label + '] neon flash complete');
  } catch (error) {
    console.error('[❌ ' + label + '] ' + error.message);
  }
}

// ══════════════════════════════════════
//  RICH LIST (SQL Database)
// ══════════════════════════════════════

let dbPool = null;

async function getDbPool() {
  if (!dbPool) {
    dbPool = mysql.createPool(dbConfig);
    console.log('[✅ DB] MySQL pool created');
  }
  return dbPool;
}

async function fetchRichList() {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.execute(
      'SELECT name, money, bank, (money + bank) AS total_wealth FROM accounts ORDER BY total_wealth DESC LIMIT 10'
    );
    return rows;
  } catch (e) {
    console.error('[❌ RICH LIST] DB Error: ' + e.message);
    return null;
  }
}

function formatMoney(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function buildRichListEmbed(players) {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const medal = medals[i] || '🔹';
    lines.push(medal + ' **' + (i + 1) + '.** ' + p.name + ' — $' + formatMoney(p.total_wealth));
  }

  const updateDate = new Date().toLocaleDateString('ka-GE', { timeZone: 'Asia/Tbilisi' });
  const updateTime = new Date().toLocaleTimeString('ka-GE', { timeZone: 'Asia/Tbilisi', hour: '2-digit', minute: '2-digit' });

  const embed = new EmbedBuilder()
    .setTitle('◈ ────── 𝐌𝐄𝐓𝐑𝐎 𝐂𝐈𝐓𝐘 𝐑𝐈𝐂𝐇 𝐋𝐈𝐒𝐓 ────── ◈')
    .setDescription(lines.join('\n'))
    .setColor(0xf1c40f)
    .setFooter({ text: '📊 ბოლო განახლება: ' + updateDate + ' • ' + updateTime })
    .setTimestamp();

  return embed;
}

async function postRichList(channel) {
  const players = await fetchRichList();
  if (!players || players.length === 0) {
    console.log('[⚠️ RICH LIST] No data');
    return;
  }

  const embed = buildRichListEmbed(players);
  const footerText = '\n◈ ───────────────────────────────────── ◈';

  try {
    const messages = await channel.messages.fetch({ limit: 10 });
    const existing = messages.find(
      m => m.author.id === discordBot.user.id &&
           m.embeds.length > 0 &&
           m.embeds[0].title &&
           m.embeds[0].title.includes('𝐑𝐈𝐂𝐇 𝐋𝐈𝐒𝐓')
    );

    if (existing) {
      await existing.edit({ embeds: [embed] });
      console.log('[✅ RICH LIST] Updated message');
    } else {
      await channel.send({ embeds: [embed] });
      console.log('[✅ RICH LIST] New message sent');
    }
  } catch (e) {
    console.error('[❌ RICH LIST] Send error: ' + e.message);
  }
}

const EVENTS_FILE = path.join(__dirname, 'events.json');
const TICKET_COUNTER_FILE = path.join(__dirname, 'ticket_counter.json');

function loadEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveEvents(data) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2));
}

const WARNINGS_FILE = path.join(__dirname, 'warnings.json');

function loadWarnings() {
  try {
    if (fs.existsSync(WARNINGS_FILE)) return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveWarnings(data) {
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2));
}

function getNextTicketNumber() {
  let count = 1;
  try {
    if (fs.existsSync(TICKET_COUNTER_FILE)) {
      const data = JSON.parse(fs.readFileSync(TICKET_COUNTER_FILE, 'utf8'));
      count = data.count || 1;
    }
  } catch (e) {}
  fs.writeFileSync(TICKET_COUNTER_FILE, JSON.stringify({ count: count + 1 }));
  return String(count).padStart(3, '0');
}

// ══════════════════════════════════════
//  TICKET PANEL (Button-based)
// ══════════════════════════════════════

async function setupTicketPanel(guild) {
  try {
    const channel = await guild.channels.fetch(TICKET_PANEL_CHANNEL);
    if (!channel) {
      console.error('[❌ TICKET PANEL] Channel not found: ' + TICKET_PANEL_CHANNEL);
      return;
    }

    const messages = await channel.messages.fetch({ limit: 30 });
    const existing = messages.find(m => m.author.id === discordBot.user.id && m.embeds.length > 0 && m.components.length > 0);

    if (existing) {
      console.log('[✅ TICKET PANEL] Panel already exists');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Ticket სისტემა')
      .setDescription([
        'გაქვს პრობლემა ან კითხვა?',
        '',
        '**Ticket-ის გასახსნელად ქვემოთ დააჭირე ღილაკს.**',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '📋 **Ticket** — პირადი ჩატი მოდერატორთან',
        '🔒 **დახურვა** — ticket-ის დახურვა შიგნიდან',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'))
      .setColor(0x00d4ff)
      .setFooter({ text: 'Metro City RP • 2026' })
      .setTimestamp();

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('📋 Ticket გახსნა')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋'),
    );

    await channel.send({ embeds: [embed], components: [button] });
    console.log('[✅ TICKET PANEL] Panel sent to #' + channel.name);
  } catch (e) {
    console.error('[❌ TICKET PANEL] ' + e.message);
  }
}

async function handleTicketButton(interaction) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'ticket_open') return;

  const guild = interaction.guild;
  const user = interaction.user;

  const existing = guild.channels.cache.find(c => c.name.startsWith('ticket-') && c.name.includes(user.id));
  if (existing) {
    return interaction.reply({ content: '\u26A0\uFE0F \u10D7\u10E5\u10D5\u10D4\u10DC \u10E3\u10D9\u10D5\u10D4 \u10D2\u10D0\u10E5\u10D5\u10D4\u10D7 \u10E5\u10D8\u10D0 ticket: ' + existing.toString(), ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const ticketNumber = getNextTicketNumber();

    let categoryId = null;
    const ticketCategory = guild.channels.cache.find(c => c.name === 'TICKETS' && c.type === 4);
    if (ticketCategory) {
      categoryId = ticketCategory.id;
    } else {
      try {
        const cat = await guild.channels.create({
          name: 'TICKETS',
          type: 4,
          permissionOverwrites: [
            { id: guild.id, deny: ['ViewChannel'] },
            { id: discordBot.user.id, allow: ['ViewChannel'] },
          ],
        });
        // Add admin/mod roles to category
        const adminRoles = guild.roles.cache.filter(r =>
          r.permissions.has('Administrator') || r.permissions.has('ManageGuild') || r.name === 'Owner' || r.name === 'Developer'
        );
        for (const [, role] of adminRoles) {
          await cat.permissionOverwrites.edit(role.id, { ViewChannel: true }).catch(() => {});
        }
        categoryId = cat.id;
      } catch (e) {}
    }

    const channelName = 'ticket-' + ticketNumber;

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: 0,
      parent: categoryId,
      topic: 'Ticket by ' + user.tag + ' (' + user.id + ')',
      permissionOverwrites: [
        { id: guild.id, deny: ['ViewChannel'] },
        { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        { id: discordBot.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] },
      ],
    });

    // Add admin/mod roles
    const adminRoles = guild.roles.cache.filter(r =>
      r.permissions.has('Administrator') || r.permissions.has('ManageGuild') || r.name === 'Owner' || r.name === 'Developer' || r.name === 'Moderator'
    );
    for (const [, role] of adminRoles) {
      await ticketChannel.permissionOverwrites.edit(role.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setTitle('\uD83D\uDCCB Ticket #' + ticketNumber)
      .setDescription([
        '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
        '',
        '\uD83D\uDC64 **\u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8:** ' + user.toString(),
        '\uD83D\uDCC5 **\u10D3\u10E0\u10DD:** <t:' + Math.floor(Date.now() / 1000) + ':R>',
        '',
        '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
        '',
        '\uD83D\uDCDD \u10D0\u10E6\u10D5\u10D4\u10E0\u10D8\u10D7 \u10D7\u10D5\u10D4\u10DC\u10D8 \u10DE\u10E0\u10DD\u10D1\u10DA\u10D4\u10DB\u10D0 \u10D0\u10DC \u10D9\u10D8\u10D7\u10D5\u10D0.',
        '\u10DB\u10DD\u10D3\u10D4\u10E0\u10D0\u10E2\u10DD\u10E0\u10D8 \u10DB\u10D0\u10DA\u10D4 \u10DB\u10DD\u10D5\u10D0.',
        '',
        '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
      ].join('\n'))
      .setColor(0x00d4ff)
      .setFooter({ text: 'Metro City RP \u2022 2026' })
      .setTimestamp();

    const closeBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('\uD83D\uDD12 Ticket \u10D3\u10D0\u10EE\u10E3\u10E0\u10D5\u10D0')
        .setStyle(ButtonStyle.Danger),
    );

    await ticketChannel.send({ content: user.toString(), embeds: [embed], components: [closeBtn] });

    await interaction.editReply({ content: '\u2705 Ticket \u10D3\u10D0\u10D0\u10EE\u10E1\u10D0: ' + ticketChannel.toString() });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

    const logChannel = guild.channels.cache.find(c => c.name.toLowerCase() === 'ticket-logs');
    if (logChannel) {
      logChannel.send({ embeds: [modEmbed('\uD83D\uDCCB Ticket \u10D3\u10D0\u10D0\u10EE\u10E1\u10D0', '**#' + ticketChannel.name + '** | ' + user.tag, 0x00d4ff)] });
    }

    console.log('[TICKET] OPEN #' + ticketNumber + ' by ' + user.tag);
  } catch (e) {
    await interaction.editReply({ content: '\u274C Ticket-ის შექმნა ვერ მოხერხდა: ' + e.message });
  }
}

async function handleCloseTicketButton(interaction) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'ticket_close') return;

  const channel = interaction.channel;
  if (!channel.name || !channel.name.startsWith('ticket-')) {
    return interaction.reply({ content: '❌ ეს არ არის ticket არხი.', ephemeral: true });
  }

  const isOwner = channel.name === 'ticket-' + interaction.user.id;
  const isMod = interaction.member.permissions.has('Administrator') || interaction.member.permissions.has('ManageGuild');

  if (!isOwner && !isMod) {
    return interaction.reply({ content: '❌ მხოლოდ ticket-ის მფლობელს ან ადმინს შეუძლია დახურვა.', ephemeral: true });
  }

  await interaction.deferReply();

  const logChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'ticket-logs');
  if (logChannel) {
    logChannel.send({ embeds: [modEmbed('🔒 Ticket დაიხურა', '**#' + channel.name + '** | ' + interaction.user.tag, 0xe74c3c)] });
  }

  console.log('[TICKET] CLOSE ' + channel.name + ' by ' + interaction.user.tag);
  await interaction.editReply({ content: '🔒 Ticket იხურება 3 წამში...' });
  setTimeout(() => channel.delete().catch(() => {}), 3000);
}

function startWelcomeBot() {
  if (!BOT_TOKEN) {
    console.log('[⚠️] DISCORD_BOT_TOKEN not set - Welcome/Leave bot disabled');
    return;
  }

  discordBot = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  discordBot.on('guildMemberAdd', async (member) => {
    console.log('[👋 JOIN] ' + member.user.tag + ' | ' + member.guild.name);
    if (welcomeWebhook) {
      const card = await generateWelcomeCard(member);
      if (card) {
        try {
          const msg = await welcomeWebhook.send({
            embeds: [buildWelcomeEmbed(member)],
            files: [{ attachment: card, name: 'welcome.gif' }],
          });
          console.log('[✅ WELCOME] Card sent ' + now());
          for (const color of NEON_WELCOME) {
            await sleep(400);
            try {
              await welcomeWebhook.editMessage(msg, { embeds: [EmbedBuilder.from(buildWelcomeEmbed(member)).setColor(color)] });
            } catch (e) { break; }
          }
        } catch (e) {
          console.error('[❌ WELCOME] ' + e.message);
          await neonFlash(welcomeWebhook, buildWelcomeEmbed(member), NEON_WELCOME, 'WELCOME');
        }
      } else {
        await neonFlash(welcomeWebhook, buildWelcomeEmbed(member), NEON_WELCOME, 'WELCOME');
      }
    }
  });

  discordBot.on('guildMemberRemove', async (member) => {
    console.log('[👋 LEAVE] ' + member.user.tag + ' | ' + member.guild.name);
    if (leaveWebhook) {
      const card = await generateLeaveCard(member);
      if (card) {
        try {
          const msg = await leaveWebhook.send({
            embeds: [buildLeaveEmbed(member)],
            files: [{ attachment: card, name: 'leave.gif' }],
          });
          console.log('[✅ LEAVE] Card sent ' + now());
          for (const color of NEON_LEAVE) {
            await sleep(400);
            try {
              await leaveWebhook.editMessage(msg, { embeds: [EmbedBuilder.from(buildLeaveEmbed(member)).setColor(color)] });
            } catch (e) { break; }
          }
        } catch (e) {
          console.error('[❌ LEAVE] ' + e.message);
          await neonFlash(leaveWebhook, buildLeaveEmbed(member), NEON_LEAVE, 'LEAVE');
        }
      } else {
        await neonFlash(leaveWebhook, buildLeaveEmbed(member), NEON_LEAVE, 'LEAVE');
      }
    }
  });

  discordBot.on('messageReactionAdd', handleReactionAdd);
  discordBot.on('messageReactionRemove', handleReactionRemove);

  discordBot.on('interactionCreate', async (interaction) => {
    await handleTicketButton(interaction);
    await handleCloseTicketButton(interaction);
  });

  // ══════════════════════════════════════
  //  AUTO MODERATION (24/7)
  // ══════════════════════════════════════

  const userMessages = new Map();
  const warnedUsers = new Set();
  const mutedUsers = new Set();

  const SPAM_LIMIT = 5;
  const SPAM_WINDOW = 7000;
  const FLOOD_LIMIT = 3;
  const FLOOD_WINDOW = 10000;
  const CAPS_THRESHOLD = 0.7;
  const MIN_MSG_LENGTH = 5;
  const LINK_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|discordapp\.com\/invites\/[^\s]+/gi;
  const INVITE_REGEX = /(discord\.gg|discordapp\.com\/invites)\/[a-zA-Z0-9]+/gi;

  function isModerator(member) {
    return member.permissions.has('BanMembers') || member.permissions.has('KickMembers') || member.permissions.has('ModerateMembers') || member.permissions.has('ManageMessages');
  }

  function hasMod(member) {
    return member.permissions.has('BanMembers') || member.permissions.has('KickMembers') || member.permissions.has('ModerateMembers') || member.permissions.has('ManageMessages');
  }

  function modEmbed(title, desc, color) {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(desc)
      .setColor(color || 0xe74c3c)
      .setFooter({ text: 'Metro City RP \u2022 Moderation' })
      .setTimestamp();
  }

  function getUserData(userId) {
    if (!userMessages.has(userId)) {
      userMessages.set(userId, { timestamps: [], lastContent: '', floodCount: 0 });
    }
    return userMessages.get(userId);
  }

  async function autoModMessage(message) {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (isModerator(message.member)) return;

    const userData = getUserData(message.author.id);
    const now = Date.now();
    const content = message.content;

    userData.timestamps.push(now);
    userData.timestamps = userData.timestamps.filter(t => now - t < SPAM_WINDOW);

    // ═══ SPAM DETECTION ═══
    if (userData.timestamps.length >= SPAM_LIMIT) {
      try {
        await message.delete();
      } catch (e) {}
      if (!warnedUsers.has(message.author.id + '_spam')) {
        warnedUsers.add(message.author.id + '_spam');
        const embed = new EmbedBuilder()
          .setTitle('\u26A0\uFE0F Spam Detected')
          .setDescription(`<@${message.author.id}>, ნუ გაუგზავნი მესიჯებს ასე სწრაფად!`)
          .setColor(0xf39c12)
          .setTimestamp();
        const warnMsg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        console.log('[AUTOMOD] SPAM warn: ' + message.author.tag);
      } else {
        try {
          const member = await message.guild.members.fetch(message.author.id);
          await member.timeout(5 * 60 * 1000, 'Auto-mute: Spam');
          mutedUsers.add(message.author.id);
          const embed = new EmbedBuilder()
            .setTitle('\uD83D\uDD07 Auto-Muted')
            .setDescription(`<@${message.author.id}> დუმილშია 5 წუთით (Spam)`)
            .setColor(0x9b59b6)
            .setTimestamp();
          const muteMsg = await message.channel.send({ embeds: [embed] });
          setTimeout(() => muteMsg.delete().catch(() => {}), 8000);
          console.log('[AUTOMOD] SPAM mute: ' + message.author.tag);
          warnedUsers.delete(message.author.id + '_spam');
        } catch (e) {}
      }
      return;
    }

    // ═══ FLOOD DETECTION ═══
    if (content.length > MIN_MSG_LENGTH && content === userData.lastContent) {
      userData.floodCount++;
    } else {
      userData.floodCount = 0;
    }
    userData.lastContent = content;

    if (userData.floodCount >= FLOOD_LIMIT) {
      try {
        await message.delete();
      } catch (e) {}
      userData.floodCount = 0;
      try {
        const member = await message.guild.members.fetch(message.author.id);
        await member.timeout(3 * 60 * 1000, 'Auto-mute: Flood');
        const embed = new EmbedBuilder()
          .setTitle('\uD83D\uDD07 Auto-Muted')
          .setDescription(`<@${message.author.id}> დუმილშია 3 წუთით (Flood - იგივე მესიჯის გამეორება)`)
          .setColor(0x9b59b6)
          .setTimestamp();
        const muteMsg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => muteMsg.delete().catch(() => {}), 8000);
        console.log('[AUTOMOD] FLOOD mute: ' + message.author.tag);
      } catch (e) {}
      return;
    }

    // ═══ CAPS FILTER ═══
    const upperCount = (content.replace(/[^a-zA-Z\u10D0-\u10FA]/g, '') || '').length;
    const lowerCount = (content.replace(/[^a-zA-Z\u10D0-\u10FA]/g, '') || '').length;
    const totalLetters = upperCount;
    if (totalLetters > 10) {
      const caps = content.replace(/[^A-Z\u10D0-\u10FA]/g, '').length;
      if (caps / totalLetters > CAPS_THRESHOLD && totalLetters > 10) {
        try {
          await message.delete();
        } catch (e) {}
        const embed = new EmbedBuilder()
          .setTitle('\uD83D\uDEAB Caps Lock')
          .setDescription(`<@${message.author.id}>, ნუ წერ დიდი ასოებით!`)
          .setColor(0xe74c3c)
          .setTimestamp();
        const capMsg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => capMsg.delete().catch(() => {}), 5000);
        console.log('[AUTOMOD] CAPS: ' + message.author.tag);
        return;
      }
    }

    // ═══ LINK/INVITE FILTER ═══
    if (INVITE_REGEX.test(content)) {
      try {
        await message.delete();
      } catch (e) {}
      try {
        const member = await message.guild.members.fetch(message.author.id);
        await member.timeout(10 * 60 * 1000, 'Auto-mute: Discord invite link');
      } catch (e) {}
      const embed = new EmbedBuilder()
        .setTitle('\uD83D\uDEAB Invite Blocked')
        .setDescription(`<@${message.author.id}>, Discord invite ლინკები აკრძალულია!`)
        .setColor(0xe74c3c)
        .setTimestamp();
      const invMsg = await message.channel.send({ embeds: [embed] });
      setTimeout(() => invMsg.delete().catch(() => {}), 5000);
      console.log('[AUTOMOD] INVITE: ' + message.author.tag);
      return;
    }

    // ═══ EXTERNAL LINK FILTER ═══
    if (LINK_REGEX.test(content) && !content.includes('metro-city-rp.onrender.com') && !content.includes('tezgate.com')) {
      try {
        await message.delete();
      } catch (e) {}
      const embed = new EmbedBuilder()
        .setTitle('\uD83D\uDEAB Link Blocked')
        .setDescription(`<@${message.author.id}>, გარე ლინკები აკრძალულია!`)
        .setColor(0xe74c3c)
        .setTimestamp();
      const linkMsg = await message.channel.send({ embeds: [embed] });
      setTimeout(() => linkMsg.delete().catch(() => {}), 5000);
      console.log('[AUTOMOD] LINK: ' + message.author.tag);
      return;
    }
  }

  discordBot.on('messageCreate', async (message) => {
    if (!message.guild) return;
    if (message.author.bot) return;

    console.log('[MSG] ' + message.author.tag + ': ' + message.content.substring(0, 50));

    await autoModMessage(message);
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const member = message.member;

    // !help
    if (cmd === 'help') {
      const embed = modEmbed('uD83D\uDCD3 Moderation Commands', [
        '`!ban @user [reason]` \u2014 Ban a user',
        '`!kick @user [reason]` \u2014 Kick a user',
        '`!mute @user <minutes> [reason]` \u2014 Mute (timeout) a user',
        '`!unmute @user` \u2014 Unmute a user',
        '`!warn @user [reason]` \u2014 Warn a user',
        '`!warnings @user` \u2014 View warnings',
        '`!clear <amount>` \u2014 Delete messages',
        '',
        '**📋 Tickets:**',
        '`!ticket open [reason]` \u2014 Open ticket',
        '`!ticket close` \u2014 Close ticket',
        '`!ticket closeall` \u2014 Close all tickets',
        '',
        '**📅 Events:**',
        '`!event create <name> | <DD.MM.YYYY> | <HH:MM> | [desc]`',
        '`!event list` \u2014 Upcoming events',
        '`!event cancel <id>` \u2014 Cancel event',
        '',
        '**ℹ️ Other:**',
        '`!serverinfo` \u2014 Server info',
        '`!userinfo @user` \u2014 User info',
        '`!testwelcome [@user]` \u2014 Test welcome card',
        '`!testleave [@user]` \u2014 Test leave card',
        '`!richlist` \u2014 Rich List (top 10 richest players)',
      ].join('\n'), 0x00d4ff);
      return message.reply({ embeds: [embed] });
    }

    // !testwelcome
    if (cmd === 'testwelcome') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'Moderator only.')] });
      const target = message.mentions.members.first() || member;
      try {
        const card = await generateWelcomeCard(target);
        if (card && welcomeWebhook) {
          await welcomeWebhook.send({
            embeds: [buildWelcomeEmbed(target)],
            files: [{ attachment: card, name: 'welcome.gif' }],
          });
          message.reply({ embeds: [modEmbed('\u2705 Test Sent', 'Welcome card გაიგზავნა ' + target.user.tag + '-სთვის!', 0x2ecc71)] });
        } else {
          message.reply({ embeds: [modEmbed('\u274C Error', 'GIF generation ან webhook მუშაობს.')] });
        }
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', e.message)] });
      }
      return;
    }

    // !testleave
    if (cmd === 'testleave') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'Moderator only.')] });
      const target = message.mentions.members.first() || member;
      try {
        const card = await generateLeaveCard(target);
        if (card && leaveWebhook) {
          await leaveWebhook.send({
            embeds: [buildLeaveEmbed(target)],
            files: [{ attachment: card, name: 'leave.gif' }],
          });
          message.reply({ embeds: [modEmbed('\u2705 Test Sent', 'Leave card გაიგზავნა ' + target.user.tag + '-სთვის!', 0x2ecc71)] });
        } else {
          message.reply({ embeds: [modEmbed('\u274C Error', 'GIF generation ან webhook მუშაობს.')] });
        }
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', e.message)] });
      }
      return;
    }

    // !richlist
    if (cmd === 'richlist') {
      try {
        const players = await fetchRichList();
        if (!players || players.length === 0) {
          return message.reply({ embeds: [modEmbed('\u274C Error', 'მონაცემები ვერ მოიძებნა.')] });
        }
        const embed = buildRichListEmbed(players);
        message.reply({ embeds: [embed] });
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', e.message)] });
      }
      return;
    }

    // !ban
    if (cmd === 'ban') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'You need **Ban Members** permission.')] });
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!ban @user [reason]`')] });
      if (target.id === message.author.id) return message.reply({ embeds: [modEmbed('\u274C Error', 'You cannot ban yourself.')] });
      if (target.roles.highest.position >= member.roles.highest.position && message.guild.ownerId !== message.author.id) {
        return message.reply({ embeds: [modEmbed('\u274C Error', 'Cannot ban someone with equal or higher role.')] });
      }
      const reason = args.slice(1).join(' ') || 'No reason provided';
      try {
        await target.send({ embeds: [modEmbed('\uD83D\uDEAB თქვენ გაიგდეთ ბანი', [
          `\uD83C\uDFE2 **სერვერი:** ${message.guild.name}`,
          `\uD83D\uDCCB **მოდერატორი:** ${message.author.tag}`,
          `\uD83D\uDCDD **მიზეზი:** ${reason}`,
        ].join('\n'), 0xe74c3c)] }).catch(() => {});
        await target.ban({ reason });
        const embed = modEmbed('\uD83D\uDEAB Banned', [
          `\uD83D\uDC64 **User:** ${target.user.tag}`,
          `\uD83D\uDCCB **Moderator:** ${message.author.tag}`,
          `\uD83D\uDCDD **Reason:** ${reason}`,
        ].join('\n'), 0xe74c3c);
        message.reply({ embeds: [embed] });
        console.log('[MOD] BAN ' + target.user.tag + ' by ' + message.author.tag + ' | ' + reason);
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', 'Failed to ban: ' + e.message)] });
      }
      return;
    }

    // !kick
    if (cmd === 'kick') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'You need **Kick Members** permission.')] });
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!kick @user [reason]`')] });
      if (target.id === message.author.id) return message.reply({ embeds: [modEmbed('\u274C Error', 'You cannot kick yourself.')] });
      if (target.roles.highest.position >= member.roles.highest.position && message.guild.ownerId !== message.author.id) {
        return message.reply({ embeds: [modEmbed('\u274C Error', 'Cannot kick someone with equal or higher role.')] });
      }
      const reason = args.slice(1).join(' ') || 'No reason provided';
      try {
        await target.send({ embeds: [modEmbed('\uD83D\uDC62 თქვენ გაიგდეთ კიკით', [
          `\uD83C\uDFE2 **სერვერი:** ${message.guild.name}`,
          `\uD83D\uDCCB **მოდერატორი:** ${message.author.tag}`,
          `\uD83D\uDCDD **მიზეზი:** ${reason}`,
        ].join('\n'), 0xf1c40f)] }).catch(() => {});
        await target.kick(reason);
        const embed = modEmbed('\uD83D\uDC62 Kicked', [
          `\uD83D\uDC64 **User:** ${target.user.tag}`,
          `\uD83D\uDCCB **Moderator:** ${message.author.tag}`,
          `\uD83D\uDCDD **Reason:** ${reason}`,
        ].join('\n'), 0xf1c40f);
        message.reply({ embeds: [embed] });
        console.log('[MOD] KICK ' + target.user.tag + ' by ' + message.author.tag + ' | ' + reason);
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', 'Failed to kick: ' + e.message)] });
      }
      return;
    }

    // !mute
    if (cmd === 'mute') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'You need **Moderate Members** permission.')] });
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!mute @user <minutes> [reason]`')] });
      if (target.id === message.author.id) return message.reply({ embeds: [modEmbed('\u274C Error', 'You cannot mute yourself.')] });
      if (target.roles.highest.position >= member.roles.highest.position && message.guild.ownerId !== message.author.id) {
        return message.reply({ embeds: [modEmbed('\u274C Error', 'Cannot mute someone with equal or higher role.')] });
      }
      const minutes = parseInt(args[1]) || 10;
      const reason = args.slice(2).join(' ') || 'No reason provided';
      try {
        await target.send({ embeds: [modEmbed('\uD83D\uDD07 თქვენ გაჩუმებული ხართ', [
          `\uD83C\uDFE2 **სერვერი:** ${message.guild.name}`,
          `\u23F0 **ხანგრძლივობა:** ${minutes} წუთი`,
          `\uD83D\uDCCB **მოდერატორი:** ${message.author.tag}`,
          `\uD83D\uDCDD **მიზეზი:** ${reason}`,
        ].join('\n'), 0x9b59b6)] }).catch(() => {});
        await target.timeout(minutes * 60 * 1000, reason);
        const embed = modEmbed('\uD83D\uDD07 Muted', [
          `\uD83D\uDC64 **User:** ${target.user.tag}`,
          `\u23F0 **Duration:** ${minutes} minutes`,
          `\uD83D\uDCCB **Moderator:** ${message.author.tag}`,
          `\uD83D\uDCDD **Reason:** ${reason}`,
        ].join('\n'), 0x9b59b6);
        message.reply({ embeds: [embed] });
        console.log('[MOD] MUTE ' + target.user.tag + ' (' + minutes + 'min) by ' + message.author.tag);
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', 'Failed to mute: ' + e.message)] });
      }
      return;
    }

    // !unmute
    if (cmd === 'unmute') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'You need **Moderate Members** permission.')] });
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!unmute @user`')] });
      try {
        await target.timeout(null);
        const embed = modEmbed('\uD83D\uDD0A Unmuted', [
          `\uD83D\uDC64 **User:** ${target.user.tag}`,
          `\uD83D\uDCCB **Moderator:** ${message.author.tag}`,
        ].join('\n'), 0x2ecc71);
        message.reply({ embeds: [embed] });
        console.log('[MOD] UNMUTE ' + target.user.tag + ' by ' + message.author.tag);
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', 'Failed to unmute: ' + e.message)] });
      }
      return;
    }

    // !warn
    if (cmd === 'warn') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'You need **Manage Messages** permission.')] });
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!warn @user [reason]`')] });
      const reason = args.slice(1).join(' ') || 'No reason provided';
      const warnings = loadWarnings();
      if (!warnings[target.id]) warnings[target.id] = [];
      warnings[target.id].push({ reason, moderator: message.author.tag, date: new Date().toISOString() });
      saveWarnings(warnings);
      const count = warnings[target.id].length;
      await target.send({ embeds: [modEmbed('\u26A0\uFE0F გაფრთხილება', [
        `\uD83C\uDFE2 **სერვერი:** ${message.guild.name}`,
        `\uD83D\uDCCB **მოდერატორი:** ${message.author.tag}`,
        `\uD83D\uDCDD **მიზეზი:** ${reason}`,
        `\uD83D\uDCCA **გაფრთხილებები:** ${count}/3`,
        count >= 2 ? '\n\u26A0\uFE0F **1 გაფრთხილება დაგრჩა ბანამდე!**' : '',
      ].join('\n'), 0xf39c12)] }).catch(() => {});
      const embed = modEmbed('\u26A0\uFE0F Warned', [
        `\uD83D\uDC64 **User:** ${target.user.tag}`,
        `\uD83D\uDCCB **Moderator:** ${message.author.tag}`,
        `\uD83D\uDCDD **Reason:** ${reason}`,
        `\uD83D\uDCCA **Total Warnings:** ${count}`,
      ].join('\n'), 0xf39c12);
      message.reply({ embeds: [embed] });
      console.log('[MOD] WARN ' + target.user.tag + ' (#' + count + ') by ' + message.author.tag);
      if (count >= 3) {
        try {
          await target.ban({ reason: 'Auto-ban: 3 warnings reached' });
          message.channel.send({ embeds: [modEmbed('\uD83D\uDEAB Auto-Banned', `${target.user.tag} has been automatically banned (3 warnings).`, 0xe74c3c)] });
          console.log('[MOD] AUTO-BAN ' + target.user.tag + ' (3 warnings)');
        } catch (e) {}
      }
      return;
    }

    // !warnings
    if (cmd === 'warnings') {
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!warnings @user`')] });
      const warnings = loadWarnings();
      const userWarnings = warnings[target.id] || [];
      if (userWarnings.length === 0) {
        return message.reply({ embeds: [modEmbed('\u2139\uFE0F Warnings', `${target.user.tag} has no warnings.`, 0x00d4ff)] });
      }
      const list = userWarnings.map((w, i) => `**${i + 1}.** ${w.reason} \u2014 *${w.moderator}* (${new Date(w.date).toLocaleDateString()})`).join('\n');
      const embed = modEmbed('\u26A0\uFE0F Warnings for ' + target.user.tag, list, 0xf39c12);
      message.reply({ embeds: [embed] });
      return;
    }

    // !clear
    if (cmd === 'clear') {
      if (!hasMod(member)) return message.reply({ embeds: [modEmbed('\u274C Permission Denied', 'You need **Manage Messages** permission.')] });
      const amount = parseInt(args[0]);
      if (!amount || amount < 1 || amount > 100) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!clear <1-100>`')] });
      try {
        const deleted = await message.channel.bulkDelete(amount + 1, true);
        const embed = modEmbed('\uD83D\uDDD1\uFE0F Cleared', `Deleted **${deleted.size - 1}** messages.`, 0x2ecc71);
        const msg = await message.channel.send({ embeds: [embed] });
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        console.log('[MOD] CLEAR ' + (deleted.size - 1) + ' msgs in #' + message.channel.name + ' by ' + message.author.tag);
      } catch (e) {
        message.reply({ embeds: [modEmbed('\u274C Error', 'Failed: ' + e.message)] });
      }
      return;
    }

    // !serverinfo
    if (cmd === 'serverinfo') {
      const g = message.guild;
      const embed = new EmbedBuilder()
        .setTitle('\uD83C\uDFE2 ' + g.name)
        .setColor(0x00d4ff)
        .addFields(
          { name: '\uD83D\uDC51 Owner', value: `<@${g.ownerId}>`, inline: true },
          { name: '\uD83D\uDC65 Members', value: String(g.memberCount), inline: true },
          { name: '\uD83D\uDCCB Channels', value: String(g.channels.cache.size), inline: true },
          { name: '\uD83C\uDFF4 Roles', value: String(g.roles.cache.size), inline: true },
          { name: '\uD83C\uDF10 Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '\uD83C\uDFAF Boost Level', value: String(g.premiumTier), inline: true },
        )
        .setFooter({ text: 'Metro City RP \u2022 2026' })
        .setTimestamp();
      message.reply({ embeds: [embed] });
      return;
    }

    // !userinfo
    if (cmd === 'userinfo') {
      const target = message.mentions.members.first() || (args[0] && await message.guild.members.fetch(args[0]).catch(() => null));
      if (!target) return message.reply({ embeds: [modEmbed('\u274C Error', 'Usage: `!userinfo @user`')] });
      const roles = target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'None';
      const embed = new EmbedBuilder()
        .setTitle('\uD83D\uDC64 ' + target.user.tag)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
        .setColor(target.displayHexColor)
        .addFields(
          { name: 'ID', value: target.id, inline: true },
          { name: '\uD83D\uDCC5 Joined', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: '\uD83C\uDF1F Account Created', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '\uD83C\uDFF4 Roles', value: roles.length > 1024 ? roles.substring(0, 1020) + '...' : roles, inline: false },
        )
        .setFooter({ text: 'Metro City RP \u2022 2026' })
        .setTimestamp();
      message.reply({ embeds: [embed] });
      return;
    }

    // ══════════════════════════════════════
    //  TICKET SYSTEM
    // ══════════════════════════════════════

    if (cmd === 'ticket') {
      const sub = args[0] ? args[0].toLowerCase() : '';

      // !ticket open [reason]
      if (sub === 'open' || sub === '') {
        const guild = message.guild;
        const logChannel = guild.channels.cache.find(c => c.name.toLowerCase() === 'ticket-logs');

        const existing = guild.channels.cache.find(c => c.name.startsWith('ticket-') && c.topic && c.topic.includes(message.author.id));
        if (existing) {
          return message.reply({ embeds: [modEmbed('\u26A0\uFE0F Ticket \u10E3\u10D9\u10D5\u10D4 \u10D2\u10D0\u10E5\u10D5\u10D4\u10D7\u10D0', '\u10D7\u10E5\u10D5\u10D4\u10DC \u10E3\u10D9\u10D5\u10D4 \u10D2\u10D0\u10E5\u10D5\u10D4\u10D7 \u10E5\u10D8\u10D0 ticket: ' + existing.toString(), 0xf39c12)] });
        }

        let categoryId = null;
        const ticketCategory = guild.channels.cache.find(c => c.name === 'TICKETS' && c.type === 4);
        if (ticketCategory) {
          categoryId = ticketCategory.id;
        } else {
          try {
            const cat = await guild.channels.create({
              name: 'TICKETS',
              type: 4,
              permissionOverwrites: [
                { id: guild.id, deny: ['ViewChannel'] },
                { id: discordBot.user.id, allow: ['ViewChannel'] },
              ],
            });
            categoryId = cat.id;
          } catch (e) {}
        }

        const ticketNumber = getNextTicketNumber();
        const channelName = 'ticket-' + ticketNumber;
        const reason = args.slice(1).join(' ') || '\u10DB\u10D8\u10D6\u10D4\u10D6\u10D8 \u10DB\u10D8\u10D7\u10D8\u10D0\u10E9\u10D4\u10D1\u10E3\u10DA\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1';
        try {
          const ticketChannel = await guild.channels.create({
            name: channelName,
            type: 0,
            parent: categoryId,
            topic: 'Ticket by ' + message.author.tag + ' (' + message.author.id + ')',
            permissionOverwrites: [
              { id: guild.id, deny: ['ViewChannel'] },
              { id: message.author.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
              { id: discordBot.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] },
            ],
          });

          const adminRoles = guild.roles.cache.filter(r =>
            r.permissions.has('Administrator') || r.permissions.has('ManageGuild') || r.name === 'Owner' || r.name === 'Developer' || r.name === 'Moderator'
          );
          for (const [, role] of adminRoles) {
            await ticketChannel.permissionOverwrites.edit(role.id, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            }).catch(() => {});
          }

          const embed = new EmbedBuilder()
            .setTitle('\uD83D\uDCCB Ticket #' + ticketNumber)
            .setDescription([
              '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
              '',
              '\uD83D\uDC64 **\u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8:** ' + message.author.toString(),
              '\uD83D\uDCDD **\u10DB\u10D8\u10D6\u10D4\u10D6\u10D8:** ' + reason,
              '\uD83D\uDCC5 **\u10D3\u10E0\u10DD:** <t:' + Math.floor(Date.now() / 1000) + ':R>',
              '',
              '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
              '',
              '\u10DB\u10DD\u10D3\u10D4\u10E0\u10D0\u10E2\u10DD\u10E0\u10D8 \u10DB\u10D0\u10DA\u10D4 \u10DB\u10DD\u10D5\u10D0.',
              '`!ticket close` \u2014 ticket-\u10D8\u10E1 \u10D3\u10D0\u10EE\u10E3\u10E0\u10D5\u10D0',
              '',
              '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
            ].join('\n'))
            .setColor(0x00d4ff)
            .setFooter({ text: 'Metro City RP \u2022 2026' })
            .setTimestamp();

          await ticketChannel.send({ content: message.author.toString(), embeds: [embed] });

          const replyEmbed = modEmbed('✅ Ticket გაიხსნა', 'Ticket არხი: ' + ticketChannel.toString(), 0x2ecc71);
          message.reply({ embeds: [replyEmbed] });

          if (logChannel) {
            logChannel.send({ embeds: [modEmbed('📋 Ticket გაიხსნა', '**#' + ticketChannel.name + '** | ' + message.author.tag + ' | მიზეზი: ' + reason, 0x00d4ff)] });
          }

          console.log('[TICKET] OPEN ' + ticketChannel.name + ' by ' + message.author.tag);
        } catch (e) {
          message.reply({ embeds: [modEmbed('❌ Error', 'Ticket-ის შექმნა ვერ მოხერხდა: ' + e.message)] });
        }
        return;
      }

      // !ticket close
      if (sub === 'close') {
        if (!message.channel.name || !message.channel.name.startsWith('ticket-')) {
          return message.reply({ embeds: [modEmbed('❌ Error', 'ეს არ არის ticket არხი.')] });
        }
        if (!hasMod(member) && !message.channel.name.endsWith(message.author.id)) {
          return message.reply({ embeds: [modEmbed('❌ Permission Denied', 'მხოლოდ მოდერატორს ან ticket-ის მფლობელს შეუძლია დახურვა.')] });
        }

        const logChannel = message.guild.channels.cache.find(c => c.name.toLowerCase() === 'ticket-logs');
        const embed = modEmbed('🔒 Ticket დაიხურა', 'დახურა: ' + message.author.tag, 0xe74c3c);

        if (logChannel) {
          logChannel.send({ embeds: [modEmbed('🔒 Ticket დაიხურა', '**#' + message.channel.name + '** | ' + message.author.tag, 0xe74c3c)] });
        }

        console.log('[TICKET] CLOSE ' + message.channel.name + ' by ' + message.author.tag);
        message.reply({ embeds: [embed] }).then(() => {
          setTimeout(() => message.channel.delete().catch(() => {}), 3000);
        });
        return;
      }

      // !ticket closeall
      if (sub === 'closeall') {
        if (!hasMod(member)) {
          return message.reply({ embeds: [modEmbed('❌ Permission Denied', 'მხოლოდ მოდერატორს შეუძლია.')] });
        }
        const tickets = message.guild.channels.cache.filter(c => c.name.startsWith('ticket-'));
        if (tickets.size === 0) {
          return message.reply({ embeds: [modEmbed('ℹ️ Info', 'ღია ticket-ები არ არის.')] });
        }
        let count = 0;
        for (const [, ch] of tickets) {
          await ch.delete().catch(() => {});
          count++;
        }
        message.reply({ embeds: [modEmbed('✅ დაიხურა', count + ' ticket დაიხურა.', 0x2ecc71)] });
        console.log('[TICKET] CLOSEALL ' + count + ' tickets');
        return;
      }

      // !help ticket
      const embed = modEmbed('📋 Ticket Commands', [
        '`!ticket open [reason]` — Ticket-ის გახსნა',
        '`!ticket close` — Ticket-ის დახურვა',
        '`!ticket closeall` — ყველა ticket-ის დახურვა',
      ].join('\n'), 0x00d4ff);
      message.reply({ embeds: [embed] });
      return;
    }

    // ══════════════════════════════════════
    //  EVENT SYSTEM
    // ══════════════════════════════════════

    if (cmd === 'event') {
      const sub = args[0] ? args[0].toLowerCase() : '';

      // !event create <name> | <DD.MM.YYYY> | <HH:MM> | [description]
      if (sub === 'create') {
        if (!hasMod(member)) {
          return message.reply({ embeds: [modEmbed('❌ Permission Denied', 'მხოლოდ მოდერატორს შეუძლია.')] });
        }
        const full = args.slice(1).join(' ');
        const parts = full.split('|').map(p => p.trim());
        if (parts.length < 3) {
          return message.reply({ embeds: [modEmbed('❌ Error', 'გამოყენება: `!event create <სახელი> | <დღე.თვე.წელი> | <დრო> | [აღწერა]`\nმაგ: `!event create Giveaway | 28.06.2026 | 20:00 | დიდი გივეი!`')] });
        }

        const [name, dateStr, timeStr] = parts;
        const desc = parts[3] || 'ღონისძიება';
        const [day, month, year] = dateStr.split('.').map(Number);
                        const [hour, minute] = timeStr.split(':').map(Number);
                        const eventDate = new Date(year, month - 1, day, hour, minute);

                        if (isNaN(eventDate.getTime()) || eventDate <= new Date()) {
                          return message.reply({ embeds: [modEmbed('❌ Error', 'თარიღი არასწორია ან უკვე წასულია.')] });
                        }

                        const events = loadEvents();
                        const id = Date.now().toString(36);
                        events.push({
                          id, name, description: desc,
                          date: eventDate.toISOString(),
                          creator: message.author.tag,
                          channel: message.channel.id,
                          reminded: false,
                        });
                        saveEvents(events);

                        const embed = new EmbedBuilder()
                          .setTitle('📅 ' + name)
                          .setDescription([
                            '**📝 აღწერა:** ' + desc,
                            '',
                            '**📅 თარიღი:** ' + dateStr,
                            '**⏰ დრო:** ' + timeStr,
                            '',
                            '**👤 შემქმნელი:** ' + message.author.tag,
                            '',
                            '━━━━━━━━━━━━━━━━━━━━━━━━━━',
                            '`!event list` — ყველა ღონისძიება',
                          ].join('\n'))
                          .setColor(0x00d4ff)
                          .setFooter({ text: 'Metro City RP • 2026' })
                          .setTimestamp();

                        message.reply({ embeds: [embed] });
                        console.log('[EVENT] CREATE: ' + name + ' by ' + message.author.tag);
                        return;
                      }

      // !event list
      if (sub === 'list' || sub === '') {
        const events = loadEvents();
        const upcoming = events.filter(e => new Date(e.date) > new Date()).sort((a, b) => new Date(a.date) - new Date(b.date));

        if (upcoming.length === 0) {
          return message.reply({ embeds: [modEmbed('📅 ღონისძიებები', 'დაგეგილი ღონისძიებები არ არის.', 0x00d4ff)] });
        }

        const list = upcoming.map((e, i) => {
          const d = new Date(e.date);
          const dateStr = d.toLocaleDateString('ka-GE') + ' ' + d.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' });
          return '**' + (i + 1) + '.** ' + e.name + '\n📅 ' + dateStr + ' | 👤 ' + e.creator;
        }).join('\n\n');

        const embed = new EmbedBuilder()
          .setTitle('📅 დაგეგილი ღონისძიებები')
          .setDescription(list)
          .setColor(0x00d4ff)
          .setFooter({ text: 'Metro City RP • 2026' })
          .setTimestamp();

        message.reply({ embeds: [embed] });
        return;
      }

      // !event cancel <id>
      if (sub === 'cancel') {
        if (!hasMod(member)) {
          return message.reply({ embeds: [modEmbed('❌ Permission Denied', 'მხოლოდ მოდერატორს შეუძლია.')] });
        }
        const events = loadEvents();
        const eventId = args[1];
        const idx = events.findIndex(e => e.id === eventId);
        if (idx === -1) {
          return message.reply({ embeds: [modEmbed('❌ Error', 'ღონისძიება ვერ მოიძებნა. `!event list` ნახე ID.')] });
        }
        const removed = events.splice(idx, 1)[0];
        saveEvents(events);
        message.reply({ embeds: [modEmbed('❌ ღონისძიება გაუქმდა', removed.name, 0xe74c3c)] });
        console.log('[EVENT] CANCEL: ' + removed.name + ' by ' + message.author.tag);
        return;
      }

      // !event help
      const embed = modEmbed('📅 Event Commands', [
        '`!event create <სახელი> | <დღე.თვე.წელი> | <დრო> | [აღწერა]`',
        '`!event list` — ღონისძიებების სია',
        '`!event cancel <id>` — ღონისძიების გაუქმება',
        '',
        'მაგ: `!event create Giveaway | 28.06.2026 | 20:00 | დიდი გივეი!`',
      ].join('\n'), 0x00d4ff);
      message.reply({ embeds: [embed] });
      return;
    }
  });

  discordBot.once('ready', async () => {
    console.log('[✅] Bot: ' + discordBot.user.tag + ' | Servers: ' + discordBot.guilds.cache.size);
    for (const [, guild] of discordBot.guilds.cache) {
      await setupReactionRoles(guild);
      await setupTicketPanel(guild);
    }

    // Event reminder checker - every minute
    setInterval(async () => {
      const events = loadEvents();
      const now = new Date();
      let changed = false;

      for (const event of events) {
        const eventDate = new Date(event.date);
        const diff = eventDate - now;
        const minutesLeft = Math.floor(diff / 60000);

        // 30 min reminder
        if (!event.reminded && minutesLeft <= 30 && minutesLeft > 0) {
          event.reminded = true;
          changed = true;
          try {
            const ch = await discordBot.channels.fetch(event.channel);
            if (ch) {
              const embed = new EmbedBuilder()
                .setTitle('⏰ შეხსენება: ' + event.name)
                .setDescription([
                  '📅 **ღონისძიება 30 წუთში დაიწყება!**',
                  '',
                  '📝 ' + event.description,
                  '⏰ ' + eventDate.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' }),
                ].join('\n'))
                .setColor(0xf39c12)
                .setFooter({ text: 'Metro City RP • 2026' })
                .setTimestamp();
              await ch.send({ embeds: [embed] });
              console.log('[EVENT] REMINDER: ' + event.name);
            }
          } catch (e) {}
        }

        // Event started
        if (diff <= 0 && !event.completed) {
          event.completed = true;
          changed = true;
          try {
            const ch = await discordBot.channels.fetch(event.channel);
            if (ch) {
              const embed = new EmbedBuilder()
                .setTitle('🎉 ' + event.name + ' დაიწყო!')
                .setDescription(event.description)
                .setColor(0x2ecc71)
                .setFooter({ text: 'Metro City RP • 2026' })
                .setTimestamp();
              await ch.send({ embeds: [embed] });
              console.log('[EVENT] STARTED: ' + event.name);
            }
          } catch (e) {}
        }
      }

      if (changed) saveEvents(events);
    }, 60000);

    // Rich List - every 1 hour
    try {
      const richChannel = await discordBot.channels.fetch(RICH_LIST_CHANNEL);
      if (richChannel) {
        await postRichList(richChannel);
        setInterval(async () => {
          try {
            const ch = await discordBot.channels.fetch(RICH_LIST_CHANNEL);
            if (ch) await postRichList(ch);
          } catch (e) {
            console.error('[❌ RICH LIST] Interval error: ' + e.message);
          }
        }, RICH_LIST_INTERVAL);
        console.log('[✅ RICH LIST] Interval set (1 hour) | Channel: #' + richChannel.name);
      }
    } catch (e) {
      console.error('[❌ RICH LIST] Setup error: ' + e.message);
    }
  });

  discordBot.login(BOT_TOKEN).catch(e => {
    console.error('[❌] Bot Login Error:', e.message);
  });
}

const selfPing = () => {
  if (!SELF_PING_URL) return;
  https.get(SELF_PING_URL, (res) => {
    console.log('[✅ SELF-PING] ' + res.statusCode);
  }).on('error', (e) => {
    console.error('[❌ SELF-PING]', e.message);
  });
};

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

app.get('/api/daily-stats', (req, res) => {
  res.json(getDailyStats());
});

app.get('/api/visitor-stats', (req, res) => {
  res.json(getVisitorStats());
});

app.listen(PORT, () => {
  console.log('');
  console.log('  =====================================');
  console.log('       Metro City RP - All in One');
  console.log('  =====================================');
  console.log('  Website:   http://localhost:' + PORT);
  console.log('  Server:    ' + SAMP_HOST + ':' + SAMP_PORT);
  console.log('  Status:    ' + (webhook ? '[OK]' : '[OFF]'));
  console.log('  Welcome:   ' + (welcomeWebhook ? '[OK]' : '[OFF]'));
  console.log('  Leave:     ' + (leaveWebhook ? '[OK]' : '[OFF]'));
  console.log('  Bot:       ' + (BOT_TOKEN ? '[OK]' : '[OFF]'));
  console.log('  ReactRole: ' + (BOT_TOKEN ? '[OK]' : '[OFF]'));
  console.log('  Self-Ping: ' + (SELF_PING_URL ? '[OK]' : '[OFF]'));
  console.log('  =====================================');
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