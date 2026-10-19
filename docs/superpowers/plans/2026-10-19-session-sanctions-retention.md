# Session Sanctions and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les statistiques de sanctions, les deux récaps Discord et une rétention de session décidée par le staff avec suppression automatique après 24 heures.

**Architecture:** SQLite stocke les incidents et l'état de rétention pendant la courte vie d'une session. Des fonctions pures agrègent les statistiques ; le cycle de fermeture publie les récaps et crée la décision staff ; un gestionnaire persistant exécute les suppressions immédiates ou expirées.

**Tech Stack:** TypeScript, discord.js 14, better-sqlite3, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-19-session-sanctions-retention-design.md`

## Global Constraints

- Thread de récap : `1561744399057166406`.
- Salon de décision : `1509220620196647023`.
- Expiration sans choix : 24 heures.
- `💾 Conserver 30 jours` repousse l'expiration à 30 jours ; `🗑️ Supprimer` supprime immédiatement.
- Seul un membre avec `Gérer les messages` peut choisir.
- Aucun message Discord ni aucune configuration de salon ne doit être supprimé.

## Review Focus

- Redémarrage avant l'échéance : le nettoyage doit reprendre avec le délai restant.
- Échéance déjà passée au démarrage : nettoyage immédiat.
- Double clic ou choix concurrent : une seule transition doit gagner.
- Échec d'un envoi Discord : fermeture et expiration restent enregistrées.
- Session conservée : aucun nettoyage automatique ultérieur.

---

### Task 1: Persistance et agrégation des sanctions

**Files:**
- Modify: `src/db.ts`
- Create: `src/lib/sanctions.ts`
- Test: `src/lib/sanctions.test.ts`

**Interfaces:**
- Produces: `recordSanction(...)`, `getSessionSanctionSummary(sessionId)`, statistiques totales et par utilisateur.

- [ ] Écrire les tests échouants couvrant tous les compteurs et le tri du classement.
- [ ] Exécuter `npm test` et confirmer l'échec attendu.
- [ ] Ajouter la table `sanction` et les fonctions d'agrégation minimales.
- [ ] Exécuter `npm test` et confirmer la réussite.

### Task 2: Instrumentation de la modération

**Files:**
- Modify: `src/lib/moderation.ts`
- Modify: `src/lib/respond.ts`
- Test: `src/lib/sanctions.test.ts`

**Interfaces:**
- Consumes: `recordSanction(...)` de Task 1.
- Produces: un incident exact pour chaque branche de modération.

- [ ] Écrire les tests échouants des événements doublon, partiel, flood, contenu invalide, cooldown, limite et suppression silencieuse.
- [ ] Exécuter les tests et confirmer l'échec attendu.
- [ ] Instrumenter les branches sans modifier leurs sanctions Discord existantes.
- [ ] Exécuter les tests et confirmer la réussite.

### Task 3: Récaps de fermeture

**Files:**
- Modify: `src/lib/sessions.ts`
- Modify: `src/lib/persona.ts`
- Create: `src/lib/session-summary.ts`
- Test: `src/lib/session-summary.test.ts`

**Interfaces:**
- Consumes: agrégats de Task 1.
- Produces: résumé court du salon principal et rapport détaillé envoyé au thread configuré.

- [ ] Écrire les tests échouants des formats zéro sanction, totaux et classement complet.
- [ ] Exécuter les tests et confirmer l'échec attendu.
- [ ] Implémenter les formateurs et les envois de fermeture.
- [ ] Exécuter les tests et confirmer la réussite.

### Task 4: Décision staff et expiration persistante

**Files:**
- Modify: `src/db.ts`
- Create: `src/lib/retention.ts`
- Modify: `src/events/interactionCreate.ts`
- Modify: `src/events/ready.ts`
- Modify: `src/lib/sessions.ts`
- Test: `src/lib/retention.test.ts`

**Interfaces:**
- Produces: `scheduleSessionRetention(...)`, `handleRetentionButton(...)`, `restoreRetentionTimers(...)`, `purgeSessionData(...)`.

- [ ] Écrire les tests échouants pour conserver, supprimer, expirer, redémarrer et double choix.
- [ ] Exécuter les tests et confirmer l'échec attendu.
- [ ] Ajouter les colonnes d'état, le message à boutons, les timers et leur restauration.
- [ ] Exécuter les tests et confirmer la réussite.

### Task 5: Vérification et purge historique récupérable

**Files:**
- Modify: `README.md`
- Runtime data: `data/bot.db`

**Interfaces:**
- Consumes: `purgeSessionData(...)` de Task 4.

- [ ] Documenter les statistiques et la politique de rétention.
- [ ] Exécuter `npm test`, `npm run typecheck` et `npm run build`.
- [ ] Vérifier qu'aucune session actuelle n'est active.
- [ ] Copier `data/bot.db` vers une sauvegarde datée.
- [ ] Purger les anciennes soumissions et sessions, sans toucher `channel_config`.
- [ ] Vérifier : 0 ancienne session, 0 soumission, 2 configurations de salon.
