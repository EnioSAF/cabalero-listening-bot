import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { BotContext, Command } from '../types.js';
import { prepareClear } from '../lib/clear.js';
import {
  ensureChannelConfig,
  getChannelConfig,
  getSession,
  updateChannelConfig,
} from '../db.js';
import { closeSession, openSession } from '../lib/sessions.js';
import { syncSchedules } from '../lib/scheduler.js';
import { isValidTimezone } from '../lib/time.js';
import { persona } from '../lib/persona.js';
import { parseRoles, serializeRoles } from '../lib/moderation.js';

const DAY_CHOICES = [
  { name: 'Lundi', value: 1 },
  { name: 'Mardi', value: 2 },
  { name: 'Mercredi', value: 3 },
  { name: 'Jeudi', value: 4 },
  { name: 'Vendredi', value: 5 },
  { name: 'Samedi', value: 6 },
  { name: 'Dimanche', value: 0 },
];

const DAY_NAMES: Record<string, string> = {
  '0': 'dimanche',
  '7': 'dimanche',
  '1': 'lundi',
  '2': 'mardi',
  '3': 'mercredi',
  '4': 'jeudi',
  '5': 'vendredi',
  '6': 'samedi',
};

function parseHHMM(value: string): { hh: number; mm: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m || !m[1] || !m[2]) return null;
  return { hh: Number(m[1]), mm: Number(m[2]) };
}

function timeFromCron(cronExpr: string): { hh: string; mm: string } {
  const f = cronExpr.split(/\s+/);
  return { mm: f[0] ?? '0', hh: f[1] ?? '0' };
}

function dayFromCron(cronExpr: string): string {
  const f = cronExpr.split(/\s+/);
  return f[4] ?? '1';
}

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

