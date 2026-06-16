import {
  ChannelType,
  type Client,
  type GuildTextBasedChannel,
  type SendableChannels,
} from 'discord.js';

/** Récupère un salon où le bot peut écrire (hors DM). */
export async function fetchSendableChannel(
  client: Client,
  channelId: string
): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return null;
    if (channel.type === ChannelType.DM || channel.type === ChannelType.GroupDM) {
      return null;
    }
    return channel.isSendable() ? channel : null;
  } catch {
    return null;
  }
}

/** Récupère un salon textuel de serveur (historique des messages + suppression). */
export async function fetchGuildTextChannel(
  client: Client,
  channelId: string
): Promise<GuildTextBasedChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased() && !channel.isDMBased()) {
      return channel;
    }
    return null;
  } catch {
    return null;
  }
}
