/**
 * Personnalité du bot « Ganondorf » : modération sèche, refs à Caba et
 * aux petites leçons, sans ton d'assistant ni surcharge d'emojis.
 * Tous les textes adressés aux humains passent par ici — un seul endroit à régler
 * pour ajuster le ton.
 */

// Formats timeout durations for moderation messages.
function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

// Picks one line from a small community-made message pool.
function pick<const T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

// Formats a Discord quote block, including multiline quotes.
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

// Builds the common user-facing moderation notice.
function sanctionNotice(sanction: string, reason: string, line: string): string {
  return `## **SANCTION**\n${sanction}\n\n## **RAISON**\n${reason}\n\n${quote(line)}`;
}

const FLOOD_WARNINGS = [
  '**Doucement.** Tu baves beaucoup trop dans ce maudit channel.\n' +
    'Ceci est un avertissement, continue et tu seras mis au cachot vil gredin.',
  '**Pourquoi tu fais du forcing ?**\n' +
    'Tu feras gaffe, t\'as oublié d\'être pertinent.',
  '**Roule, vers le TO vers le ban mon ami.**\n' +
    'J\'ai dit roule, vers le TO vers le ban mon ami.',
] as const;

const DUPLICATE_JABS = [
  'T\'as pas le comportement du chef.',
  'Pourquoi tu fais du forcing ?',
  'Tu feras gaffe, t\'as oublié d\'être pertinent.',
  'T\'es un Pokémon rare, type chiant.',
] as const;

const COOLDOWN_WARNINGS = [
  'Pourquoi tu fais du forcing ?',
  'T\'as pas le comportement du chef.',
] as const;

const TIMEOUT_WARNINGS = [
  'Roule, vers le TO vers le ban mon ami.\nJ\'ai dit roule, vers le TO vers le ban mon ami.',
  'Si tu te fais time-out tu te fais time-out 35 heures (d\'une traite.)',
  'Je te time out plus que prévu.',
  'Demain. Tu es. plus laaa aaaaa.',
] as const;

// Picks the quote attached to a real timeout sanction.
function timeoutQuote(ms: number): string {
  if (ms === 20 * 60_000) {
    return 'Va nettoyer la chemise de Caba avec de l\'eau chaude et reviens quand elle sera propre.';
  }

  if (ms >= 60 * 60_000) {
    return 'Et hop, une heure de colle.';
  }

  return pick(TIMEOUT_WARNINGS);
}

