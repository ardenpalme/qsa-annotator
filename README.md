This is an annotation tool for quickly creating a labeled dataset of floor plans for panoptic symbol spotting.

The tool is hosted on a Hetzner Cloud server (CPX22, Ubuntu 24.04) \[see [fpcadanot438.xyz](https://fpcadanot438.xyz)\]
1. Next.js web-app running on port 3000.
    1. Web app provides an interface to upload data to Cloudflare R2 Object Storage.
2. Computer Vision Annotation Tool ([CVAT](https://www.cvat.ai/)) runs on port 8080
3. Nginx reverse-proxy protects local http web servers and uses CertBot-signed TLS certificates for domain name `fpcadanot438.xyz` (Provider: GoDaddy).
    1. `nginx/` holds the HTTP-only site configs; `certbot --nginx` adds the TLS lines on the server.
    2. CVAT has its own login; nginx blocks CVAT self-registration.

## Install on Hetzner Cloud (cloud-init)
`cloud-init.yaml` sets up the base system on first boot. It is based on Hetzner's
[basic cloud-config tutorial](https://community.hetzner.com/tutorials/basic-cloud-config/) and does:
- user `annotator` (passwordless sudo, key-only login), SSH on port **2222**, root login disabled;
- ufw allowing only 2222, 80 and 443, and the fail2ban `sshd` jail;
- git, nginx, certbot, Docker, Node 22 (Next 16 needs Node >= 20.9), plus a 4 GB swapfile;
- reboots.

Cloud-init only runs when the server is created. The app itself is set up by hand in steps 1–4.
Don't put secrets in `cloud-init.yaml`: Hetzner stores user data and serves it to the server from its metadata endpoint.

### 0. Create the server
- In `cloud-init.yaml`, replace `<public_ssh_key>` with your public key (e.g. `~/.ssh/id_ed25519.pub`).
- Hetzner Console → *Add Server*: Ubuntu 24.04, CPX22 (2 vCPU, 4 GB RAM, 80 GB) or larger.
  Paste `cloud-init.yaml` into *Cloud config*.
- GoDaddy DNS: `A` records for `@`, `www` and `cvat` pointing to the server's IPv4.
- Wait a few minutes for the setup and reboot, then log in on port 2222 (22 is closed):
  ```sh
  ssh -p 2222 annotator@<server IP>
  cloud-init status --long        # status: done, no errors
  ```

Root can't log in over SSH. Log in as `annotator` and use `sudo` for admin tasks (e.g. `sudo apt install ...`);
it needs no password.

A CPX22 runs CVAT and the app close to its 4 GB of RAM; swap absorbs spikes. If `free -m` shows swap
constantly in use, rescale to a CPX32 with *CPU and RAM only*, which keeps the disk size so you can scale back down.

### 1. Repo, nginx, fail2ban, service
```sh
git clone --recurse-submodules https://github.com/ardenpalme/app.git ~/qsa-annotator
mkdir -p ~/deploy/.next
cd ~/qsa-annotator

sudo cp nginx/fpcadanot438.xyz nginx/cvat.fpcadanot438.xyz /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/fpcadanot438.xyz /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/cvat.fpcadanot438.xyz /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx     # creates cvat-auth-fail.log, which the cvat-auth jail needs

sudo cp fail2ban/filter.d/cvat-auth.conf /etc/fail2ban/filter.d/
sudo cp fail2ban/jail.d/cvat-auth.local /etc/fail2ban/jail.d/
sudo systemctl restart fail2ban

sudo cp systemd/qsa-annotator.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable qsa-annotator
```

### 2. Secrets and CVAT
```sh
sudo vim /etc/qsa-annotator.env      # CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY 
                                     # AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, BUCKET
chmod 600 /etc/qsa-annotator.env
vim ~/qsa-annotator/cvat             # CVAT_HOST=cvat.fpcadanot438.xyz, CVAT_POSTGRES_PASSWORD=<Neon password>
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.external_db.yml up -d
docker exec -it cvat_server bash -ic 'python3 ~/manage.py createsuperuser'
```
- Only add keys you set in `/etc/qsa-annotator.env`: an empty value overrides the one in the shipped `.env`.
- `CVAT_HOST` must match the domain, or Traefik answers 404.
- Don't add `docker-compose.https.yml`: it binds Traefik to 80/443, which nginx already uses.
- Traefik only listens on `127.0.0.1:8080`, so CVAT is reachable only through nginx.

### 3. Next.js app
On your machine, build and upload:
```sh
pnpm install && pnpm build       # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is baked in here: use the production (pk_live_) key
./deploy.sh <server IP or domain>   # -i <key> to pick an SSH key; -u/-p if not annotator/2222 (see ./deploy.sh -h)
```
`next build` copies your local `.env` into `.next/standalone/`, so `deploy.sh` ships it too. Values in `/etc/qsa-annotator.env` take precedence.

On the server, unpack the upload and start the app (it listens on `127.0.0.1:3000` only):
```sh
cd ~/deploy && tar xzf deploy.tar.gz && rm deploy.tar.gz .env
sudo systemctl start qsa-annotator
```

### 4. TLS
Once DNS points to the server:
```sh
sudo certbot --nginx --redirect -d fpcadanot438.xyz -d cvat.fpcadanot438.xyz
```
Certbot installs a renewal timer (`systemctl list-timers | grep certbot`).

### 5. Check
```sh
sudo ss -ltnp | grep -E ':(3000|8080|8090)\b'    # all must be 127.0.0.1
curl -sI https://fpcadanot438.xyz | head -1
curl -sI https://cvat.fpcadanot438.xyz | head -1
curl -sI https://cvat.fpcadanot438.xyz/auth/register | grep -i location    # -> /auth/login
sudo ufw status                                  # 2222, 80, 443 only
sudo fail2ban-client status                      # jails: cvat-auth, sshd
swapon --show                                    # /swapfile, 4G
```
From your machine, `curl -m 5 http://<server IP>:8080` must time out.

## fail2ban (brute-force protection for SSH and the CVAT login)
fail2ban is a daemon that watches log files. Each *jail* pairs a *filter* (a regex that finds failure lines and pulls out
the client IP) with a ban action. When one IP has `maxretry` failures within `findtime`, fail2ban adds a firewall rule
that drops that IP's traffic to the jail's ports for `bantime`, and removes the rule when it expires. nginx runs on the
host, so bans in the host firewall apply to it. The `sshd` jail covers SSH on port 2222.

The CVAT nginx site writes only failed logins to `/var/log/nginx/cvat-auth-fail.log`:
- a `400` from `POST /api/auth/login`;
- a `401` on any request that carries HTTP Basic credentials.

Plain 401s from a logged-out browser aren't logged, and the `Authorization` value is never logged. The `cvat-auth`
jail bans an IP for 1 h after 5 failures in 10 min.
```sh
sudo fail2ban-client status cvat-auth                  # list banned IPs
sudo fail2ban-client set cvat-auth unbanip <ip>         # unban
```

## Updating
- CVAT: `git pull --recurse-submodules`, then rerun the `docker compose ... up -d` from step 2.
- App: `pnpm build && ./deploy.sh <host>`, unpack as in step 3, then `sudo systemctl restart qsa-annotator`.
