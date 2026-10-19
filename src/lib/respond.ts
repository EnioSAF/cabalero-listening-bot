import { DiscordAPIError, RESTJSONErrorCodes, type Message } from 'discord.js';
import { persona } from './persona.js';

type FullMessage = Message<true>;

/** Envoie un avis à l'auteur en MP, avec repli message éphémère auto-supprimé. */
async function sendNotice(message: FullMessage, text: string): Promise<boolean> {
  try {
    await message.author.send(text);
    return true;
  } catch {
    // MP fermés : repli public temporaire.
  }
  try {
    const notice = await message.channel.send({
      content: `${message.author}, ${text}`,
      allowedMentions: { users: [message.author.id] },
    });
    setTimeout(() => {
      notice.delete().catch(() => {});
    }, 8000);
    return true;
  } catch {
    // Même l'envoi public a échoué : rien de plus à faire.
    return false;
  }
}

export interface ModerationOutcome {
  deleted: boolean;
  warned: boolean;
}

/**
 * Supprime le message fautif et prévient l'auteur. Le message d'avertissement
 * reflète si la suppression a réellement réussi (sinon on n'affirme pas un retrait).
 * Si le bot n'a pas la permission « Gérer les messages », on loggue un avertissement.
 */
export async function removeAndNotify(
  message: FullMessage,
  reason: string
): Promise<ModerationOutcome> {
  let deleted = false;
  try {
    await message.delete();
    deleted = true;
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.MissingPermissions
    ) {
      console.warn(
        `[respond] permission « Gérer les messages » manquante sur #${message.channel.name} (${message.channelId}) — message non supprimé.`
      );
    }
    // Code 10008 (Unknown Message / déjà supprimé) : ignoré silencieusement.
  }

  const head = persona.removedHead(deleted, message.channel.name);
  const warned = await sendNotice(message, `${head}\n${reason}`);
  return { deleted, warned };
}

/** Prévient l'auteur sans rien supprimer (ex. message partiellement accepté). */
export async function notifyAuthor(
  message: FullMessage,
  text: string
): Promise<boolean> {
  return sendNotice(message, text);
}
