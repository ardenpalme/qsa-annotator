This is an annotation tool for quickly creating a labeled dataset of floor plans for panoptic symbol spotting.

The tool is hosted on an AWS EC2 instance (tx3large, eu-central-1a) \[see [fpcadanot438.xyz](https://fpcadanot438.xyz)\]
1. Next.js web-app running on port 3000.
    1. Web app provides an interface to upload data to Cloudflare R2 Object Storage.
2. Computer Vision Annotation Tool ([CVAT](https://www.cvat.ai/)) runs on port 8080
3. Nginx reverse-proxy protects local http web servers and uses CertBot-signed TLS certificates for domain name `fpcadanot438.xyz` (Provider: GoDaddy).
    1. `nginx/` holds the HTTP-only site configs; `certbot --nginx` adds the TLS lines on the server.
    2. CVAT has its own login; nginx blocks CVAT self-registration.

## Install on a fresh EC2

### 0. AWS and DNS
- Ubuntu 24.04 LTS instance with at least 50 GB of disk (CVAT images and data), plus an Elastic IP.
- Security group inbound: `22` from your IP only, `80` and `443` from anywhere. Do **not** open `3000`, `8080` or `8090`.
- GoDaddy DNS: `A` records for `@`, `www` and `cvat` pointing to the Elastic IP.

### 1. Packages
```sh
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx certbot python3-certbot-nginx docker.io docker-compose-v2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -   # Next 16 needs Node >= 20.9
sudo apt install -y nodejs
sudo usermod -aG docker $USER    # log out and back in afterwards
```

### 2. Repo and CVAT
```sh
git clone --recurse-submodules https://github.com/ardenpalme/app.git ~/qsa-annotator
cd ~/qsa-annotator/cvat
cat > .env <<'EOF'
CVAT_HOST=cvat.fpcadanot438.xyz
CVAT_POSTGRES_PASSWORD=<Neon password>
EOF
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.external_db.yml up -d
docker exec -it cvat_server bash -ic 'python3 ~/manage.py createsuperuser'
```
- `CVAT_HOST` must match the domain, or Traefik answers 404.
- Don't add `docker-compose.https.yml`: it binds Traefik to 80/443, which nginx already uses.
- Traefik only listens on `127.0.0.1:8080`, so CVAT is reachable only through nginx.

### 3. Next.js app
On the server, create the deploy directory and the runtime secrets:
```sh
mkdir -p ~/deploy/.next
sudo install -m 600 -o $USER /dev/null /etc/qsa-annotator.env
nano /etc/qsa-annotator.env      # CLERK_SECRET_KEY, AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID,
                                 # AWS_SECRET_ACCESS_KEY, AWS_REGION, BUCKET
```
On your machine, put the new host in `deploy.sh`, then build and upload:
```sh
pnpm install && pnpm build       # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is baked in here: use the production (pk_live_) key
./deploy.sh
```
`next build` copies your local `.env` into `.next/standalone/`, so `deploy.sh` ships it too. Values in `/etc/qsa-annotator.env` take precedence.

On the server, unpack the upload and run the app as a service on localhost only:
```sh
cd ~/deploy && tar xzf deploy.tar.gz && rm deploy.tar.gz
sudo tee /etc/systemd/system/qsa-annotator.service <<EOF
[Unit]
Description=qsa-annotator Next.js app
After=network.target

[Service]
User=$USER
WorkingDirectory=$HOME/deploy
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
EnvironmentFile=/etc/qsa-annotator.env
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now qsa-annotator
```

### 4. nginx and TLS
```sh
cd ~/qsa-annotator/nginx
sudo cp fpcadanot438.xyz cvat.fpcadanot438.xyz /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/fpcadanot438.xyz /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/cvat.fpcadanot438.xyz /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx --redirect -d fpcadanot438.xyz -d www.fpcadanot438.xyz
sudo certbot --nginx --redirect -d cvat.fpcadanot438.xyz
```
Certbot installs a renewal timer (`systemctl list-timers | grep certbot`).

### 5. fail2ban (brute-force protection for the CVAT login)
fail2ban is a daemon that watches log files. Each *jail* pairs a *filter* (a regex that finds failure lines and pulls out
the client IP) with a ban action. When one IP has `maxretry` failures within `findtime`, fail2ban adds a firewall rule
that drops that IP's traffic to the jail's ports for `bantime`, and removes the rule when it expires. nginx runs on the
host, so bans in the host firewall apply to it. Ubuntu's package also enables an `sshd` jail by default.

The CVAT nginx site writes only failed logins to `/var/log/nginx/cvat-auth-fail.log`:
- a `400` from `POST /api/auth/login`;
- a `401` on any request that carries HTTP Basic credentials.

Plain 401s from a logged-out browser aren't logged, and the `Authorization` value is never logged. The `cvat-auth`
jail bans an IP for 1 h after 5 failures in 10 min.
```sh
sudo apt install -y fail2ban
sudo cp ~/qsa-annotator/fail2ban/filter.d/cvat-auth.conf /etc/fail2ban/filter.d/
sudo cp ~/qsa-annotator/fail2ban/jail.d/cvat-auth.local /etc/fail2ban/jail.d/
sudo systemctl restart fail2ban
sudo fail2ban-client status cvat-auth                  # list banned IPs
sudo fail2ban-client set cvat-auth unbanip <ip>         # unban
```

### 6. Check
```sh
sudo ss -ltnp | grep -E ':(3000|8080|8090)\b'    # all must be 127.0.0.1
curl -sI https://fpcadanot438.xyz | head -1
curl -sI https://cvat.fpcadanot438.xyz | head -1
curl -sI https://cvat.fpcadanot438.xyz/auth/register | grep -i location    # -> /auth/login
```
From your machine, `curl -m 5 http://<Elastic IP>:8080` must time out.

### Updating
- CVAT: `git pull --recurse-submodules`, then rerun the `docker compose ... up -d` from step 2.
- App: `pnpm build && ./deploy.sh`, unpack as in step 3, then `sudo systemctl restart qsa-annotator`.
