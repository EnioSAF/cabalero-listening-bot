import 'dotenv/config';
import { z } from 'zod';
import { isValidTimezone } from './lib/time.js';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN manquant'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID manquant'),
  DISCORD_GUILD_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  DATABASE_PATH: z.string().default('./data/bot.db'),
  DEFAULT_TIMEZONE: z
    .string()
    .default('Europe/Paris')
    .refine(isValidTimezone, 'fuseau horaire invalide (ex: Europe/Paris)'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuration (.env) invalide :');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
