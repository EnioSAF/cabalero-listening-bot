import parser from 'cron-parser';
import type { Client } from 'discord.js';
import { getSession, listChannelsWithActiveSession } from '../db.js';
import { closeSession } from './sessions.js';
import { isValidTimezone } from './time.js';

/**
 * Au démarrage : ferme les sessions automatiques qui auraient dû se terminer
 * pendant que le bot était hors-ligne (node-cron ne rejoue pas les exécutions
 * manquées). Les sessions manuelles (auto_schedule = 0) sont laissées ouvertes,
 * car elles se ferment via /session stop.
 */
export async function reconcileSessions(client: Client): Promise<void> {
  for (const cfg of listChannelsWithActiveSession()) {
    if (cfg.auto_schedule !== 1 || cfg.active_session_id === null) continue;
    if (!isValidTimezone(cfg.timezone)) continue;

    const session = getSession(cfg.active_session_id);
    if (!session) continue;

    try {
      // Dernière occurrence de fermeture prévue avant maintenant.
      const lastClose = parser
        .parseExpression(cfg.close_cron, { tz: cfg.timezone })
        .prev()
        .getTime();

      // Elle est postérieure au début de la session → elle aurait dû fermer la
      // session pendant l'arrêt : on la ferme proprement maintenant.
      if (lastClose > session.started_at) {
        await closeSession(client, cfg.channel_id, null);
        console.log(
          `[reconcile] session du channel ${cfg.channel_id} fermée (créneau dépassé pendant l'arrêt).`
        );
      }
    } catch (e) {
      console.warn(`[reconcile] impossible de réconcilier ${cfg.channel_id} :`, e);
    }
  }
}
