import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Collection, type Client, type ClientEvents } from 'discord.js';
import type { BotContext, BotEvent, Command } from './types.js';

function listModules(dirUrl: URL): string[] {
  const dirPath = fileURLToPath(dirUrl);
  return readdirSync(dirPath)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'))
    .map((f) => pathToFileURL(join(dirPath, f)).href);
}

export async function loadCommands(): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  for (const href of listModules(new URL('./commands/', import.meta.url))) {
    const mod = (await import(href)) as { command?: Command; default?: Command };
    const cmd = mod.command ?? mod.default;
    if (cmd?.data && typeof cmd.execute === 'function') {
      commands.set(cmd.data.name, cmd);
    } else {
      console.warn(`[loaders] commande ignorée (export invalide) : ${href}`);
    }
  }
  return commands;
}

export async function loadEvents(
  client: Client,
  commands: Collection<string, Command>
): Promise<void> {
  const ctx: BotContext = { client, commands };
  for (const href of listModules(new URL('./events/', import.meta.url))) {
    const mod = (await import(href)) as { event?: BotEvent; default?: BotEvent };
    const ev = mod.event ?? mod.default;
    if (!ev?.name || typeof ev.execute !== 'function') {
      console.warn(`[loaders] événement ignoré (export invalide) : ${href}`);
      continue;
    }

    const handler = (...args: ClientEvents[keyof ClientEvents]) =>
      ev.execute(...(args as never), ctx);

    if (ev.once) client.once(ev.name, handler);
    else client.on(ev.name, handler);
  }
}
