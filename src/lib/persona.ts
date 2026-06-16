/**
 * Personnalité du bot « Ganondorf » : seigneur du mal grandiloquent + punchlines
 * à la Cabalero + posture de professeur qui distribue ses « petites leçons ».
 * Tous les textes adressés aux humains passent par ici — un seul endroit à régler
 * pour ajuster le ton.
 */

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export const persona = {
  // --- Annonces de session (public) ---
  announceOpen(): string {
    return (
      '🎧👑 **LA SÉANCE DU ROI DU MAL EST OUVERTE.**\n' +
      'Approchez, mortels, et déposez vos sons devant mon trône — **lien** ou **fichier audio**.\n' +
      '📚 *Petit cours avant d\'commencer :*\n' +
      '• **Un son = une seule fois.** Le doublon, c\'est l\'hérésie, et l\'hérésie je la punis. 🗡️\n' +
      '• **Pas de spam** : respire entre deux offrandes, la précipitation c\'est le tombeau du talent.\n' +
      'Que le meilleur son règne sur Hyrule. 🔥'
    );
  },

  announceClose(total: number, posters: number): string {
    return (
      '🛑👑 **LA SÉANCE EST CLOSE.**\n' +
      `**${total}** son(s) déposé(s) par **${posters}** âme(s) courageuse(s). ` +
      'Le Roi a tout consigné dans ses archives. 📜\n' +
      'Reposez-vous, mortels. La nuit vous appartient… jusqu\'à la prochaine. 🌑'
    );
  },

  // --- Avertissements (MP / éphémère) ---
  removedHead(deleted: boolean, channelName: string): string {
    return deleted
      ? `👑 **Décret du Roi du Mal** — ton message dans **#${channelName}** a été réduit en poussière.`
      : `👑 **Décret du Roi du Mal** — un mot sur ton message dans **#${channelName}** :`;
  },

  flood(): string {
    return (
      '🌀 **Doucement, jeune padawan.** Tu mitrailles le salon comme si t\'avais le Triforce de ' +
      'l\'impatience. 📚 Leçon du jour : un bon son se fait désirer. Calme tes ardeurs et reviens poser propre. 🗡️'
    );
  },

  requireSubmission(): string {
    return (
      '📜 Ce salon est un **temple dédié aux sons**, mortel — on y dépose un **lien** ou un ' +
      '**fichier audio**, pas du bavardage. Reviens avec une offrande digne de mon trône. 🎵'
    );
  },

  /**
   * Message de doublon, à intensité croissante selon le nombre de récidives
   * (`strike`) de la personne dans la session.
   */
  duplicate(link: string, multi: boolean, strike: number): string {
    const what = multi ? 'ces sons' : 'ce son';
    const tiers = [
      // 1re fois — le prof recadre poliment.
      `🗡️ **Tu oses ?** ${multi ? 'Ces sons trônent' : 'Ce son trône'} déjà dans mes archives 👉 ${link}\n` +
        '📚 Leçon n°1 : **un son, une fois.** Le Roi du Mal n\'écoute pas deux fois la même chose. 🌑',
      // 2e — agacé.
      `😤 **Encore toi, mortel ?** Deuxième fois que tu me ressers ${what}. 👉 ${link}\n` +
        '📕 Le professeur note un **avertissement** dans ton carnet. Au prochain, je hausse le ton.',
      // 3e — colère.
      `⚡ **SÉRIEUX ?!** Trois fois le même son ?! Tu joues avec les nerfs du Roi du Mal. 👉 ${link}\n` +
        '📚 Dernier rappel du cours : **un. son. une. fois.** Prochaine récidive = sanction. 🗡️',
      // 4e et + — fureur.
      `🌋 **ÇA SUFFIT.** Tu reposes ${what} en boucle malgré mes décrets, misérable. 👉 ${link}\n` +
        '💀 Le Roi a tout vu, tout consigné. Arrête immédiatement… ou subis ma colère.',
    ];
    const idx = Math.min(Math.max(strike, 1), tiers.length) - 1;
    return tiers[idx]!;
  },

  /** Note de sanction ajoutée quand un timeout est réellement appliqué. */
  timeoutNotice(ms: number): string {
    return `🔇 **Réduit au silence pendant ${formatDuration(ms)}.** Médite sur tes fautes, mortel. ⛓️`;
  },

  oneOnly(): string {
    return (
      '👑 **Un seul son par mortel.** Tu as déjà déposé ton offrande devant le Roi du Mal — ' +
      'pas de rab. 📚 Règle de la séance : **une personne, un son.** Choisis bien, et reviens à la prochaine. 🌑'
    );
  },

  cooldown(seconds: number): string {
    return (
      `⏳ **Patience, mortel.** Le pouvoir ne se déchaîne pas n'importe comment — attends encore ` +
      `**${seconds}s** avant ta prochaine offrande. 📚 (La précipitation, c'est le S… mais le mauvais.)`
    );
  },

  partialDuplicate(count: number, link: string): string {
    return (
      '✅ J\'ai gardé tes nouveaux sons, beau geste. 📚 En revanche, ' +
      `**${count}** traînai(en)t déjà dans mes archives (ex. 👉 ${link}) — recalé(s). ` +
      'Un son, une fois, faut suivre le cours. 🗡️'
    );
  },

  // --- Commandes (staff) ---
  startReply(): string {
    return '🎧👑 La séance est ouverte. Le Roi veille sur les doublons et les spammeurs. Que ça commence.';
  },

  // --- Backup ---
  backupHeader(sessionId: number, channelId: string): string {
    return `🗄️👑 **Archives du Roi du Mal — séance #${sessionId}** de <#${channelId}>`;
  },

  // --- Clear ---
  clearConfirm(count: number, sessionId: number, fromTs: number, toTs: number, capNote: string): string {
    return (
      `⚠️ Le Roi s'apprête à **réduire en poussière ${count} message(s)** de la séance ` +
      `#${sessionId} (du <t:${fromTs}:f> au <t:${toTs}:f>). Cette purge est **irréversible**, mortel.${capNote}`
    );
  },
  clearButton(count: number): string {
    return `Réduire ${count} message(s) en poussière`;
  },
  clearCancel(): string {
    return '🛡️ Le Roi a suspendu son geste. Tes messages sont épargnés… pour l\'instant.';
  },
  clearDone(deleted: number, tooOld: number, failed: number): string {
    let report = `🗡️ **${deleted} message(s) réduits en poussière** par le Roi du Mal.`;
    if (tooOld > 0) report += ` ${tooOld} trop ancien(s) (> 14 jours) ont survécu.`;
    if (failed > 0) report += ` ⚠️ ${failed} en échec (le Roi grogne — voir les logs).`;
    return report;
  },
} as const;
