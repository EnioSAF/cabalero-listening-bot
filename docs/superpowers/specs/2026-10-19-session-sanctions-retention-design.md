# Sanctions et rétention des sessions

## Objectif

Pendant une session, Ganondorf conserve les données nécessaires à la détection des doublons et au suivi des sanctions. À la fermeture, il produit les backups et récaps, puis demande au staff s'il faut conserver ou supprimer les données. Sans réponse sous 24 heures, les données détaillées sont supprimées automatiquement.

## Données suivies

Chaque incident de modération appartient à une session et à un utilisateur. Il conserve le motif, si le message a été supprimé, si un avertissement a été envoyé, le timeout appliqué et sa durée, ainsi qu'un indicateur de ban prévu pour compatibilité future.

Motifs initiaux : doublon, doublon partiel, flood, message sans son, cooldown, second son en mode limité, message multi-son en mode limité et suppression silencieuse pendant un timeout.

## Fermeture de session

`/session stop`, la fermeture automatique et la réconciliation :

1. ferment la session en base ;
2. calculent les statistiques de sanctions ;
3. lancent le backup existant ;
4. publient dans le salon principal le nombre de sons, de participants et un résumé des sanctions ;
5. publient dans le thread Discord `1561744399057166406` les totaux, le classement et la liste complète par utilisateur ;
6. publient dans le salon `1509220620196647023` une demande staff avec `💾 Conserver` et `🗑️ Supprimer` ;
7. fixent une expiration à 24 heures.

Un doublon partiel compte comme avertissement sans suppression. Une suppression silencieuse pendant un timeout compte comme suppression sans nouvel avertissement. Un timeout compte aussi comme incident, suppression et avertissement lorsqu'ils ont réellement eu lieu. Aucun ban n'est actuellement appliqué, donc le compteur de bans reste à zéro.

## Rétention

`💾 Conserver 30 jours` remplace l'expiration par une échéance à 30 jours. `🗑️ Supprimer` efface immédiatement les soumissions et sanctions détaillées, puis la ligne de session. Sans choix, le même nettoyage est exécuté après 24 heures.

Le choix est réservé au staff ayant `Gérer les messages`. L'échéance et l'identité du message de décision sont persistées afin de survivre aux redémarrages. Au démarrage, le bot supprime les sessions expirées et reprogramme les autres échéances.

Le nettoyage ne supprime aucun message Discord et ne touche pas à la configuration des salons.

## Données historiques actuelles

Avant purge, `data/bot.db` est copié vers une sauvegarde datée. Comme toutes les sessions actuelles sont terminées, les 394 soumissions et les 3 sessions peuvent ensuite être supprimées. Cette purge rend `/session clear` indisponible pour ces anciennes sessions, sans affecter une session active ni la configuration des deux salons.

## Échecs externes

Le backup est attendu avant le démarrage de la rétention pour éviter une purge concurrente. Un échec est journalisé et reporte le nettoyage, sans dépasser le garde-fou absolu de 30 jours. Les rapports trop longs sont découpés sur plusieurs messages Discord.
