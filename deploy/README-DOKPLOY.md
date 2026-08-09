# UPSCbooks — Dokploy Deployment Runbook

Server: `176.100.37.236` (Ubuntu 24.04, Dokploy + Traefik v3)
Domain: `https://upscnotes.shop` (A record → 176.100.37.236, proxied via Cloudflare)

## Topology

- Single Node 22 container (`upscotes-app`) on host port **3003** → container 3000.
- SQLite DB lives in a named Docker volume (`upscotes-data`) mounted at `/app/data`.
  First boot seeds `/app/data/upscbooks.db` from the baked `seed/upscbooks.db`.
- Traefik routes `upscnotes.shop` → `http://176.100.37.236:3003`.
- Optional GitHub auto-deploy webhook on port **9001**.

## 1. First deploy (from a machine with ssh + scp)

```bash
# Server-side prep (already done for this server, kept for reference):
mkdir -p /opt/upscotes
```

From **your Windows/CI machine**, copy the project minus heavy dirs:

```bash
scp -r upscbooks/*.json upscbooks/Dockerfile upscbooks/docker-compose.prod.yml \
    upscbooks/docker-entrypoint.sh upscbooks/.env.prod upscbooks/src upscbooks/public \
    upscbooks/tools upscbooks/seed upscbooks/content upscbooks/deploy root@176.100.37.236:/opt/upscotes/
```

Or simpler, after committing to a git repo:

```bash
git clone <YOUR_REPO> /opt/upscotes
```

## 2. Build & run on the server

```bash
cd /opt/upscotes
docker compose -f docker-compose.prod.yml up -d --build
docker ps                       # expect upscotes-app healthy
docker logs --tail 50 upscotes-app
curl http://127.0.0.1:3003/api/health   # {"ok":true}
```

## 3. Bind the domain in Traefik

```bash
tee /etc/dokploy/traefik/dynamic/upscotes.yml < deploy/traefik-upscotes.yml
# Traefik hot-reloads /etc/dokploy/traefik/dynamic/ — no restart needed.
```

### Cloudflare checks
1. DNS: A record `upscnotes.shop` → `176.100.37.236` (proxied).
2. SSL/TLS mode: **Full** (Traefik serves websecure; Cloudflare terminates client TLS).
3. Test:
   ```bash
   curl -H "Host: upscnotes.shop" http://localhost
   curl -H "Host: upscnotes.shop" http://localhost/api/health
   ```

## 4. Razorpay webhook (DASHBOARD, one-time)

In Razorpay Dashboard → Settings → Webhooks, add:
- **URL:** `https://upscnotes.shop/api/payments/webhook`
- **Events:** `payment.captured`
- **Secret:** = `RAZORPAY_KEY_SECRET` from `.env.prod`
- Active: ON

The app verifies the `X-Razorpay-Signature` HMAC against the same secret and grants
lifetime access exactly once. `payment.failed` is intentionally ignored (client
gets a retry UI). If the webhook isn't reachable, the browser-callback verify path
(`/api/payments/verify`) still activates access.

## 5. Auto-deploy webhook (optional)

```bash
install -m 755 deploy/webhook.py /opt/upscotes/deploy/webhook.py
install -m 644 deploy/upscotes-webhook.service /etc/systemd/system/upscotes-webhook.service
systemctl daemon-reload
systemctl enable --now upscotes-webhook
```
Add `http://176.100.37.236:9001/webhook` as a GitHub repo webhook (Content-Type json).

## Health / troubleshooting

```bash
docker ps
docker logs --tail 100 -f upscotes-app
ls -la /etc/dokploy/traefik/dynamic/
curl -H "Host: upscnotes.shop" http://localhost/api/health
free -h; df -h
```

## Secrets & rotation
- `.env.production` is gitignored, never commit it.
- `SESSION_SECRET`: generate new with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.