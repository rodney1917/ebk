# EBK Deployment

> Production deployment and any real-money operation require explicit authorisation from the EBK owner.
> These steps describe a **staging/sandbox** deployment to a VPS.

## VPS prerequisites

- Ubuntu 22.04/24.04, 2 vCPU / 4 GB RAM minimum, Docker Engine + Compose plugin.
- A DNS name (e.g. `staging.ebk.example`) pointing at the server.
- Firewall: allow 22 (restricted to admin IPs), 80, 443 only.

## First deployment

```bash
git clone <repo> /opt/ebk && cd /opt/ebk
cp .env.example .env
# Fill in: POSTGRES_PASSWORD, JWT_ACCESS_SECRET (openssl rand -base64 48),
# FIELD_ENCRYPTION_KEY (openssl rand -base64 32), SANDBOX_WEBHOOK_SECRET,
# APP_ORIGIN=https://staging.ebk.example, API_PUBLIC_URL=https://staging.ebk.example,
# NODE_ENV=staging
npm install --package-lock-only        # once, to create package-lock.json (commit it)
docker compose up -d --build
docker compose logs -f migrate api
```

`migrate` runs `prisma migrate deploy` and the seed, then exits; `api` starts only after it succeeds.

## TLS

Terminate TLS on the host in front of the `web` container, e.g. Caddy:

```
staging.ebk.example {
  reverse_proxy 127.0.0.1:80
}
```

Then change the `web` port mapping to `127.0.0.1:80:80`. HSTS is sent by the API when `NODE_ENV=production`.

## Backups

The `backup` service writes a verified `pg_dump` daily to the `backups` volume with 14-day retention.
Also copy backups off the server, encrypted (e.g. `restic` to object storage), and **test a restore**
monthly:

```bash
docker compose exec backup sh -c 'pg_restore --list /backups/<file>.dump | head'
createdb ebk_restore_test && pg_restore -d ebk_restore_test /path/to/file.dump
```

## Updates

```bash
git pull && docker compose up -d --build     # migrate runs before api restarts
```

Review every migration for statements dropping the hand-written integrity objects (see DATABASE.md).

## Production gating checklist (Phase 7)

- [ ] Regulatory permissions / agent arrangements confirmed (FCA in the UK; Bank of Zambia for payouts).
- [ ] Signed contracts and production credentials with collection and payout partners.
- [ ] `NODE_ENV=production`, `SANDBOX_PROVIDERS_ENABLED=false`, production provider rows only.
- [ ] Live rate source configured; fee schedule approved by management.
- [ ] Security items in SECURITY.md "Required before pilot" closed; pen test passed.
- [ ] Monitoring, on-call, incident and reconciliation procedures in place.
- [ ] Written authorisation from the owner to go live.
