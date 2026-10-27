FROM nginx:alpine

# Configuration Nginx : fichiers statiques + reverse proxy /api/ vers l'API des scores
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Fichiers du jeu uniquement (le reste est exclu par .dockerignore)
COPY . /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
