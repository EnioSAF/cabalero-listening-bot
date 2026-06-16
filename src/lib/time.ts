/** Vrai si `tz` est un fuseau IANA valide (ex: 'Europe/Paris'). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
