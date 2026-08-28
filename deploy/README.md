# Deploying Meero to your own VPS

A from-scratch walkthrough for putting the whole stack (frontend + orchestrator + workers + Redis) on one server behind nginx at **meero.im** / **api.meero.im**. Assumes a fresh Ubuntu/Debian VPS; adjust package-manager commands if you're on something else.

## 0. Before you start

- DNS access for `meero.im` (to add records).
- SSH access to the VPS as a user that can `sudo`.
- The values already set in your `.env` / `orchestrator/.env` (Supabase, OpenAI, Stripe, GitHub OAuth, Supabase OAuth, Vercel) — copy these files to the VPS; **never commit them to git**.

## 1. Point DNS at the VPS

Two A records (and AAAA if the VPS has IPv6), both pointing at the VPS's public IP:

| Host | Type | Value |
| --- | --- | --- |
| `meero.im` | A | your VPS IP |
| `www.meero.im` | A | your VPS IP (optional — nginx redirects it to the bare domain) |
| `api.meero.im` | A | your VPS IP |

Give DNS a few minutes to propagate before requesting certificates in step 5.

## 2. Prepare the VPS

```bash
# Docker + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out/in once for this to take effect

# nginx + certbot
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Firewall — only SSH, HTTP, HTTPS are ever public. This is what actually
# makes the BIND_ADDR=127.0.0.1 hardening below meaningful.
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

**RAM check**: `web-worker` runs a real `next build` per replica and is capped at 4GB × 2 replicas in `docker-compose.yml`. Make sure the VPS has enough headroom (8GB+ recommended), or drop `web-worker`'s `deploy.replicas` to `1` in `docker-compose.yml` first if it's smaller.

## 3. Get the code and secrets onto the VPS

```bash
git clone <your-repo-url> meero && cd meero
```

Then copy your **real** `.env` and `orchestrator/.env` over (from your machine, not via git):

```bash
scp .env orchestrator/.env your-user@your-vps:~/meero/
scp .env your-user@your-vps:~/meero/orchestrator/.env   # run each scp from the right source path
```

In both files, confirm:
- `orchestrator/.env`: `APP_ENV=prod`
- root `.env`: `APP_ENV=prod`

(`app/config.py`'s `_derive_env_urls()` and the Makefile both key off these — see `README.md` §12 if you haven't set this up yet.)

## 4. Set up nginx (HTTP only, for now)

```bash
sudo cp deploy/nginx/meero.im.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/api.meero.im.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/meero.im.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.meero.im.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # avoid it catching requests first
sudo nginx -t && sudo systemctl reload nginx
```

These two configs are already tuned for Meero's actual routes — the WebSocket build-status stream (`/ws/`), the SSE chat reply (`/chat/stream`, unbuffered/ungzipped so it actually streams), and the `/preview/{build_id}/...` proxy that serves every generated app (deliberately **without** a frame-deny header, since the builder legitimately iframes it from `meero.im`). Read the comments in each file before changing anything.

## 5. Get real TLS certificates

```bash
sudo certbot --nginx -d meero.im -d www.meero.im
sudo certbot --nginx -d api.meero.im
```

Certbot edits the two nginx files in place — adding the 443 server block and the http→https redirect — and keeps the `location` blocks you just installed. Verify auto-renewal is scheduled (most distros set this up automatically with the certbot package):

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

## 6. Build and run

```bash
make build
make up
```

`make` reads `APP_ENV=prod` from `.env` and:
- layers `docker-compose.prod.yml` (bakes `NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.meero.im` into the Next.js build, and adds `--proxy-headers --forwarded-allow-ips=*` to the `api` container so `rate_limit.py` sees real client IPs through nginx instead of nginx's own address),
- exports `BIND_ADDR=127.0.0.1`, so `web`/`api`/`redis`'s Docker-published ports are only reachable from the VPS itself — nginx (steps 4–5) is the actual public door.

```bash
make ps      # everything should show "Up"
make logs    # tail all services; Ctrl-C to stop watching
```

## 7. Verify

- `https://meero.im` loads the app.
- `https://api.meero.im/health` returns `{"status": "ok", ...}`.
- Sign up, connect Supabase, build something, watch the live activity stream (proves the WebSocket route works through nginx) and the chat reply typing in token by token (proves SSE isn't being buffered).

## 8. The external dashboards nginx/DNS/Docker can't reach

Update these by hand — they live outside this repo entirely:

- **GitHub OAuth App** ([github.com/settings/developers](https://github.com/settings/developers)) → Authorization callback URL → `https://api.meero.im/auth/github/callback`.
- **Supabase OAuth App** (your org's dashboard → Settings → OAuth Apps) → callback URL → `https://api.meero.im/auth/supabase/callback`.
- **Your Meero Supabase project's own Auth settings** → Site URL → `https://meero.im`, and add `https://meero.im/**` to the redirect URL allow-list.
- **Stripe webhook** (dashboard → Developers → Webhooks) → endpoint → `https://api.meero.im/billing/webhook`.

## Redeploying after a code change

```bash
git pull
make build
make up          # recreates only the containers whose image actually changed
```

## Notes / gotchas

- Docker's `restart: unless-stopped` on every service means the stack comes back on its own after a VPS reboot, as long as the Docker daemon itself starts on boot (`sudo systemctl enable docker` — usually already the default after installing via `get.docker.com`).
- Redis here is job-queue/event-bus state, not your database (that's Supabase, hosted separately) — losing it mid-build just means an in-flight build gets reaped and reported as failed, not data loss.
- If you ever split workers onto a second machine, `redis`'s published port (bound to `BIND_ADDR`, i.e. `127.0.0.1` in prod) needs to change to something that second machine can actually reach — and at that point, set a real Redis password (`--requirepass`) too, since it would no longer be localhost-only.
