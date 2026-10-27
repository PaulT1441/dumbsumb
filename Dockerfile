FROM nginx:alpine #C’est l’image de départ : l’image officielle Nginx, construite sur Alpine Linux.

# Cette ligne remplace la configuration Nginx par défaut par la nôtre.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Cette ligne copie les fichiers du projet dans le dossier que Nginx sert par défaut.
COPY . /usr/share/nginx/html

EXPOSE 80 #Cette ligne documente le port d’écoute du conteneur. Elle ne publie pas le port sur la machine hôte.
CMD ["nginx", "-g", "daemon off;"] #C’est la commande lancée au démarrage du conteneur.
