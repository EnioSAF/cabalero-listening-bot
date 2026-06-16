import { AUDIO_EXTENSIONS } from '../config.js';

export interface Submission {
  kind: 'link' | 'file';
  /** Clé canonique servant à détecter les doublons. */
  identifier: string;
  /** Texte affichable (URL brute ou nom de fichier). */
  display: string;
}

export interface AttachmentLike {
  name: string | null;
  contentType: string | null;
  size: number;
}

// Paramètres de tracking à retirer pour ne pas rater un doublon « habillé » différemment.
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'si',
  'fbclid',
  'gclid',
  'igshid',
  'feature',
  'app',
  'context',
  'ref',
  'ref_src',
  'spm',
  '_branch_match_id',
  'pl',
]);

// Caractères invisibles / zero-width / bidi : retirés avant analyse, sinon un
// zero-width collé dans une URL fabrique un faux « nouveau » son (contournement).
// On ne touche PAS aux espaces/retours ligne (qui séparent les liens).
const INVISIBLE_CHARS =
  /[­​-‏‪-‮⁠-⁤⁪-⁯﻿]/g;

// URL http(s) dans le texte. On autorise les parenthèses internes (Wikipedia,
// pages d'album…) ; le nettoyage de fin retire la ponctuation et une ')' non appariée.
const URL_REGEX = /\bhttps?:\/\/[^\s<>]+/gi;

// URI Spotify natives (spotify:track:ID) — mappées sur la même clé que les liens open.spotify.com.
const SPOTIFY_URI_REGEX = /\bspotify:(track|album|playlist|episode|artist):([A-Za-z0-9]+)/gi;

// ID vidéo YouTube : exactement 11 caractères base64url.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

const SPOTIFY_TYPES = ['track', 'album', 'playlist', 'episode', 'artist'];

function stripInvisible(s: string): string {
  return s.normalize('NFKC').replace(INVISIBLE_CHARS, '');
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}

/** Retire ponctuation finale et les ')' de fin non appariées collées à l'URL. */
function trimUrlEnd(raw: string): string {
  let url = raw.replace(/[.,;:!?'"]+$/, '');
  while (url.endsWith(')') && countChar(url, ')') > countChar(url, '(')) {
    url = url.slice(0, -1);
  }
  return url;
}

/** Canonise un chemin : casse hexa du percent-encoding, slashs multiples, slash final. */
function normalizePath(pathname: string): string {
  return pathname
    .replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase())
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
}

function firstSegmentAfter(parts: string[], keys: string[]): string | undefined {
  const idx = parts.findIndex((p) => keys.includes(p.toLowerCase()));
  if (idx < 0) return undefined;
  return parts[idx + 1];
}

/**
 * Réduit une URL à une clé canonique stable selon la plateforme.
 * Renvoie null si l'URL est invalide ou non http(s).
 */
export function normalizeUrl(raw: string): string | null {
  const cleaned = trimUrlEnd(stripInvisible(raw));
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^(www|m|mobile)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  // --- YouTube ---
  if (host === 'youtu.be') {
    const id = parts[0];
    if (id && YT_ID.test(id)) return `yt:${id}`;
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const v = url.searchParams.get('v');
    if (v && YT_ID.test(v)) return `yt:${v}`;
    const seg = firstSegmentAfter(parts, ['shorts', 'embed', 'v', 'live']);
    if (seg && YT_ID.test(seg)) return `yt:${seg}`;
  }

  // --- Spotify ---
  if (host === 'open.spotify.com' || host === 'spotify.com') {
    const type = parts.find((p) => SPOTIFY_TYPES.includes(p.toLowerCase()));
    const id = firstSegmentAfter(parts, SPOTIFY_TYPES);
    if (type && id) return `spotify:${type.toLowerCase()}:${id}`;
  }
  if (host === 'spotify.link') {
    return `spotify-short:${normalizePath(url.pathname).toLowerCase()}`;
  }

  // --- SoundCloud ---
  if (host === 'soundcloud.com') {
    const path = normalizePath(url.pathname).toLowerCase();
    if (path) return `sc:${path}`;
  }
  if (host === 'on.soundcloud.com') {
    // Lien court non résolu : on déduplique au moins les liens courts identiques.
    return `sc-short:${normalizePath(url.pathname).toLowerCase()}`;
  }

  // --- Générique ---
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const search =
    params.length > 0 ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  const path = normalizePath(url.pathname) || '/';
  return `url:${host}${path}${search}`;
}

export function isAudioAttachment(att: AttachmentLike): boolean {
  if (att.contentType && att.contentType.toLowerCase().startsWith('audio/')) return true;
  if (att.name && AUDIO_EXTENSIONS.test(att.name)) return true;
  return false;
}

/**
 * Identifiant d'un fichier audio : nom + taille. Heuristique « best-effort » :
 * un renommage ou un ré-encodage change la clé (cf. README). Pas de hash du
 * contenu pour éviter de télécharger chaque pièce jointe.
 */
export function normalizeFile(att: AttachmentLike): string {
  const name = (att.name ?? 'audio').toLowerCase().normalize('NFKC').trim();
  return `file:${name}:${att.size}`;
}

/**
 * Extrait tous les « sons » d'un message (liens http(s), URI spotify:, fichiers audio),
 * dédupliqués entre eux au sein du même message.
 */
export function extractSubmissions(
  content: string,
  attachments: AttachmentLike[]
): Submission[] {
  const cleaned = stripInvisible(content);
  const out: Submission[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(URL_REGEX)) {
    const raw = match[0];
    const identifier = normalizeUrl(raw);
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({ kind: 'link', identifier, display: trimUrlEnd(raw) });
  }

  for (const match of cleaned.matchAll(SPOTIFY_URI_REGEX)) {
    const type = match[1]?.toLowerCase();
    const id = match[2];
    if (!type || !id) continue;
    const identifier = `spotify:${type}:${id}`;
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({ kind: 'link', identifier, display: match[0] });
  }

  for (const att of attachments) {
    if (!isAudioAttachment(att)) continue;
    const identifier = normalizeFile(att);
    if (seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({ kind: 'file', identifier, display: att.name ?? 'fichier audio' });
  }

  return out;
}
