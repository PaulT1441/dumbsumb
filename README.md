# dumbsumb — Infinite Mario conteneurisé

Déploiement en production d'**Infinite Mario**, un jeu de plateforme en HTML5/JavaScript, conteneurisé avec Docker et exposé en HTTPS derrière un reverse proxy Nginx avec certificats Let's Encrypt générés automatiquement. Les scores des joueurs sont enregistrés dans une base **PostgreSQL** via une petite **API REST** et affichés dans un classement à côté du jeu.

🎮 **Démo :** [https://dumbsumb.duckdns.org](https://dumbsumb.duckdns.org)

---

## Sommaire

- [Présentation](#présentation)
- [Architecture](#architecture)
- [Système de score](#système-de-score)
- [API des scores](#api-des-scores)
- [Structure du dépôt](#structure-du-dépôt)
- [Prérequis](#prérequis)
- [Lancer en local](#lancer-en-local)
- [Construire et publier les images](#construire-et-publier-les-images)
- [Déploiement en production](#déploiement-en-production)
- [Base de données](#base-de-données)
- [Commandes du jeu](#commandes-du-jeu)
- [Crédits et licence](#crédits-et-licence)

---

## Présentation

Le jeu est un portage JavaScript d'*Infinite Mario*, le clone de Mario créé en Java par Notch (Markus Persson). Il s'appuie sur les éléments `<canvas>` et `<audio>` du navigateur, et les niveaux sont générés de façon procédurale à chaque partie.

Le projet industrialise sa mise en ligne :

- **Conteneurisation** de l'application dans une image Nginx Alpine légère ;
- **API des scores** en Node.js / Express, dans son propre conteneur ;
- **Base de données** PostgreSQL avec volume persistant ;
- **Orchestration** avec Docker Compose et **réseaux isolés** (frontend / backend) ;
- **Reverse proxy** Nginx avec découverte automatique des conteneurs ;
- **HTTPS automatique** via ACME / Let's Encrypt, avec renouvellement des certificats ;
- **Nom de domaine dynamique** via DuckDNS.

## Architecture

```
                         Internet
                            │
                  dumbsumb.duckdns.org
                            │  :80 / :443
   ┌────────────────────────┴───────────────────────┐
   │              nginx-reverse-proxy               │◄── docker.sock (lecture seule)
   │            (nginxproxy/nginx-proxy)            │
   └───────────┬──────────────────────▲─────────────┘
               │                      │ certificats
               │          ┌───────────┴───────────┐
   réseau      │          │   nginx-proxy-acme    │──► Let's Encrypt
   frontend    │          └───────────────────────┘
               ▼
   ┌───────────────────────┐
   │       mario-app       │   Nginx : fichiers du jeu
   │  sabrinatch/mario-app │   + relais /api/ → api:3000
   └───────────┬───────────┘
               │ /api/
   réseau      ▼
   backend  ┌───────────────────────┐        ┌───────────────────────┐
   (interne)│       mario-api       │───────►│       mario-db        │
            │  Node.js / Express    │  SQL   │   PostgreSQL 16       │
            │        :3000          │        │  volume pgdata        │
            └───────────────────────┘        └───────────────────────┘
```

| Service | Image | Réseaux | Rôle |
|---|---|---|---|
| `nginx-proxy` | `nginxproxy/nginx-proxy:latest` | frontend | Point d'entrée unique de la VM (ports 80/443). Génère sa configuration à partir des variables `VIRTUAL_HOST` des conteneurs. |
| `nginx-proxy-acme` | `nginxproxy/acme-companion:latest` | frontend | Obtient et renouvelle les certificats TLS Let's Encrypt (vérification toutes les 8 h). |
| `mario-app` | `sabrinatch/mario-app:v1.1.0` | frontend, backend | Sert le jeu et relaie `/api/` vers l'API (même origine, pas de CORS). |
| `api` | `sabrinatch/mario-api:v1.0.0` | backend | API REST des scores, crée le schéma au démarrage. |
| `db` | `postgres:16-alpine` | backend | Stockage des scores. Aucun port publié. |

Le réseau `backend` est déclaré `internal` : l'API et la base n'ont ni accès à Internet ni exposition directe. Seul le reverse proxy publie des ports sur l'hôte.

Volumes persistants : `vhosts`, `html`, `certs`, `acme`, `pgdata`.

## Système de score

Le HUD du jeu affiche désormais le score en direct (à la place de l'ancien `00000000` fixe), ainsi que sur la carte du monde et sur les écrans de fin.

| Action | Points |
|---|---|
| Pièce ramassée | +200 |
| Ennemi écrasé | +100 |
| Ennemi éliminé avec une carapace ou une boule de feu | +200 |
| Champignon ou fleur de feu | +1 000 |
| Niveau terminé | +1 000 |
| Bonus de temps (par seconde restante en fin de niveau) | +50 |

Le barème est centralisé dans `Mario.Points` (`code/setup.js`).

À la fin d'une partie (game over ou victoire), une fenêtre propose d'enregistrer le score avec un pseudo. Le pseudo est mémorisé dans le navigateur pour les parties suivantes. Le classement (top 10, record, nombre de parties et de joueurs) est affiché à droite du jeu et se rafraîchit toutes les 30 secondes. Si l'API est indisponible, le jeu reste jouable et le panneau l'indique.

> ⚠️ Le score est calculé côté navigateur : un joueur motivé peut envoyer un faux score à l'API. La validation serveur (bornes, format) et la limite de débit réduisent les abus mais ne les empêchent pas totalement. C'est un compromis acceptable pour un jeu de démonstration.

## API des scores

L'API est servie sous `/api/` par le même domaine que le jeu.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/health` | État de l'API et de la connexion à la base |
| `GET` | `/api/scores?limit=10` | Meilleurs scores (1 à 50, défaut 10) |
| `GET` | `/api/stats` | Nombre de parties, de joueurs, meilleur score, victoires |
| `POST` | `/api/scores` | Enregistre un score, renvoie son rang |

Exemple d'envoi :

```bash
curl -X POST https://dumbsumb.duckdns.org/api/scores \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mario","score":34800,"world":2,"levels":3,"coins":41,"kills":12,"outcome":"lose"}'
```

```json
{ "id": 42, "rank": 3, "name": "Mario", "score": 34800, "created_at": "2026-10-27T08:45:49.216Z" }
```

Règles de validation :

- `name` : 1 à 16 caractères (lettres, chiffres, espace, `_ . -`) ;
- `score` : entier entre 0 et 99 999 999 ;
- `world` : entier entre 1 et 8 ;
- `outcome` : `win` ou `lose` ;
- 10 envois maximum par minute et par adresse IP (réponse `429` au-delà) ;
- corps de requête limité à 2 Ko.

## Structure du dépôt

```
.
├── Enjine/               # Moteur de jeu 2D (canvas, sprites, caméra, clavier, timer…)
├── code/                 # Logique du jeu (personnage, ennemis, niveaux, états, score…)
├── images/               # Sprite sheets et graphismes
├── sounds/               # Effets sonores (.wav / .mp3)
├── midi/                 # Musiques de fond (.mid)
├── scores/
│   ├── scores.js         # Classement + fenêtre d'enregistrement du score
│   └── scores.css        # Mise en page du site et du classement
├── api/
│   ├── server.js         # API REST Express
│   ├── db.js             # Connexion PostgreSQL et création du schéma
│   ├── package.json
│   └── Dockerfile        # Image de l'API (Node 22 Alpine, utilisateur non root)
├── nginx/
│   └── default.conf      # Nginx de mario-app : statique + relais /api/
├── index.html            # Point d'entrée du jeu (scripts non minifiés)
├── minTest.html          # Variante utilisant les versions minifiées
├── enjine.min.js         # Moteur minifié
├── mario.min.js          # Code du jeu minifié
├── flipTest.html         # Page de test du rendu des sprites
├── Dockerfile            # Image de l'application (Nginx Alpine)
├── .dockerignore         # Fichiers exclus de l'image mario-app
├── docker-compose.yaml   # Stack complète (proxy + ACME + application + API + base)
├── .env.example          # Variables d'environnement à copier en .env
└── LICENSE.md            # Unlicense
```

## Prérequis

- [Docker](https://docs.docker.com/get-docker/) et Docker Compose v2
- Pour la production :
  - une VM accessible depuis Internet avec les ports **80** et **443** ouverts ;
  - un nom de domaine (ici un sous-domaine DuckDNS) pointant vers l'IP publique de la VM.

## Lancer en local

**Jeu seul (sans classement)** : le jeu fonctionne avec n'importe quel serveur HTTP. Le panneau des scores affichera simplement « Hors ligne ».

```bash
git clone https://github.com/sabrinatch/dumbsumb.git
cd dumbsumb
python3 -m http.server 8000
```

**Jeu + API + base de données** : lancer uniquement les services applicatifs, sans le reverse proxy ni ACME, et publier le port de `mario-app` :

```bash
cp .env.example .env            # puis définir POSTGRES_PASSWORD
docker compose build
docker compose run -d --name mario-local -p 8080:80 mario-app
```

Puis ouvrir [http://localhost:8080](http://localhost:8080). `docker compose run` démarre automatiquement `api` et `db` grâce aux dépendances.

Pour tout arrêter : `docker rm -f mario-local && docker compose down`.

> ℹ️ Ouvrir `index.html` directement en `file://` ne fonctionne pas toujours : certains navigateurs bloquent le chargement des ressources. Passez par un serveur HTTP.

## Construire et publier les images

```bash
docker compose build                  # construit mario-app et mario-api
docker login
docker compose push mario-app api     # publie sabrinatch/mario-app et sabrinatch/mario-api
```

Après une modification du code du jeu, régénérez aussi les fichiers minifiés utilisés par `minTest.html` :

```bash
npx terser Enjine/core.js Enjine/gameCanvas.js Enjine/keyboardInput.js Enjine/resources.js \
  Enjine/drawable.js Enjine/state.js Enjine/gameTimer.js Enjine/camera.js Enjine/drawableManager.js \
  Enjine/sprite.js Enjine/spriteFont.js Enjine/frameSprite.js Enjine/animatedSprite.js \
  Enjine/collideable.js Enjine/application.js -c -m -o enjine.min.js

npx terser $(grep -o 'code/[a-zA-Z]*\.js' index.html) -c -m -o mario.min.js
```

## Déploiement en production

1. **Configurer le DNS** : faire pointer le sous-domaine DuckDNS vers l'IP publique de la VM.
2. **Créer le fichier `.env`** à partir du modèle et définir un mot de passe fort :

   ```bash
   cp .env.example .env
   nano .env
   ```

   | Variable | Description |
   |---|---|
   | `POSTGRES_DB` | Nom de la base (défaut `mario`) |
   | `POSTGRES_USER` | Utilisateur PostgreSQL (défaut `mario`) |
   | `POSTGRES_PASSWORD` | Mot de passe PostgreSQL (**obligatoire**) |
   | `DOMAIN` | Nom de domaine servi (`VIRTUAL_HOST` / `ACME_HOST`) |
   | `ACME_EMAIL` | Adresse de contact Let's Encrypt (alertes d'expiration) |

   Le fichier `.env` est ignoré par Git : ne le commitez jamais.

3. **Démarrer la stack** :

   ```bash
   docker compose up -d --build     # ou "docker compose pull" si les images sont publiées
   ```

4. **Vérifier** :

   ```bash
   docker compose ps
   docker compose logs -f nginx-proxy-acme       # émission du certificat
   docker compose logs api                       # doit afficher "schema ready"
   curl https://dumbsumb.duckdns.org/api/health  # {"status":"ok","database":"up"}
   ```

   Le premier certificat peut prendre une à deux minutes à être émis.

**Mise à jour de l'application :**

```bash
git pull
docker compose up -d --build mario-app api
```

**Arrêt :**

```bash
docker compose down        # conserve les volumes (scores et certificats inclus)
docker compose down -v     # ⚠️ supprime aussi les volumes, donc tous les scores
```

### Points de sécurité

- Seul le reverse proxy publie des ports sur l'hôte. L'API et la base sont sur un réseau interne, sans accès Internet.
- Le mot de passe de la base est lu depuis `.env` ; le démarrage échoue s'il n'est pas défini.
- L'API tourne avec un utilisateur non root, valide toutes les entrées, utilise des requêtes SQL paramétrées et limite le débit des envois.
- Le socket Docker est monté en **lecture seule** dans les deux conteneurs du proxy. Il donne néanmoins une visibilité étendue sur l'hôte : à réserver à des images de confiance.
- Les images du proxy utilisent le tag `latest` ; épingler une version précise rendra les déploiements reproductibles.

## Base de données

La table est créée automatiquement par l'API au démarrage (`CREATE TABLE IF NOT EXISTS`) :

```sql
CREATE TABLE scores (
  id              SERIAL       PRIMARY KEY,
  player_name     VARCHAR(16)  NOT NULL,
  score           INTEGER      NOT NULL CHECK (score >= 0),
  world           SMALLINT     NOT NULL CHECK (world BETWEEN 1 AND 8),
  levels_cleared  SMALLINT     NOT NULL DEFAULT 0,
  coins           INTEGER      NOT NULL DEFAULT 0,
  kills           INTEGER      NOT NULL DEFAULT 0,
  outcome         VARCHAR(4)   NOT NULL CHECK (outcome IN ('win', 'lose')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX scores_ranking_idx ON scores (score DESC, created_at ASC);
```

Commandes utiles :

```bash
# Console SQL
docker compose exec db psql -U mario -d mario

# Sauvegarde
docker compose exec -T db pg_dump -U mario mario > backup_$(date +%F).sql

# Restauration
docker compose exec -T db psql -U mario -d mario < backup_2026-10-27.sql

# Supprimer un score
docker compose exec db psql -U mario -d mario -c "DELETE FROM scores WHERE id = 42;"
```

## Commandes du jeu

| Touche | Action |
|---|---|
| ← / → | Se déplacer |
| ↓ | S'accroupir (quand Mario est grand) |
| **S** | Sauter / valider (carte, écran de fin) |
| **A** (maintenu) | Courir · lancer une boule de feu · porter une carapace |
| ↑ ↓ ← → | Se déplacer sur la carte du monde |

> La musique de fond (MIDI) n'est pas prise en charge par tous les navigateurs.

## Crédits et licence

- **Infinite Mario** — jeu original en Java par Markus « Notch » Persson.
- **mariohtml5** — portage HTML5/JavaScript par Rob Kleffner, dont ce projet reprend le code.
- **Conteneurisation, déploiement, scores et classement** — sabrinatch et l'équipe du projet.

Le code est placé dans le domaine public sous [Unlicense](LICENSE.md).

*Mario et les éléments graphiques et sonores associés sont des marques et créations de Nintendo. Ce projet est réalisé à des fins pédagogiques, sans but commercial.*