const data = new SlashCommandBuilder()
  .setName('session')
  .setDescription("Gère les sessions d'écoute (anti-doublon / anti-flood)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s.setName('start').setDescription('Ouvre une session d\'écoute sur ce salon')
  )
  .addSubcommand((s) =>
    s.setName('stop').setDescription('Ferme la session d\'écoute de ce salon')
  )
  .addSubcommand((s) =>
    s.setName('status').setDescription('Affiche l\'état du bot sur ce salon')
  )
  .addSubcommand((s) =>
    s
      .setName('config')
      .setDescription('Active et règle le bot sur ce salon')
      .addBooleanOption((o) =>
        o.setName('actif').setDescription('Activer (true) ou désactiver (false) le bot ici')
      )
      .addIntegerOption((o) =>
        o
          .setName('cooldown')
          .setDescription('Délai minimum en secondes entre deux sons (défaut 30)')
          .setMinValue(0)
          .setMaxValue(3600)
      )
      .addIntegerOption((o) =>
        o
          .setName('flood_max')
          .setDescription('Nb de messages avant blocage anti-flood (défaut 5)')
          .setMinValue(1)
          .setMaxValue(50)
      )
      .addIntegerOption((o) =>
        o
          .setName('flood_fenetre')
          .setDescription('Fenêtre anti-flood en secondes (défaut 10)')
          .setMinValue(1)
          .setMaxValue(600)
      )
      .addBooleanOption((o) =>
        o
          .setName('sons_uniquement')
          .setDescription('Supprimer aussi les messages sans son (défaut non)')
      )
      .addBooleanOption((o) =>
        o
          .setName('un_son_par_personne')
          .setDescription('Limiter chaque personne à un seul son par session (défaut non)')
      )
      .addChannelOption((o) =>
        o
          .setName('salon_backup')
          .setDescription('Salon privé où répliquer le salon en fin de session')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addRoleOption((o) =>
        o
          .setName('role_bypass')
          .setDescription('Ajoute/retire un rôle exempté de toutes les règles (bascule)')
      )
  )
  .addSubcommand((s) =>
    s
      .setName('clear')
      .setDescription('Supprime (avec confirmation) les messages de la dernière session')
  )
  .addSubcommand((s) =>
    s
      .setName('schedule')
      .setDescription('Planning automatique (ouverture/fermeture)')
      .addBooleanOption((o) =>
        o.setName('actif').setDescription('Activer le planning automatique')
      )
      .addStringOption((o) =>
        o.setName('ouverture').setDescription("Heure d'ouverture, format HH:MM (ex 20:00)")
      )
      .addStringOption((o) =>
        o.setName('fermeture').setDescription('Heure de fermeture, format HH:MM (ex 23:00)')
      )
      .addIntegerOption((o) =>
        o.setName('jour').setDescription('Jour de la semaine').addChoices(...DAY_CHOICES)
      )
      .addStringOption((o) =>
        o.setName('fuseau').setDescription('Fuseau horaire (ex: Europe/Paris)')
      )
  );

async function handleStart(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  // openSession fait un appel réseau (annonce) : on diffère pour ne pas griller
  // la fenêtre de 3s du token d'interaction.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channelId = interaction.channelId;
  const guildId = interaction.guildId!;
  ensureChannelConfig(channelId, guildId);
  const result = await openSession(ctx.client, channelId, guildId, interaction.user.id);
  await interaction.editReply(
    result.alreadyOpen
      ? 'ℹ️ Une séance est déjà ouverte sur ce salon.'
      : persona.startReply()
  );
}

async function handleStop(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await closeSession(ctx.client, interaction.channelId, interaction.user.id);
  await interaction.editReply(
    result.closed
      ? `🛑 Session fermée. ${result.total} son(s) de ${result.posters} participant(s).`
      : 'ℹ️ Aucune session ouverte sur ce salon.'
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const cfg = getChannelConfig(interaction.channelId);
  if (!cfg) {
    await interaction.reply(
      ephemeral(
        '⚪ Le bot n\'est pas activé sur ce salon. Utilise `/session config actif:true` pour l\'activer.'
      )
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`**Bot actif ici :** ${cfg.managed === 1 ? 'oui ✅' : 'non ⚪'}`);

  if (cfg.active_session_id !== null) {
    const session = getSession(cfg.active_session_id);
    const since = session ? `<t:${Math.floor(session.started_at / 1000)}:R>` : '—';
    lines.push(`**Session :** ouverte 🟢 (depuis ${since})`);
  } else {
    lines.push('**Session :** fermée 🔴');
  }

  lines.push(
    `**Cooldown entre sons :** ${cfg.cooldown_sec}s`,
    `**Anti-flood :** ${cfg.flood_max} msg / ${cfg.flood_window_sec}s`,
    `**Salon sons uniquement :** ${cfg.require_submission === 1 ? 'oui' : 'non'}`,
    `**1 son / personne :** ${cfg.one_per_person === 1 ? 'oui' : 'non'}`,
    `**Rôles bypass :** ${
      parseRoles(cfg.bypass_roles)
        .map((r) => `<@&${r}>`)
        .join(' ') || 'aucun'
    }`,
    `**Salon de backup :** ${cfg.backup_channel_id ? `<#${cfg.backup_channel_id}>` : 'aucun'}`
  );

  if (cfg.auto_schedule === 1) {
    const o = timeFromCron(cfg.open_cron);
    const c = timeFromCron(cfg.close_cron);
    const day = DAY_NAMES[dayFromCron(cfg.open_cron)] ?? 'lundi';
    // Le planning ne tourne réellement que si le bot est activé sur le salon.
    const head =
      cfg.managed === 1 ? 'activé 🗓️' : 'configuré mais **inactif** (bot désactivé ici)';
    lines.push(
      `**Planning auto :** ${head} — ${day} ${o.hh}:${o.mm} → ${c.hh}:${c.mm} (${cfg.timezone})`
    );
  } else {
    lines.push('**Planning auto :** désactivé');
  }

  await interaction.reply(ephemeral(lines.join('\n')));
}

async function handleConfig(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channelId = interaction.channelId;
  const guildId = interaction.guildId!;
  const before = ensureChannelConfig(channelId, guildId);

  const actif = interaction.options.getBoolean('actif');
  const cooldown = interaction.options.getInteger('cooldown');
  const floodMax = interaction.options.getInteger('flood_max');
  const floodWindow = interaction.options.getInteger('flood_fenetre');
  const sonsUniquement = interaction.options.getBoolean('sons_uniquement');
  const unSonParPersonne = interaction.options.getBoolean('un_son_par_personne');
  const salonBackup = interaction.options.getChannel('salon_backup');
  const roleBypass = interaction.options.getRole('role_bypass');

  updateChannelConfig(channelId, {
    ...(actif !== null ? { managed: actif ? 1 : 0 } : {}),
    ...(cooldown !== null ? { cooldown_sec: cooldown } : {}),
    ...(floodMax !== null ? { flood_max: floodMax } : {}),
    ...(floodWindow !== null ? { flood_window_sec: floodWindow } : {}),
    ...(sonsUniquement !== null ? { require_submission: sonsUniquement ? 1 : 0 } : {}),
    ...(unSonParPersonne !== null ? { one_per_person: unSonParPersonne ? 1 : 0 } : {}),
    ...(salonBackup ? { backup_channel_id: salonBackup.id } : {}),
  });

  // Le statut "managed" influe sur les plannings auto : on resynchronise.
  syncSchedules(ctx.client);

  let msg = '✅ Configuration mise à jour. (`/session status` pour voir le détail.)';
  // Désactiver le bot rend le planning auto inerte : on prévient le staff.
  if (actif === false && before.auto_schedule === 1) {
    msg +=
      '\n⚠️ Le planning automatique est désormais **inactif** tant que le bot est désactivé sur ce salon.';
  }

  // Bascule d'un rôle bypass (ajout si absent, retrait si présent).
  if (roleBypass) {
    const current = parseRoles(before.bypass_roles);
    if (current.includes(roleBypass.id)) {
      const next = current.filter((r) => r !== roleBypass.id);
      updateChannelConfig(channelId, { bypass_roles: serializeRoles(next) });
      msg += `\n➖ Rôle <@&${roleBypass.id}> **retiré** des bypass.`;
    } else {
      updateChannelConfig(channelId, { bypass_roles: serializeRoles([...current, roleBypass.id]) });
      msg += `\n🛡️ Rôle <@&${roleBypass.id}> **ajouté** aux bypass (exempté de toutes les règles).`;
    }
  }

  // Vérifie tout de suite que le bot peut bien écrire/répliquer dans le salon de backup.
  const guild = interaction.guild;
  if (salonBackup && guild) {
    try {
      const me = await guild.members.fetchMe();
      const channel = await guild.channels.fetch(salonBackup.id);
      const perms = channel?.permissionsFor(me);
      const missing = (
        [
          [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
          [PermissionFlagsBits.SendMessages, 'Envoyer des messages'],
          [PermissionFlagsBits.ManageWebhooks, 'Gérer les webhooks'],
        ] as const
      )
        .filter(([bit]) => !perms?.has(bit))
        .map(([, label]) => label);
      if (missing.length > 0) {
        msg += `\n⚠️ Permissions manquantes sur <#${salonBackup.id}> : ${missing.join(
          ', '
        )}. Le backup échouera tant qu'elles ne sont pas accordées.`;
      }
    } catch {
      // Vérification best-effort : on n'échoue pas la commande pour autant.
    }
  }

  await interaction.editReply(msg);
}

async function handleSchedule(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const channelId = interaction.channelId;
  const guildId = interaction.guildId!;
  const cfg = ensureChannelConfig(channelId, guildId);

  const actif = interaction.options.getBoolean('actif');
  const ouverture = interaction.options.getString('ouverture');
  const fermeture = interaction.options.getString('fermeture');
  const jour = interaction.options.getInteger('jour');
  const fuseau = interaction.options.getString('fuseau');

  const patch: Parameters<typeof updateChannelConfig>[1] = {};

  if (ouverture !== null || jour !== null) {
    const t = ouverture !== null ? parseHHMM(ouverture) : timeFromCron(cfg.open_cron);
    if (t === null) {
      await interaction.reply(ephemeral('❌ Heure d\'ouverture invalide. Format attendu : `HH:MM` (ex 20:00).'));
      return;
    }
    const day = jour !== null ? jour : Number(dayFromCron(cfg.open_cron));
    patch.open_cron = `${Number(t.mm)} ${Number(t.hh)} * * ${day}`;
  }

  if (fermeture !== null || jour !== null) {
    const t = fermeture !== null ? parseHHMM(fermeture) : timeFromCron(cfg.close_cron);
    if (t === null) {
      await interaction.reply(ephemeral('❌ Heure de fermeture invalide. Format attendu : `HH:MM` (ex 23:00).'));
      return;
    }
    const day = jour !== null ? jour : Number(dayFromCron(cfg.close_cron));
    patch.close_cron = `${Number(t.mm)} ${Number(t.hh)} * * ${day}`;
  }

  if (fuseau !== null) {
    if (!isValidTimezone(fuseau)) {
      await interaction.reply(ephemeral(`❌ Fuseau horaire inconnu : \`${fuseau}\` (ex: Europe/Paris).`));
      return;
    }
    patch.timezone = fuseau;
  }

  if (actif !== null) patch.auto_schedule = actif ? 1 : 0;

  updateChannelConfig(channelId, patch);
  syncSchedules(ctx.client);

  const updated = getChannelConfig(channelId)!;
  const o = timeFromCron(updated.open_cron);
  const c = timeFromCron(updated.close_cron);
  const day = DAY_NAMES[dayFromCron(updated.open_cron)] ?? 'lundi';
  await interaction.reply(
    ephemeral(
      `🗓️ Planning ${updated.auto_schedule === 1 ? '**activé**' : 'désactivé'} — ` +
        `${day} ${o.hh}:${o.mm} → ${c.hh}:${c.mm} (${updated.timezone}).`
    )
  );
}

export const command: Command = {
  data,
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) {
      await interaction.reply(ephemeral('Cette commande s\'utilise dans un serveur.'));
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply(ephemeral('⛔ Réservé au staff (permission « Gérer les messages »).'));
      return;
    }

    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'start':
        return handleStart(interaction, ctx);
      case 'stop':
        return handleStop(interaction, ctx);
      case 'status':
        return handleStatus(interaction);
      case 'config':
        return handleConfig(interaction, ctx);
      case 'clear':
        return prepareClear(interaction);
      case 'schedule':
        return handleSchedule(interaction, ctx);
      default:
        await interaction.reply(ephemeral('Sous-commande inconnue.'));
    }
  },
};
