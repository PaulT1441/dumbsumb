FROM nginx:alpine

# Grâce au .dockerignore, seuls les fichiers web (HTML, JS, CSS) seront copiés
COPY . /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
