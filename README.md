# dumbsumb — Infinite Mario conteneurisé

Déploiement en production d'**Infinite Mario**, un jeu de plateforme en HTML5/JavaScript, conteneurisé avec Docker et exposé en HTTPS derrière un reverse proxy Nginx avec certificats Let's Encrypt générés automatiquement.

🎮 **Démo :** [https://dumbsumb.duckdns.org](https://dumbsumb.duckdns.org)

---

## Sommaire

- [Présentation](#présentation)
- [Architecture](#architecture)
- [Structure du dépôt](#structure-du-dépôt)
- [Prérequis](#prérequis)
- [Lancer le jeu en local](#lancer-le-jeu-en-local)
- [Construire l'image Docker](#construire-limage-docker)
- [Déploiement en production](#déploiement-en-production)
- [Commandes du jeu](#commandes-du-jeu)
- [Crédits et licence](#crédits-et-licence)

---

## Présentation

Le jeu est un portage JavaScript d'*Infinite Mario*, le clone de Mario créé en Java par Notch (Markus Persson). Il s'appuie uniquement sur les éléments `<canvas>` et `<audio>` du navigateur : aucun backend, aucune base de données, uniquement des fichiers statiques. Les niveaux sont générés de façon procédurale à chaque partie.

L'objectif du projet est d'industrialiser la mise en ligne de cette application statique :

- **Conteneurisation** de l'application dans une image Nginx Alpine légère ;
- **Publication** de l'image sur Docker Hub (`sabrinatch/mario-app`) ;
- **Orchestration** avec Docker Compose ;
- **Reverse proxy** Nginx avec découverte automatique des conteneurs ;
- **HTTPS automatique** via ACME / Let's Encrypt, avec renouvellement des certificats ;
- **Nom de domaine dynamique** via DuckDNS.

## Architecture

```
                    Internet
                       │
             dumbsumb.duckdns.org
                       │
              ┌────────┴────────┐
              │   :80   :443    │
   ┌──────────┴─────────────────┴──────────┐
   │        nginx-reverse-proxy            │◄──── docker.sock (lecture seule)
   │       (nginxproxy/nginx-proxy)        │      détection des conteneurs
   └──────────┬─────────────────▲──────────┘
              │                 │ certificats (volume certs)
              │      ┌──────────┴──────────────┐
              │      │    nginx-proxy-acme     │──► Let's Encrypt
              │      │ (acme-companion)        │    émission + renouvellement
              │      └─────────────────────────┘
              │ réseau Docker interne
   ┌──────────▼──────────┐
   │      mario-app      │
   │ sabrinatch/mario-app│   Nginx Alpine + fichiers statiques du jeu
   │        :80          │   (port non publié sur l'hôte)
   └─────────────────────┘
```

| Service | Image | Rôle |
|---|---|---|
| `nginx-proxy` | `nginxproxy/nginx-proxy:latest` | Point d'entrée unique de la VM (ports 80/443). Génère automatiquement sa configuration à partir des variables `VIRTUAL_HOST` des conteneurs. |
| `nginx-proxy-acme` | `nginxproxy/acme-companion:latest` | Obtient et renouvelle les certificats TLS Let's Encrypt (vérification toutes les 8 h). |
| `mario-app` | `sabrinatch/mario-app:v1.0.0` | Sert le jeu. Port 80 exposé uniquement sur le réseau Docker interne. |

Volumes persistants : `vhosts`, `html`, `certs`, `acme`.

## Structure du dépôt

```
.
├── Enjine/               # Moteur de jeu 2D (canvas, sprites, caméra, clavier, timer…)
├── code/                 # Logique du jeu (personnage, ennemis, niveaux, états, musique…)
├── images/               # Sprite sheets et graphismes
├── sounds/               # Effets sonores (.wav / .mp3)
├── midi/                 # Musiques de fond (.mid)
├── index.html            # Point d'entrée du jeu (scripts non minifiés)
├── minTest.html          # Variante utilisant les versions minifiées
├── enjine.min.js         # Moteur minifié
├── mario.min.js          # Code du jeu minifié
├── flipTest.html         # Page de test du rendu des sprites
├── Dockerfile            # Image de l'application (Nginx Alpine)
├── docker-compose.yaml   # Stack de production (proxy + ACME + application)
└── LICENSE.md            # Unlicense
```

## Prérequis

- [Docker](https://docs.docker.com/get-docker/) et Docker Compose v2
- Pour la production :
  - une VM accessible depuis Internet avec les ports **80** et **443** ouverts ;
  - un nom de domaine (ici un sous-domaine DuckDNS) pointant vers l'IP publique de la VM.

## Lancer le jeu en local

Le jeu étant entièrement statique, il suffit d'un serveur HTTP :

```bash
git clone https://github.com/sabrinatch/dumbsumb.git
cd dumbsumb

# Option 1 : serveur Python
python3 -m http.server 8000

# Option 2 : conteneur Nginx avec le dossier monté
docker run --rm -p 8080:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine
```

Puis ouvrir [http://localhost:8000](http://localhost:8000) (ou `:8080` selon l'option).

> ℹ️ Ouvrir `index.html` directement en `file://` ne fonctionne pas toujours : certains navigateurs bloquent le chargement des ressources. Passez par un serveur HTTP.

## Construire l'image Docker

```bash
docker build -t sabrinatch/mario-app:v1.0.0 .
docker run --rm -p 8080:80 sabrinatch/mario-app:v1.0.0
```

Publication sur Docker Hub :

```bash
docker login
docker push sabrinatch/mario-app:v1.0.0
```

> ⚠️ Le `Dockerfile` copie l'intégralité du contexte de build (`COPY . …`). Son commentaire mentionne un `.dockerignore`, mais ce fichier n'est pas présent dans le dépôt. Pour éviter d'embarquer `.git`, le `Dockerfile` ou le `docker-compose.yaml` dans l'image, ajoutez par exemple :
>
> ```
> .git
> Dockerfile
> docker-compose.yaml
> README*
> LICENSE.md
> midi/urldecode.py
> ```

## Déploiement en production

1. **Configurer le DNS** : faire pointer le sous-domaine DuckDNS vers l'IP publique de la VM.
2. **Adapter les variables** de `mario-app` dans `docker-compose.yaml` :

   | Variable | Description |
   |---|---|
   | `VIRTUAL_HOST` | Nom de domaine servi par le reverse proxy |
   | `VIRTUAL_PORT` | Port interne du conteneur (80) |
   | `ACME_HOST` | Domaine pour lequel le certificat est demandé |
   | `ACME_EMAIL` | Adresse de contact pour Let's Encrypt (alertes d'expiration) |

3. **Démarrer la stack** :

   ```bash
   docker compose up -d
   ```

4. **Vérifier** :

   ```bash
   docker compose ps
   docker compose logs -f nginx-proxy-acme   # suivi de l'émission du certificat
   ```

   Le premier certificat peut prendre une à deux minutes à être émis. Le site est ensuite accessible en HTTPS.

**Mise à jour de l'application :**

```bash
# après avoir publié une nouvelle version et modifié le tag dans docker-compose.yaml
docker compose pull mario-app
docker compose up -d mario-app
```

**Arrêt :**

```bash
docker compose down        # conserve les volumes (certificats inclus)
docker compose down -v     # supprime aussi les volumes
```

### Points de sécurité

- Seul le reverse proxy publie des ports sur l'hôte ; l'application n'est joignable que via le réseau Docker interne.
- Le socket Docker est monté en **lecture seule** dans les deux conteneurs du proxy. Il donne néanmoins une visibilité étendue sur l'hôte : à réserver à des images de confiance.
- Les images du proxy utilisent le tag `latest` ; épingler une version précise rendra les déploiements reproductibles.
- La clé `version: '3.8'` est obsolète avec Docker Compose v2 et peut être supprimée.

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
- **mariohtml5** — portage HTML5/JavaScript dont ce projet reprend le code.
- **Conteneurisation et déploiement** — sabrinatch et l'équipe du projet.

Le code est placé dans le domaine public sous [Unlicense](LICENSE.md).

*Mario et les éléments graphiques et sonores associés sont des marques et créations de Nintendo. Ce projet est réalisé à des fins pédagogiques, sans but commercial.*
