#!/bin/sh

# Check if SSL certificates exist
if [ -f "/etc/nginx/certs/chor-dai-dee.tail83fc6d.ts.net.crt" ] && [ -f "/etc/nginx/certs/chor-dai-dee.tail83fc6d.ts.net.key" ]; then
    echo "SSL certificates found, using HTTPS configuration"
    cp /etc/nginx/conf.d/nginx-https.conf /etc/nginx/conf.d/default.conf
else
    echo "SSL certificates not found, using HTTP-only configuration"
    cp /etc/nginx/conf.d/nginx-http.conf /etc/nginx/conf.d/default.conf
fi

# Remove template files so nginx doesn't try to load them
rm -f /etc/nginx/conf.d/nginx-http.conf /etc/nginx/conf.d/nginx-https.conf

# Test nginx configuration
nginx -t

# Start nginx
exec nginx -g "daemon off;"
