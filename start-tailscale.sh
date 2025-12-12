#!/bin/sh
# Start the standard Tailscale boot process in the background
/usr/local/bin/containerboot &

# Wait for the socket to be created (loop until success)
echo "Waiting for Tailscale socket..."
until [ -S /tmp/tailscaled.sock ]; do
    sleep 1
done

# Wait for Tailscale to be fully authenticated and ready
echo "Waiting for Tailscale to be ready..."
sleep 10

# Wait for the app to be ready on port 3000
echo "Waiting for app on localhost:3000..."
until wget -q --spider http://localhost:3000 2>/dev/null; do
    echo "App not ready yet, waiting..."
    sleep 2
done
echo "App is ready!"

# Run the serve command first
echo "Configuring Serve..."
tailscale --socket=/tmp/tailscaled.sock serve https:443 / http://localhost:3000

# Enable funnel to expose to public internet
echo "Enabling Funnel..."
tailscale --socket=/tmp/tailscaled.sock funnel 443 on

echo "Tailscale Serve and Funnel configured successfully!"

# Keep the container running (tail the logs of the background process)
wait
