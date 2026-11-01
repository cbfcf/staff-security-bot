const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, MessageFlags, ActionRowBuilder,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID environment variable.');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const DEFAULT_CONFIG = {
  staffRoleId: null, logChannelId: null,
  security: {
    antiSpam: true, antiLinks: false, antiInvites: true,
    antiMassMentions: true, antiRaid: true, antiDestructiveActions: true,
    spamLimit: 5, spamWindowMs: 7000, raidJoinLimit: 6,
    raidWindowMs: 15000, mentionLimit: 5, timeoutMinutes: 10
  }
};
let db = { guilds: {}, staff: {} };
try { if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { console.error('Could not read data.json:', e); }
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function configFor(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = structuredClone(DEFAULT_CONFIG);
  const cfg = db.guilds[guildId];
  cfg.security = { ...DEFAULT_CONFIG.security, ...(cfg.security || {}) };
  return cfg;
}
function recordsFor(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (!db.staff[key]) db.staff[key] = { warnings: [], strikes: [], notes: [], history: [], loa: null };
  return db.staff[key];
}
function safe(text) { return String(text ?? '').replace(/@everyone/g, '@ everyone').replace(/@here/g, '@ here').slice(0, 3500); }
function card(title, lines = []) {
  const c = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${safe(title)}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  for (const line of lines) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(safe(line)));
  return c;
}
function v2Payload(container, extra = {}) { return { flags: MessageFlags.IsComponentsV2, components: [container], ...extra }; }
function isManager(member) { return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild); }
function isStaff(member, cfg) { return isManager(member) || (cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId)); }
async function log(guild, text) {
  const cfg = configFor(guild.id);
  if (!cfg.logChannelId) return;
  const ch = guild.channels.cache.get(cfg.logChannelId) || await guild.channels.fetch(cfg.logChannelId).catch(() => null);
  if (ch && ch.isTextBased()) await ch.send(v2Payload(card('Staff and security log', [text]))).catch(() => {});
}
function makeConfigPanel(guildId, page = 'overview') {
  const cfg = configFor(guildId);
  const sec = cfg.security;
  const lines = page === 'security' ? [
    `Anti-spam: **${sec.antiSpam ? 'ON' : 'OFF'}**`,
    `Block invite links: **${sec.antiInvites ? 'ON' : 'OFF'}**`,
    `Block external links: **${sec.antiLinks ? 'ON' : 'OFF'}**`,
    `Mass-mention protection: **${sec.antiMassMentions ? 'ON' : 'OFF'}**`,
    `Anti-raid: **${sec.antiRaid ? 'ON' : 'OFF'}**`,
    `Destructive-action alerts: **${sec.antiDestructiveActions ? 'ON' : 'OFF'}**`,
    `Spam threshold: **${sec.spamLimit} messages / ${Math.round(sec.spamWindowMs / 1000)} seconds**`,
    `Raid threshold: **${sec.raidJoinLimit} joins / ${Math.round(sec.raidWindowMs / 1000)} seconds**`,
    `Timeout length: **${sec.timeoutMinutes} minutes**`
  ] : [
    `Staff role: ${cfg.staffRoleId ? `<@&${cfg.staffRoleId}>` : 'Not set'}`,
    `Log channel: ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Not set'}`,
    'Use the selectors below to set the staff role and log channel.',
    'Choose Security in the menu to toggle protection features.'
  ];
  const c = card(page === 'security' ? 'Security settings' : 'Bot configuration', lines);
  const menu = new StringSelectMenuBuilder().setCustomId('cfg_page').setPlaceholder('Choose a settings page').addOptions(
    { label: 'Overview', value: 'overview', default: page === 'overview' },
    { label: 'Security', value: 'security', default: page === 'security' }
  );
  c.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  if (page === 'overview') {
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('cfg_staff_role').setPlaceholder('Select staff role').setMinValues(0).setMaxValues(1)
    ));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('cfg_log_channel').setPlaceholder('Select log channel').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1)
    ));
  } else {
    const toggles = [
      ['antiSpam', 'Anti-spam'], ['antiInvites', 'Invite filter'], ['antiLinks', 'External link filter'],
      ['antiMassMentions', 'Mass-mention protection'], ['antiRaid', 'Anti-raid'], ['antiDestructiveActions', 'Destructive-action alerts']
    ];
    for (let i = 0; i < toggles.length; i += 3) {
      const row = new ActionRowBuilder();
      for (const [key, label] of toggles.slice(i, i + 3)) row.addComponents(
        new ButtonBuilder().setCustomId(`cfg_toggle:${key}`).setLabel(`${label}: ${sec[key] ? 'ON' : 'OFF'}`).setStyle(sec[key] ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      c.addActionRowComponents(row);
    }
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg_thresholds').setLabel('Edit security thresholds').setStyle(ButtonStyle.Secondary)
    ));
  }
  return c;
}

