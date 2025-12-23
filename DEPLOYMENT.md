# Deployment Setup Guide

This guide walks you through setting up automated deployment from GitHub Actions to your Synology NAS using Tailscale.

## Overview

When you push to the `main` branch, GitHub Actions will:
1. Build the React client
2. Connect to your Tailscale network
3. Copy files to your Synology via SSH
4. Deploy using Docker Compose

## Prerequisites

- Synology NAS with Docker installed (via Package Center)
- Tailscale installed on your Synology
- SSH access enabled on Synology
- Sudo access for the deployment user

## Setup Steps

### 1. Enable SSH on Synology

1. Open Synology DSM
2. Go to Control Panel → Terminal & SNMP
3. Enable SSH service
4. Note the port (default: 22, but can be customized for security)

### 2. Create Deployment User (Optional but Recommended)

```bash
# SSH into your Synology as admin
ssh admin@your-synology-ip

# Create a deployment user
sudo synouser --add deployer YourSecurePassword "Deployment User" 0 "" 0

# Add to administrators group for Docker access
sudo synogroup --member administrators deployer
```

### 3. Configure Passwordless Sudo

Edit the sudoers file on your Synology:

```bash
sudo visudo
```

Add these lines (replace `deployer` with your deployment username):

```
deployer ALL=(ALL) NOPASSWD: /usr/local/bin/docker-compose
deployer ALL=(ALL) NOPASSWD: /usr/bin/docker
```

Save and exit (`:wq` in vi).

### 4. Generate SSH Key Pair

On your local machine:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/synology_deploy
```

### 5. Copy Public Key to Synology

```bash
ssh-copy-id -i ~/.ssh/synology_deploy.pub deployer@your-synology-tailscale-ip
```

Or manually:

```bash
# On Synology
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# Paste the contents of synology_deploy.pub into ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 6. Setup Tailscale OAuth for GitHub Actions

1. Go to [Tailscale OAuth Clients](https://login.tailscale.com/admin/settings/oauth)
2. Click "Generate OAuth client"
3. Add these scopes:
   - `devices:write` (required)
4. (Optional) Add tag `tag:ci` for better ACL control
5. Save the Client ID and Client Secret

### 7. Configure GitHub Secrets

In your GitHub repository, go to Settings → Secrets and variables → Actions, and add:

| Secret Name | Value | Description |
|------------|-------|-------------|
| `TS_OAUTH_CLIENT_ID` | `<client-id>` | Tailscale OAuth client ID |
| `TS_OAUTH_SECRET` | `<client-secret>` | Tailscale OAuth client secret |
| `SYNOLOGY_TAILSCALE_IP` | `100.x.x.x` | Your Synology's Tailscale IP |
| `SYNOLOGY_SSH_PORT` | `22` | SSH port (default 22, or your custom port) |
| `SYNOLOGY_USER` | `deployer` | SSH username |
| `SYNOLOGY_SSH_KEY` | `<private-key>` | Contents of `~/.ssh/synology_deploy` |
| `SYNOLOGY_DEPLOY_PATH` | `/volume1/docker/chor-dai-dee` | Deployment directory path |

To get your private key contents:

```bash
cat ~/.ssh/synology_deploy
```

Copy the entire output including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`.

### 8. Create Deployment Directory on Synology

```bash
ssh -p <your-ssh-port> deployer@your-synology-tailscale-ip
mkdir -p /volume1/docker/chor-dai-dee
```

### 9. Test the Setup

Push a commit to the `main` branch or manually trigger the workflow:

1. Go to your GitHub repository
2. Click "Actions" tab
3. Select "Deploy to Synology" workflow
4. Click "Run workflow"

## Accessing Your Application

After successful deployment:

- **Client (Web UI)**: `http://your-synology-ip:8080`
- **Server API**: `http://your-synology-ip:3000`

You can also access via your Synology's Tailscale IP from any device on your tailnet.

## Troubleshooting

### SSH Connection Issues

```bash
# Test SSH connection from your local machine
ssh -i ~/.ssh/synology_deploy deployer@your-synology-tailscale-ip

# If that works, the GitHub Action should work too
```

### Docker Permission Issues

```bash
# Make sure the user is in the docker group
sudo synogroup --get administrators
# Should list your deployment user

# Or add manually:
sudo synogroup --member administrators deployer
```

### Sudo Password Prompts

If sudo asks for a password, check your sudoers configuration:

```bash
sudo visudo
# Verify the NOPASSWD entries are present
```

### View Docker Logs

```bash
ssh deployer@your-synology-tailscale-ip
cd /volume1/docker/chor-dai-dee
sudo docker-compose logs -f
```

### Workflow Fails on Tailscale Connection

- Verify OAuth client has `devices:write` scope
- Check that OAuth credentials are correct in GitHub secrets
- Ensure the client hasn't expired

## Manual Deployment

If you need to deploy manually:

```bash
# SSH into Synology
ssh deployer@your-synology-tailscale-ip

# Navigate to deployment directory
cd /volume1/docker/chor-dai-dee

# Pull latest changes (if using git on Synology)
git pull

# Rebuild and restart
sudo docker-compose down
sudo docker-compose build --no-cache
sudo docker-compose up -d

# Check status
sudo docker-compose ps
sudo docker-compose logs -f
```

## Security Notes

- The Tailscale connection is ephemeral - GitHub Actions runners join and leave your tailnet automatically
- SSH keys are scoped to the deployment user only
- Sudoers is restricted to only Docker commands
- Database file is persisted outside the container and excluded from deployment overwrites
- Consider using Tailscale ACLs to further restrict access from `tag:ci` nodes

## Updating the Workflow

The workflow file is located at [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

To modify deployment behavior, edit this file and commit changes.
