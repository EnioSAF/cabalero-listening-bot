import { REST, Routes } from 'discord.js';
import { env } from './env.js';
import { loadCommands } from './loaders.js';

const commands = await loadCommands();
const body = commands.map((c) => c.data.toJSON());

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

try {
  await rest.put(route, { body });
  console.log(
    `✅ ${body.length} commande(s) déployée(s) ${
      env.DISCORD_GUILD_ID ? `sur le serveur ${env.DISCORD_GUILD_ID}` : 'globalement'
    }.`
  );
} catch (err) {
  console.error('❌ Échec du déploiement des commandes :', err);
  process.exit(1);
}
