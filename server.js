require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const query = require('samp-query');
const { Client, GatewayIntentBits, WebhookClient, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const https = require('https');

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

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let peakPlayers = 0;
let cachedData = null;
let lastFetch = 0;
const CACHE_DURATION = 10000;

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
  new ButtonBuilder().setLabel('\uD83C\uDFAE \u10E1\u10D4\u10E0\u10D5\u10D4\u10E0\u10D6\u10D4 \u10E8\u10D4\u10E1\u10D5\u10DA\u10D0').setStyle(ButtonStyle.Link).setURL('https://u.tezgate.com/' + SAMP_HOST + ':' + SAMP_PORT),
  new ButtonBuilder().setLabel('\uD83C\uDF10 \u10D5\u10D4\u10D1\u10E1\u10D0\u10D8\u10E2\u10D8').setStyle(ButtonStyle.Link).setURL(WEBSITE_URL || 'http://localhost:' + PORT),
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
    '', '> **\uD83D\uDFE2 \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8:** `\u10DD\u10DC\u10DA\u10D0\u10D8\u10DC`',
    '> **\uD83D\uDC65 \u10DB\u10DD\u10E2\u10D0\u10DB\u10D0\u10E8\u10D4\u10D4\u10D1\u10D8:** `' + cur + ' / ' + max + '`',
    '> **\uD83C\uDF10 \u10D5\u10D4\u10D1\u10E1\u10D0\u10D8\u10E2\u10D8:** ' + websiteUrl,
  ];
  if (cur > 0) desc.push('> **\uD83D\uDCCA \u10DE\u10D8\u10D9\u10D8:** `' + peakPlayers + '`');
  desc.push('', '```' + bar(cur, max) + '  ' + cur + '/' + max + '```');
  if (CURRENT_EVENT) desc.push('> **\u2B50 \u10D0\u10E5\u10EA\u10D8\u10D0:** `' + CURRENT_EVENT + '`');
  desc.push('', '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
  const fields = [
    { name: '\uD83D\uDDFA\uFE0F \u10E0\u10E3\u10D9\u10D0', value: '`' + (r.mapname || 'N/A') + '`', inline: true },
    { name: '\u23F0 \u10D3\u10E0\u10DD', value: '`' + now() + '`', inline: true },
  ];
  if (playerNames) fields.push({ name: '\u25B8 \u10DD\u10DC\u10DA\u10D0\u10D8\u10DC \u10DB\u10DD\u10E2\u10D0\u10DB\u10D0\u10E8\u10D4\u10D4\u10D1\u10D8', value: playerNames, inline: false });
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
      '', '> **\uD83D\uDD34 \u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8:** `\u10DD\u10E4\u10DA\u10D0\u10D8\u10DC`',
      '> **\u274C \u10E1\u10D4\u10E0\u10D5\u10D4\u10E0\u10D8 \u10DB\u10D8\u10E3\u10EF\u10D3\u10DD\u10DB\u10D4\u10DA\u10D8\u10D0**',
      '> **\uD83C\uDF10 \u10D5\u10D4\u10D1\u10E1\u10D0\u10D8\u10E2\u10D8:** ' + (WEBSITE_URL || 'https://metro-city-rp.onrender.com'),
      '', '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    ].join('\n'),
    fields: [
      { name: '\uD83D\uDDFA\uFE0F \u10E0\u10E3\u10D9\u10D0', value: '`\u2014`', inline: true },
      { name: '\u23F0 \u10D3\u10E0\u10DD', value: '`' + now() + '`', inline: true },
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
    .setTitle('\uD83C\uDFAD \u10E0\u10DD\u10DA\u10D4\u10D1\u10D8\u10D5\u10D8 \u10D3\u10D0 \u10D0\u10E0\u10E9\u10D8')
    .setDescription([
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
      '',
      '\uD83C\uDFD9\uFE0F **\u10DB\u10DD\u10D2\u10D4\u10E1\u10D0\u10DA\u10DB\u10D4\u10D1\u10D8\u10D7 Metro City RP-\u10E8\u10D8!**',
      '',
      '\u25B6 \u10D0\u10D8\u10D2\u10D4\u10D7\u10D4 \u10E0\u10DD\u10DA\u10D8 \u10E0\u10DD\u10DB \u10E8\u10D4\u10DB\u10DD\u10D2\u10D5\u10D0\u10D4\u10E0\u10D7\u10D3\u10D4\u10D7',
      '\u25B6 \u10DD\u10E4\u10D8\u10EA\u10D8\u10D0\u10DA\u10E3\u10E0 \u10D3\u10D8\u10E1\u10E5\u10DD\u10E0\u10D3 \u10E1\u10D4\u10E0\u10D5\u10D4\u10E0\u10D6\u10D4!',
      '',
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
      '',
      '\uD83C\uDFAE **Player** \u2014 \u10D3\u10D0\u10D8\u10EC\u10E7\u10D4 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8',
      '',
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
      '',
      '\u2B07\uFE0F \u10D0\u10D8\u10E6\u10D4\u10D7\u10D4\u10D7 \u10E0\u10D4\u10D0\u10EE\u10EA\u10D8\u10D0\u10E1\u10D8\u10D7 \u10E5\u10D5\u10D4\u10DB\u10DD\u10E2 \u2B07\uFE0F',
    ].join('\n'))
    .setColor(0x00d4ff)
    .setFooter({ text: 'Metro City RP \u2022 2026' })
    .setTimestamp();
}

async function setupReactionRoles(guild) {
  try {
    console.log('[🔍 REACTION ROLES] Fetching channel: ' + REACTION_ROLES_CHANNEL);
    const channel = await guild.channels.fetch(REACTION_ROLES_CHANNEL);
    if (!channel) {
      console.error('[❌ REACTION ROLES] Channel not found: ' + REACTION_ROLES_CHANNEL);
      return;
    }
    console.log('[✅ REACTION ROLES] Channel found: ' + channel.name + ' | type: ' + channel.type);

    const botMember = await guild.members.fetch(discordBot.user.id);
    const perms = channel.permissionsFor(botMember);
    console.log('[🔍 REACTION ROLES] Bot permissions: ' + JSON.stringify({
      ViewChannel: perms?.has('ViewChannel'),
      SendMessages: perms?.has('SendMessages'),
      EmbedLinks: perms?.has('EmbedLinks'),
      AddReactions: perms?.has('AddReactions'),
    }));

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

    console.log('[✅ REACTION ROLES] Message sent to #' + channel.name);
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

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      console.log('[✅ REACTION ROLES] ' + user.tag + ' <- ' + roleName);
    }
  } catch (e) {
    console.error('[❌ REACTION ROLES] role add:', e.message);
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
    .setTitle('\uD83C\uDF34 \u10D5\u10D4\u10DA\u10D9\u10DD\u10DB \u10D6\u10D4 !')
    .setDescription([
      '> \uD83C\uDFD9 **\u10DB\u10DD\u10D2\u10D4\u10E1\u10D0\u10DA\u10DB\u10D4\u10D1\u10D8\u10D7 Metro City RP-\u10E8\u10D8!**',
      '',
      `\`\`\`\u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8: ${member.user.tag}\`\`\``,
      '',
      '> **\uD83D\uDCCA \u10E1\u10E2\u10D0\u10E2\u10D8\u10E1\u10E2\u10D8\u10D9\u10D0:**',
      `> \`\`\`\u10DB\u10DD\u10E2\u10D0\u10DB\u10D0\u10E8\u10D4\u10D4\u10D1\u10D8: ${memberCount}\`\`\``,
      '',
      '> \uD83D\uDE94 **\u10D3\u10D0\u10D8\u10EA\u10D0\u10D5\u10D8 \u10E6\u10D4\u10E1\u10D4\u10D1\u10D8 \u10D3\u10D0 \u10D8\u10E1\u10D8\u10D0\u10DB\u10DD\u10D5\u10D6\u10D4 \u10D7\u10D0\u10DB\u10D0\u10E8\u10D8\u10D7!**',
    ].join('\n'))
    .setColor(NEON_WELCOME[0])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Metro City RP \u2022 2026' })
    .setTimestamp();
}

function buildLeaveEmbed(member) {
  const memberCount = member.guild.memberCount;
  return new EmbedBuilder()
    .setTitle('\uD83D\uDCA8 \u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8 \u10D3\u10D0\u10E2\u10DD\u10D5\u10D0\u10D5\u10D0 \u10E1\u10D4\u10E0\u10D5\u10D4\u10E0\u10D8')
    .setDescription([
      '> \uD83D\uDCA8 **\u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8\u10DB\u10D0 \u10D3\u10D0\u10E2\u10DD\u10D5\u10D0\u10D5\u10D0 \u10E1\u10D4\u10E0\u10D5\u10D4\u10E0\u10D8**',
      '',
      `\`\`\`\u10DB\u10DD\u10DB\u10EE\u10DB\u10D0\u10E0\u10D4\u10D1\u10D4\u10DA\u10D8: ${member.user.tag}\`\`\``,
      '',
      '> **\uD83D\uDCCA \u10E1\u10E2\u10D0\u10E2\u10D8\u10E1\u10E2\u10D8\u10D9\u10D0:**',
      `> \`\`\`\u10D3\u10D0\u10E0\u10E9\u10D4\u10DC\u10D8\u10DA\u10D8: ${memberCount}\`\`\``,
    ].join('\n'))
    .setColor(NEON_LEAVE[0])
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Metro City RP \u2022 2026' })
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
    ],
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

  discordBot.on('messageReactionAdd', handleReactionAdd);
  discordBot.on('messageReactionRemove', handleReactionRemove);

  discordBot.once('ready', async () => {
    console.log('[✅] Bot: ' + discordBot.user.tag + ' | Servers: ' + discordBot.guilds.cache.size);
    for (const [, guild] of discordBot.guilds.cache) {
      await setupReactionRoles(guild);
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