const commands = [
  new SlashCommandBuilder().setName('config').setDescription('Open the bot configuration menu'),
  new SlashCommandBuilder().setName('embed').setDescription('Create and publish a V2 message')
    .addChannelOption(o => o.setName('channel').setDescription('Where to publish the message').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Message title').setRequired(true).setMaxLength(150))
    .addStringOption(o => o.setName('description').setDescription('Message text').setRequired(true).setMaxLength(3500))
    .addStringOption(o => o.setName('footer').setDescription('Optional footer').setRequired(false).setMaxLength(200)),
  new SlashCommandBuilder().setName('staff').setDescription('Staff management tools')
    .addSubcommand(s => s.setName('warn').setDescription('Record a staff warning').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand(s => s.setName('strike').setDescription('Record a staff strike').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand(s => s.setName('note').setDescription('Add a private staff note').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o=>o.setName('note').setDescription('Note').setRequired(true)))
    .addSubcommand(s => s.setName('profile').setDescription('View a staff record').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)))
    .addSubcommand(s => s.setName('loa').setDescription('Record staff leave of absence').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o=>o.setName('details').setDescription('Leave details').setRequired(true)))
    .addSubcommand(s => s.setName('return').setDescription('Mark a staff member as returned').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)))
    .addSubcommand(s => s.setName('promote').setDescription('Assign a role and record promotion').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('New role').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand(s => s.setName('demote').setDescription('Remove a role and record demotion').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role to remove').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand(s => s.setName('remove-record').setDescription('Remove a warning, strike or note').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption(o=>o.setName('type').setDescription('Record type').setRequired(true).addChoices({name:'Warning',value:'warnings'},{name:'Strike',value:'strikes'},{name:'Note',value:'notes'})).addIntegerOption(o=>o.setName('number').setDescription('Record number shown in profile').setRequired(true).setMinValue(1))),
  new SlashCommandBuilder().setName('security').setDescription('View security status or manually timeout a member')
    .addSubcommand(s=>s.setName('status').setDescription('View current security settings'))
    .addSubcommand(s=>s.setName('timeout').setDescription('Timeout a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Minutes (1-10080)').setRequired(true).setMinValue(1).setMaxValue(10080)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)))
];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Channel, Partials.GuildMember] });
const messageHistory = new Map();
const joinHistory = new Map();
const deletionHistory = new Map();

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = commands.map(c => c.toJSON());
  if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
  else await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
  console.log(`Registered ${body.length} slash commands.`);
}

