import { DiscordAPIError, RESTJSONErrorCodes, type Message } from 'discord.js';
import { persona } from './persona.js';

type FullMessage = Message<true>;

/** Envoie un avis à l'auteur en MP, avec repli message éphémère auto-supprimé. */
async function sendNotice(message: FullMessage, text: string): Promise<void> {
  try {
    await message.author.send(text);
    return;
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
  } catch {
    // Même l'envoi public a échoué : rien de plus à faire.
  }
}

/**
 * Supprime le message fautif et prévient l'auteur. Le message d'avertissement
 * reflète si la suppression a réellement réussi (sinon on n'affirme pas un retrait).
 * Si le bot n'a pas la permission « Gérer les messages », on loggue un avertissement.
 */
export async function removeAndNotify(
  message: FullMessage,
  reason: string
): Promise<void> {
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
  await sendNotice(message, `${head}\n${reason}`);
}

/** Prévient l'auteur sans rien supprimer (ex. message partiellement accepté). */
export async function notifyAuthor(
  message: FullMessage,
  text: string
): Promise<void> {
  await sendNotice(message, text);
}
