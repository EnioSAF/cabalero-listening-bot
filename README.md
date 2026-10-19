# 🎧 Cabalero Listening Bot

Bot Discord pour les **sessions d'écoute du lundi** de Cabalero.
Quand une session est ouverte sur un salon, le bot :

- **bloque les doublons** : un même son (lien _ou_ fichier audio) ne peut être posté qu'une fois ;
- **anti-flood** : empêche le spam de messages d'affilée + impose un délai entre deux sons ;
- supprime le message fautif et **explique en MP** (ou en message éphémère si les MP sont fermés) ;
- s'ouvre/se ferme **automatiquement chaque lundi** (planning configurable) **et** à la main (`/session start|stop`).

Le staff (permission « Gérer les messages ») n'est jamais bridé.

---

## 1. Prérequis dans le Dev Portal

Sur https://discord.com/developers/applications → ton application :

1. **Bot → Privileged Gateway Intents → active `MESSAGE CONTENT INTENT`.**
   Sans ça, le bot ne peut pas lire les liens dans les messages (les fichiers, eux, restent détectés).
2. Récupère le **token** (Bot → Reset Token) et l'**Application ID** (General Information).

### Inviter le bot

Lien d'invitation prêt à l'emploi (permissions : voir salon, écrire, gérer/supprimer les messages, lire l'historique, réagir, **gérer les webhooks** pour la réplication de backup, **exclure des membres** pour les timeouts) :

```
https://discord.com/oauth2/authorize?client_id=1516507773016477888&permissions=1100048575552&scope=bot+applications.commands
```

> Le bot a besoin de **Gérer les messages** (suppression / clear), **Gérer les webhooks** (backups), et **Exclure des membres** (timeouts de récidive) sur les salons concernés, plus l'écriture dans le salon de backup privé.
>
> ⚠️ Pour que les **timeouts** marchent, le **rôle du bot doit être au-dessus** des membres à sanctionner dans la hiérarchie des rôles. Discord **n'autorise jamais** à timeout le propriétaire du serveur ni un membre avec un rôle ≥ celui du bot (admins inclus) — donc tester la sanction sur ton propre compte d'owner ne fera rien.

---

## 2. Installation

```bash
npm install
cp .env.example .env   # puis remplis DISCORD_TOKEN et DISCORD_CLIENT_ID
```

`.env` :

```
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=        # (optionnel) ID du serveur → déploiement instantané des commandes
DATABASE_PATH=./data/bot.db
DEFAULT_TIMEZONE=Europe/Paris
```

> 💡 Renseigner `DISCORD_GUILD_ID` rend les commandes slash disponibles **immédiatement** sur ce serveur. Sans lui, le déploiement est global (~1 h de propagation).

## 3. Déployer les commandes puis lancer

```bash
npm run deploy   # enregistre les commandes slash auprès de Discord (à refaire si tu changes les commandes)
npm run dev      # lance le bot en mode watch
# ou
npm start
```

---

## 4. Utilisation

Toutes les commandes sont réservées au staff (permission « Gérer les messages »).

| Commande | Effet |
| --- | --- |
| `/session config actif:true` | **Active le bot sur le salon courant.** |
| `/session start` | Ouvre une session maintenant (manuel). |
| `/session stop` | Ferme la session + affiche le récap. |
| `/session status` | État du salon : session, réglages, planning. |
| `/session config …` | Règle `cooldown`, `flood_max`, `flood_fenetre`, `sons_uniquement`, **`salon_backup`**. |
| `/session clear` | Supprime (avec **confirmation**) tous les messages de la dernière session sur ce salon. |
| `/session schedule …` | Planning auto : `actif`, `ouverture` (HH:MM), `fermeture` (HH:MM), `jour`, `fuseau`. |

> 🔁 Une session se lance sur **n'importe quel salon** : la commande agit sur le salon où elle est tapée, et plusieurs salons peuvent avoir leur propre session en parallèle.

### Mise en route type pour le lundi

```
/session config actif:true
/session schedule actif:true ouverture:20:00 fermeture:23:00 jour:Lundi fuseau:Europe/Paris
```

Le bot ouvrira et fermera tout seul la session chaque lundi. Tu peux toujours forcer avec `/session start` / `/session stop`.

---

## 5. Comment marche l'anti-doublon

- **Liens** : l'URL est normalisée en clé canonique. YouTube (`youtu.be`, `watch?v=`, `shorts/…`, sous-domaines `gaming/music/mobile`, ID validé sur 11 caractères), Spotify (`track/album/playlist`, locales `intl-`, **et URI natives `spotify:track:…`**), SoundCloud, et un nettoyage générique (retrait de `www.`/point final, casse du chemin, slashs multiples, paramètres de tracking `utm_*`, `si`, `fbclid`…) pour qu'un même lien partagé différemment soit reconnu. Les caractères invisibles (zero-width) collés dans une URL sont retirés pour éviter le contournement.
- **Fichiers audio** : identifiés par `nom + taille` (heuristique « best-effort »). Le même fichier reposté est détecté ; un renommage ou un ré-encodage peut passer — c'est volontaire pour ne pas télécharger chaque pièce jointe.
- **Acceptation partielle** : si un message contient plusieurs sons dont un seul déjà vu, les sons nouveaux sont conservés et l'auteur est juste prévenu pour celui ignoré.
- La détection est **par session** : à chaque nouvelle session, le compteur de doublons repart de zéro. L'historique est stocké dans SQLite (`./data/bot.db`), donc un redémarrage du bot ne casse pas la déduplication d'une session en cours.
- **Au redémarrage**, le bot referme automatiquement une session auto dont l'heure de fermeture est passée pendant qu'il était hors-ligne (réconciliation).

> Les liens courts non résolus (`on.soundcloud.com/…`, `spotify.link/…`) ne sont dédupliqués que s'ils sont **identiques** entre eux.

---

## 6. Backup & nettoyage de fin de session

- **Backup automatique** : à la fermeture d'une session (manuelle, auto, ou réconciliation au redémarrage), si un salon de backup est configuré (`/session config salon_backup:#archives`), le bot **réplique le salon** dans ce salon privé via un **webhook** : chaque message est re-posté avec le pseudo et l'avatar d'origine, le texte et les pièces jointes, précédé d'un récap des sons. Les pièces jointes trop lourdes basculent automatiquement sur leur lien.
- **Récap des sanctions** : le message de fermeture affiche les totaux (incidents, suppressions, avertissements, timeouts et bans). Un rapport détaillé avec le top et la liste complète par utilisateur est envoyé dans le thread dédié.
- **Rétention limitée** : après la fermeture, le staff peut supprimer immédiatement les données de la session ou les conserver 30 jours. Sans choix, sons, sanctions et ligne de session sont supprimés après 24 heures. Les échéances survivent aux redémarrages.
- **Clear avec confirmation** : `/session clear` compte les messages postés pendant la dernière session sur le salon, demande confirmation (boutons **Supprimer / Annuler**, visibles du seul staff), puis les supprime en masse. Les messages de plus de 14 jours ne sont pas supprimables en masse par l'API Discord (signalés dans le résultat).

> Ordre conseillé : laisser le backup se faire en fin de session (il préserve tout), **puis** lancer `/session clear` pour repartir d'un salon propre.

## 7. Faire tourner en continu

Exemple avec [pm2](https://pm2.keymetrics.io/) :

```bash
npm i -g pm2
pm2 start "npm start" --name cabalero-bot
pm2 save
```

(ou un service `systemd` / un conteneur — le bot n'a besoin que de Node ≥ 20 et du dossier `data/`.)

---

## Architecture

```
src/
  index.ts            point d'entrée (Client + intents + login)
  env.ts              validation .env (zod)
  config.ts           valeurs par défaut
  db.ts               SQLite (config salons, sessions, soumissions)
  loaders.ts          chargement auto des commands/ et events/
  deploy-commands.ts  enregistrement REST des commandes slash
  types.ts            types Command / BotEvent
  commands/
    session.ts        /session start|stop|status|config|schedule
  events/
    ready.ts          démarre les plannings cron + réconciliation
    interactionCreate.ts  routage des commandes + boutons (clear)
    messageCreate.ts  cœur : flood → extraction → doublon → cooldown → enregistrement
  lib/
    normalize.ts      normalisation liens/fichiers → clé de doublon
    antiflood.ts      flood + cooldown (en mémoire)
    sessions.ts       ouverture/fermeture + annonces + backup
    scheduler.ts      jobs node-cron par salon
    reconcile.ts      ferme au démarrage les sessions auto au créneau dépassé
    backup.ts         réplication du salon dans le backup privé (webhook)
    clear.ts          /session clear : confirmation + suppression en masse
    messages.ts       collecte des messages d'une fenêtre de session
    channels.ts       helpers de récupération de salons
    time.ts           validation de fuseau horaire
    respond.ts        suppression + notification (MP → repli éphémère)
```
