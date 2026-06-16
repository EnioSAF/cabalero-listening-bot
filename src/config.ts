/** Valeurs par défaut appliquées quand on active le bot sur un nouveau channel. */
export const DEFAULTS = {
  /** Cron d'ouverture auto : lundi 20:00 (fuseau du channel). */
  openCron: '0 20 * * 1',
  /** Cron de fermeture auto : lundi 23:00. */
  closeCron: '0 23 * * 1',
  /** Délai minimum (s) entre deux sons acceptés d'une même personne. */
  cooldownSec: 30,
  /** Anti-flood : nombre max de messages... */
  floodMax: 5,
  /** ...sur cette fenêtre glissante (s). */
  floodWindowSec: 10,
} as const;

/** Extensions de fichiers considérées comme un « son ». */
export const AUDIO_EXTENSIONS =
  /\.(mp3|wav|flac|ogg|oga|m4a|aac|aif|aiff|opus|wma|alac|amr|mid|midi)$/i;

/** Récidive à partir de laquelle un timeout est appliqué (avant : que des avertissements). */
const SANCTION_START_STRIKE = 4;
/** Durée du 1er timeout (1 min), puis doublée à chaque récidive. */
const SANCTION_BASE_MS = 60_000;
/** Plafond du timeout (1 h). */
const SANCTION_MAX_MS = 60 * 60_000;

/**
 * Durée de timeout (ms) en fonction du nombre de récidives de doublon.
 * Exponentiel : 0 avant le palier, puis 1 min × 2^(n) jusqu'au plafond.
 * Ex : strike 4 → 1 min, 5 → 2 min, 6 → 4 min, 7 → 8 min … (max 1 h).
 */
export function timeoutDurationMs(strike: number): number {
  if (strike < SANCTION_START_STRIKE) return 0;
  const ms = SANCTION_BASE_MS * 2 ** (strike - SANCTION_START_STRIKE);
  return Math.min(ms, SANCTION_MAX_MS);
}
