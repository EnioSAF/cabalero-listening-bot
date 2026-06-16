import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './env.js';
import { db } from './db.js';
import { loadCommands, loadEvents } from './loaders.js';

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Pour recevoir aussi les éditions de messages non mis en cache.
  partials: [Partials.Message],
});

client.on('error', (err) => console.error('[client error]', err));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} reçu, arrêt en cours…`);
  // Garde-fou : on force la sortie si l'arrêt traîne.
  setTimeout(() => process.exit(0), 5000).unref();
  try {
    await client.destroy();
  } catch {
    // ignore
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {
    // ignore
  }
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => void shutdown(sig));
}

async function main(): Promise<void> {
  const commands = await loadCommands();
  await loadEvents(client, commands);
  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error('[bootstrap] échec au démarrage :', err);
  process.exit(1);
});