export const persona = {
  // --- Public session announcements ---

  // Sent in the submission channel when a listening session starts.
  announceOpen(): string {
    return (
      '## **🟢 La séance d\'écoute est ouverte. 🟢**\n' +
      'Dépose ton son pour le Profesor : **un lien** ou **un fichier audio**, proprement.\n\n' +
      '**Petite leçon de Ganondorf :**\n' +
      '• Un son ne passe qu\'une seule fois. Le doublon finit au cachot.\n' +
      '• Pas de spam dans le salon, un seul son par personne ou Ganondorf sévira.\n\n' +
      '• Envoyer un son dans un autre channel (non dédié) vous exclus 24h.\n\n' +
      'Faites entrer les morceaux. **El Profesor** est prêt à vous juger les étudiants mutants.'
    );
  },

  // Sent in the submission channel when a listening session ends.
  announceClose(total: number, posters: number, sanctionSummary = ''): string {
    return (
      '## **🔴 La séance d\'écoute est fermée. 🔴**\n' +
      `**${total}** son(s) déposé(s) par **${posters}** personne(s). ` +
      'Ganondorf a rangé le registre, **El Grande Profesor** se charge de la suite.\n' +
      'Rendez-vous Lundi 20H pour la prochaine écoute.' +
      (sanctionSummary ? `\n\n${sanctionSummary}` : '')
    );
  },

  // --- User warnings sent by DM or temporary channel notice ---

  // Prefix used before explaining why a user message was removed or flagged.
  removedHead(deleted: boolean, channelName: string): string {
    return deleted
      ? `**Ganondorf a supprimé ton message** dans **#${channelName}**.`
      : `**Ganondorf a un mot sur ton message** dans **#${channelName}** :`;
  },

  // Sent when a user posts too many messages too quickly.
  flood(timeoutMs = 0): string {
    const sanction =
      timeoutMs > 0
        ? `Message supprimé + timeout de **${formatDuration(timeoutMs)}**.`
        : 'Message supprimé + avertissement anti-flood.';

    return sanctionNotice(
      sanction,
      'Tu as envoyé trop de messages trop vite dans le salon de dépôt.',
      timeoutMs > 0 ? timeoutQuote(timeoutMs) : pick(FLOOD_WARNINGS)
    );
  },

  // Sent when a message contains no valid music link or audio file.
  requireSubmission(): string {
    return sanctionNotice(
      'Message supprimé.',
      'Ton message ne contient aucun lien de musique ni fichier audio valide.',
      'Ce salon sert à déposer des sons pour Caba. Pour discuter, il y a le reste du Discord.'
    );
  },

  // Sent when every submitted track is already registered.
  duplicate(link: string, multi: boolean, strike: number, timeoutMs = 0): string {
    const what = multi ? 'ces sons' : 'ce son';
    const sanction =
      timeoutMs > 0
        ? `Message supprimé + timeout de **${formatDuration(timeoutMs)}**.`
        : 'Message supprimé + avertissement doublon.';
    const reason = `${multi ? 'Tous les sons envoyés sont déjà' : 'Le son envoyé est déjà'} enregistré dans cette session : ${link}`;
    const tiers = [
      // First duplicate: simple reminder.
      'Petite leçon de Caba, validée par Ganondorf : un son, une seule fois.\n' +
        pick(DUPLICATE_JABS),
      // Second duplicate: firmer warning.
      `Encore le même bail. Deuxième fois que tu renvoies ${what}.\n` + pick(DUPLICATE_JABS),
      // Third duplicate: final warning before sanction.
      'Troisième doublon. Dernier rappel avant sanction : un son, une fois.\n' +
        pick(DUPLICATE_JABS),
      // Fourth duplicate and after: sanction warning.
      `Stop. Tu repostes ${what} en boucle malgré le registre.\n` +
        pick(DUPLICATE_JABS),
    ];
    const idx = Math.min(Math.max(strike, 1), tiers.length) - 1;
    return sanctionNotice(sanction, reason, timeoutMs > 0 ? timeoutQuote(timeoutMs) : tiers[idx]!);
  },

  // Sent when the session allows only one submission per user.
  oneOnly(): string {
    return sanctionNotice(
      'Message supprimé.',
      'La session est configurée sur un seul son par personne, et tu as déjà déposé le tien.',
      'Ganondorf ne prend pas les bonus tracks. Garde le prochain pour lundi.'
    );
  },

  // Sent when a first message contains several tracks in one-track-per-person mode.
  oneOnlyMultiple(): string {
    return sanctionNotice(
      'Message supprimé.',
      'La session est configurée sur un seul son par personne, mais ton message en contient plusieurs.',
      'Choisis-en un seul et renvoie-le. Ganondorf ne prend pas les compilations.'
    );
  },

  // Sent when a user must wait before posting another valid submission.
  cooldown(seconds: number): string {
    return sanctionNotice(
      'Message supprimé.',
      `Tu dois encore attendre **${seconds}s** avant de poster un autre son valide.`,
      pick(COOLDOWN_WARNINGS)
    );
  },

  // Sent when a message has both new tracks and duplicate tracks.
  partialDuplicate(count: number, link: string): string {
    const already = count === 1 ? 'était déjà' : 'étaient déjà';
    return (
      'Tes nouveaux sons sont gardés. Par contre, ' +
      `**${count}** ${already} au registre (ex. ${link}), donc recalé(s).\n` +
      'Petite leçon : un doublon ne devient pas neuf parce qu\'il revient avec le groupe.'
    );
  },

  // --- Staff command replies ---

  // Reply to staff after manually opening a listening session.
  startReply(): string {
    return 'Séance ouverte. Ganondorf surveille les doublons, Caba peut lancer les écoutes.';
  },

  // --- Backup messages ---

  // Header for the backup copy of a completed listening session.
  backupHeader(sessionId: number, channelId: string): string {
    return `**Archives de Ganondorf — séance #${sessionId}** de <#${channelId}>`;
  },

  // --- Clear-session confirmation flow ---

  // Confirmation text before deleting messages from the last session.
  clearConfirm(count: number, sessionId: number, fromTs: number, toTs: number, capNote: string): string {
    return (
      `Ganondorf va supprimer **${count} message(s)** de la séance ` +
      `#${sessionId} (du <t:${fromTs}:f> au <t:${toTs}:f>). Cette purge est **irréversible**.${capNote}`
    );
  },

  // Label for the destructive clear confirmation button.
  clearButton(count: number): string {
    return `Supprimer ${count} message(s)`;
  },

  // Sent when staff cancels the clear confirmation flow.
  clearCancel(): string {
    return 'Purge annulée. Le registre reste comme il est.';
  },

  // Final report after attempting to delete session messages.
  clearDone(deleted: number, tooOld: number, failed: number): string {
    let report = `**${deleted} message(s) supprimé(s)** par Ganondorf.`;
    if (tooOld > 0) report += ` ${tooOld} trop ancien(s) (> 14 jours) ont survécu.`;
    if (failed > 0) report += ` ${failed} en échec, voir les logs.`;
    return report;
  },
} as const;
