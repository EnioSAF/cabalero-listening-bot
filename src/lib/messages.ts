import type { GuildTextBasedChannel, Message } from 'discord.js';

/**
 * Récupère, du plus ancien au plus récent, les messages d'un salon postés dans
 * la fenêtre [startMs, endMs]. Paginé, plafonné à `cap` pour éviter les abus.
 */
export async function collectMessagesInWindow(
  channel: GuildTextBasedChannel,
  startMs: number,
  endMs: number,
  cap = 1000
): Promise<Message<true>[]> {
  const out: Message<true>[] = [];
  let before: string | undefined;

  while (out.length < cap) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    if (batch.size === 0) break;

    let reachedOlder = false;
    for (const msg of batch.values()) {
      const ts = msg.createdTimestamp;
      if (ts < startMs) {
        reachedOlder = true;
        continue;
      }
      if (ts > endMs) continue;
      out.push(msg);
    }

    before = batch.last()?.id;
    if (reachedOlder || batch.size < 100 || !before) break;
  }

  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out.slice(0, cap);
}
