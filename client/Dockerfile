FROM nginx:alpine

# Copy the built files from the GitHub Actions build step
COPY dist/ /usr/share/nginx/html/

# Copy simple nginx configuration (Tailscale Funnel handles HTTPS)
COPY nginx-simple.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
