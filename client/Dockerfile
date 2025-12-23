FROM nginx:alpine

# Copy the built files from the GitHub Actions build step
COPY dist/ /usr/share/nginx/html/

# Copy nginx configurations
COPY nginx-http.conf /etc/nginx/conf.d/nginx-http.conf
COPY nginx-https.conf /etc/nginx/conf.d/nginx-https.conf

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/docker-entrypoint.sh"]