client.once('ready', () => console.log(`Ready as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const cfg = configFor(interaction.guildId);
      if (interaction.commandName === 'config') {
        if (!isManager(interaction.member)) return interaction.reply({ content: 'You need Manage Server or Administrator to configure the bot.', ephemeral: true });
        return interaction.reply(v2Payload(makeConfigPanel(interaction.guildId), { ephemeral: true }));
      }
      if (interaction.commandName === 'embed') {
        if (!isStaff(interaction.member, cfg)) return interaction.reply({ content: 'You are not authorized to create messages.', ephemeral: true });
        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const footer = interaction.options.getString('footer');
        const parts = [`${safe(description)}`];
        if (footer) parts.push(`-# ${safe(footer)}`);
        const box = card(title, parts);
        await channel.send(v2Payload(box));
        return interaction.reply({ content: `Published your V2 message in ${channel}.`, ephemeral: true });
      }
      if (interaction.commandName === 'security') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'status') {
          const s = cfg.security;
          return interaction.reply(v2Payload(card('Security status', [
            `Anti-spam: **${s.antiSpam ? 'ON' : 'OFF'}**`, `Invite filter: **${s.antiInvites ? 'ON' : 'OFF'}**`,
            `External link filter: **${s.antiLinks ? 'ON' : 'OFF'}**`, `Mass-mention protection: **${s.antiMassMentions ? 'ON' : 'OFF'}**`,
            `Anti-raid: **${s.antiRaid ? 'ON' : 'OFF'}**`, `Destructive-action alerts: **${s.antiDestructiveActions ? 'ON' : 'OFF'}**`
          ]), { ephemeral: true }));
        }
        if (!isManager(interaction.member)) return interaction.reply({ content: 'You need Manage Server or Administrator.', ephemeral: true });
        const member = interaction.options.getMember('user');
        if (!member) return interaction.reply({ content: 'That member could not be found.', ephemeral: true });
        const minutes = interaction.options.getInteger('minutes');
        const reason = interaction.options.getString('reason');
        await member.timeout(minutes * 60000, reason);
        await log(interaction.guild, `${interaction.user} timed out ${member.user.tag} for ${minutes} minutes. Reason: ${safe(reason)}`);
        return interaction.reply({ content: `Timed out ${member.user.tag} for ${minutes} minutes.`, ephemeral: true });
      }
      if (interaction.commandName === 'staff') {
        if (!isStaff(interaction.member, cfg)) return interaction.reply({ content: 'You are not authorized to use staff management.', ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        const rec = recordsFor(interaction.guildId, user.id);
        const now = new Date().toISOString();
        if (sub === 'profile') {
          const format = (arr) => arr.length ? arr.map((r,i)=>`${i+1}. ${safe(r.reason || r.text)} — <@${r.by}> (${new Date(r.at).toLocaleDateString()})`).join('\n') : 'None';
          const leave = rec.loa ? `Active: ${safe(rec.loa.details)} (recorded ${new Date(rec.loa.at).toLocaleDateString()})` : 'Not on leave';
          return interaction.reply(v2Payload(card(`Staff record: ${user.tag}`, [
            `Warnings: **${rec.warnings.length}**\n${format(rec.warnings)}`,
            `Strikes: **${rec.strikes.length}**\n${format(rec.strikes)}`,
            `Notes: **${rec.notes.length}**\n${format(rec.notes)}`,
            `Leave status: ${leave}`,
            `History: ${rec.history.length ? rec.history.slice(-8).map(x=>safe(x)).join('\n') : 'No history recorded.'}`
          ]), { ephemeral: true }));
        }
        if (sub === 'warn' || sub === 'strike' || sub === 'note') {
          const reason = interaction.options.getString(sub === 'note' ? 'note' : 'reason');
          const key = sub === 'warn' ? 'warnings' : sub === 'strike' ? 'strikes' : 'notes';
          rec[key].push({ reason, by: interaction.user.id, at: now });
          rec.history.push(`${sub.toUpperCase()} recorded by ${interaction.user.tag}: ${reason}`);
          save();
          await log(interaction.guild, `${interaction.user} recorded a ${sub} for ${user.tag}: ${safe(reason)}`);
          return interaction.reply({ content: `${sub[0].toUpperCase()+sub.slice(1)} recorded for ${user.tag}.`, ephemeral: true });
        }
        if (sub === 'loa') {
          const details = interaction.options.getString('details');
          rec.loa = { details, by: interaction.user.id, at: now };
          rec.history.push(`Leave of absence recorded: ${details}`); save();
          await log(interaction.guild, `${user.tag} was placed on leave by ${interaction.user}: ${safe(details)}`);
          return interaction.reply({ content: `Leave recorded for ${user.tag}.`, ephemeral: true });
        }
        if (sub === 'return') {
          rec.loa = null; rec.history.push(`Marked returned by ${interaction.user.tag}`); save();
          await log(interaction.guild, `${user.tag} was marked as returned by ${interaction.user}.`);
          return interaction.reply({ content: `${user.tag} marked as returned.`, ephemeral: true });
        }
        if (sub === 'promote' || sub === 'demote') {
          if (!member) return interaction.reply({ content: 'That member is no longer in this server.', ephemeral: true });
          const role = interaction.options.getRole('role');
          const reason = interaction.options.getString('reason') || 'No reason supplied';
          if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ content: 'I cannot manage that role. Move my bot role above it.', ephemeral: true });
          if (sub === 'promote') await member.roles.add(role); else await member.roles.remove(role);
          rec.history.push(`${sub.toUpperCase()}: ${role.name} — ${reason} (by ${interaction.user.tag})`); save();
          await log(interaction.guild, `${user.tag} ${sub}d: ${role.name}. Reason: ${safe(reason)}. By ${interaction.user}.`);
          return interaction.reply({ content: `${role.name} ${sub === 'promote' ? 'assigned to' : 'removed from'} ${user.tag}.`, ephemeral: true });
        }
        if (sub === 'remove-record') {
          const type = interaction.options.getString('type');
          const number = interaction.options.getInteger('number');
          if (!rec[type][number - 1]) return interaction.reply({ content: 'That record number does not exist.', ephemeral: true });
          const removed = rec[type].splice(number - 1, 1)[0];
          rec.history.push(`${type} record ${number} removed by ${interaction.user.tag}: ${removed.reason || removed.text}`); save();
          await log(interaction.guild, `${interaction.user} removed ${type} record ${number} from ${user.tag}.`);
          return interaction.reply({ content: `Record ${number} removed.`, ephemeral: true });
        }
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'cfg_page') {
      if (!isManager(interaction.member)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      return interaction.update(v2Payload(makeConfigPanel(interaction.guildId, interaction.values[0])));
    }
    if (interaction.isRoleSelectMenu() && interaction.customId === 'cfg_staff_role') {
      if (!isManager(interaction.member)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      configFor(interaction.guildId).staffRoleId = interaction.values[0] || null; save();
      return interaction.update(v2Payload(makeConfigPanel(interaction.guildId, 'overview')));
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'cfg_log_channel') {
      if (!isManager(interaction.member)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      configFor(interaction.guildId).logChannelId = interaction.values[0] || null; save();
      return interaction.update(v2Payload(makeConfigPanel(interaction.guildId, 'overview')));
    }
    if (interaction.isButton() && interaction.customId.startsWith('cfg_toggle:')) {
      if (!isManager(interaction.member)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const key = interaction.customId.split(':')[1];
      const cfg = configFor(interaction.guildId);
      if (!(key in cfg.security)) return interaction.reply({ content: 'Unknown setting.', ephemeral: true });
      cfg.security[key] = !cfg.security[key]; save();
      return interaction.update(v2Payload(makeConfigPanel(interaction.guildId, 'security')));
    }
    if (interaction.isButton() && interaction.customId === 'cfg_thresholds') {
      if (!isManager(interaction.member)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('cfg_thresholds_modal').setTitle('Security thresholds');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spam').setLabel('Messages before anti-spam action (2-15)').setStyle(TextInputStyle.Short).setValue(String(configFor(interaction.guildId).security.spamLimit)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('raid').setLabel('Joins before anti-raid action (2-30)').setStyle(TextInputStyle.Short).setValue(String(configFor(interaction.guildId).security.raidJoinLimit)).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timeout').setLabel('Timeout minutes (1-1440)').setStyle(TextInputStyle.Short).setValue(String(configFor(interaction.guildId).security.timeoutMinutes)).setRequired(true))
      );
      return interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'cfg_thresholds_modal') {
      if (!isManager(interaction.member)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const spam = Number(interaction.fields.getTextInputValue('spam'));
      const raid = Number(interaction.fields.getTextInputValue('raid'));
      const timeout = Number(interaction.fields.getTextInputValue('timeout'));
      if (!Number.isInteger(spam) || spam < 2 || spam > 15 || !Number.isInteger(raid) || raid < 2 || raid > 30 || !Number.isInteger(timeout) || timeout < 1 || timeout > 1440) return interaction.reply({ content: 'Invalid values. Check the allowed ranges and try again.', ephemeral: true });
      const sec = configFor(interaction.guildId).security;
      sec.spamLimit = spam; sec.raidJoinLimit = raid; sec.timeoutMinutes = timeout; save();
      return interaction.reply(v2Payload(makeConfigPanel(interaction.guildId, 'security'), { ephemeral: true }));
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = { content: 'Something went wrong. Check the bot console for details.', ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot || !message.member) return;
  const cfg = configFor(message.guild.id), s = cfg.security;
  const content = message.content || '';
  const isTrusted = isManager(message.member) || (cfg.staffRoleId && message.member.roles.cache.has(cfg.staffRoleId));
  if (isTrusted) return;
  let violation = null;
  const invites = /(discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(content);
  const urls = /https?:\/\//i.test(content);
  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (s.antiInvites && invites) violation = 'Posting Discord invite links is disabled.';
  else if (s.antiLinks && urls) violation = 'Posting external links is disabled.';
  else if (s.antiMassMentions && mentions >= s.mentionLimit) violation = 'Mass mentioning is not allowed.';
  if (!violation && s.antiSpam) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const arr = (messageHistory.get(key) || []).filter(t => now - t < s.spamWindowMs);
    arr.push(now); messageHistory.set(key, arr);
    if (arr.length >= s.spamLimit) violation = 'Spam detected.';
  }
  if (violation) {
    await message.delete().catch(() => {});
    await message.member.timeout(s.timeoutMinutes * 60000, violation).catch(() => {});
    await log(message.guild, `Security action: ${message.author.tag} was actioned in ${message.channel} for ${violation}`);
  }
});

client.on('guildMemberAdd', async member => {
  const cfg = configFor(member.guild.id), s = cfg.security;
  if (!s.antiRaid) return;
  const now = Date.now(), key = member.guild.id;
  const arr = (joinHistory.get(key) || []).filter(t => now - t < s.raidWindowMs);
  arr.push(now); joinHistory.set(key, arr);
  if (arr.length >= s.raidJoinLimit) {
    await log(member.guild, `Possible raid detected: ${arr.length} members joined within ${Math.round(s.raidWindowMs/1000)} seconds. Review new members and consider enabling Discord verification level or pausing invites.`);
  }
});

async function monitorDeletion(guild, executorId, type, targetName) {
  const cfg = configFor(guild.id);
  if (!cfg.security.antiDestructiveActions) return;
  const auditType = type === 'channel' ?  channelAuditType : roleAuditType;
  const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find(e => e.target?.name === targetName && Date.now() - e.createdTimestamp < 10000);
  const executor = entry?.executor;
  if (!executor || executor.bot || executor.id === client.user.id) return;
  const key = `${guild.id}:${executor.id}`;
  const now = Date.now();
  const arr = (deletionHistory.get(key) || []).filter(t => now - t < 30000);
  arr.push(now); deletionHistory.set(key, arr);
  await log(guild, `Destructive action alert: ${executor.tag} deleted a ${type} named ${targetName}. Recent deletions: ${arr.length}.`);
  if (arr.length >= 3) {
    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (member && !isManager(member)) await member.timeout(30 * 60000, 'Repeated destructive actions detected').catch(() => {});
  }
}
const channelAuditType = 12; // AuditLogEvent.ChannelDelete
const roleAuditType = 32; // AuditLogEvent.RoleDelete
client.on('channelDelete', channel => monitorDeletion(channel.guild, null, 'channel', channel.name));
client.on('roleDelete', role => monitorDeletion(role.guild, null, 'role', role.name));

registerCommands().then(() => client.login(TOKEN)).catch(err => { console.error('Startup failed:', err); process.exit(1); });
