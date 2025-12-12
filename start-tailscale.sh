#!/bin/sh
# Start the standard Tailscale boot process in the background
/usr/local/bin/containerboot &

# Wait for the socket to be created (loop until success)
echo "Waiting for Tailscale socket..."
until [ -S /tmp/tailscaled.sock ]; do
    sleep 1
done

# Wait a few more seconds for the daemon to be fully ready
sleep 5

# Run the serve command
echo "Configuring Serve..."
tailscale --socket=/tmp/tailscaled.sock serve https / http://localhost:3000

# Keep the container running (tail the logs of the background process)
wait
