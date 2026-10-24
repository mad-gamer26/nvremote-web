# NVDA Remote Web

An accessible web client for NVDA Remote, so a browser (for example on a Chromebook) can
control a Windows computer running NVDA. Live at https://nvremote.mad-gamer.com.

## How it works

Browsers can't open raw TLS sockets, so a small gateway bridges them:

```
Browser ──WSS──▶ nginx (nvremote.mad-gamer.com) ──▶ gateway (127.0.0.1:39870) ──TLS──▶ NVDA Remote relay
```

- `src/gateway/` is a Node WebSocket server. Each WebSocket carries one relay session, always as
  the controlling ("master") side. It only connects to public addresses (or the relay on this
  machine, NVDARemoteServer on port 6837, reached as mad-gamer.com), verifies certificates like NVDA does (with
  fingerprint trust for self-signed servers), only forwards an allowlist of message types,
  rate-limits per IP, and never logs content or keys.
- `src/web/` is the browser app (plain TypeScript and semantic HTML, built with Vite): key
  mapping to Windows virtual keys, speech via the Web Speech API or the user's screen reader,
  NVDA's beeps and sounds, clipboard, Control+Alt+Delete, braille, and on-screen keys.
- `src/shared/protocol.ts` defines the browser and gateway messages.
- The NVDA Remote protocol itself is documented by NVDA's
  [`source/_remoteClient`](https://github.com/nvaccess/nvda/tree/master/source/_remoteClient).

NVDA Remote Web is an independent project, not made by or affiliated with NV Access.

## Development

```sh
npm install
npm test                 # unit tests (vitest)
npm run build            # gateway to dist/gateway, site to dist/web
npx playwright test      # browser and accessibility tests against a local build
PW_BASE_URL=https://nvremote.mad-gamer.com npx playwright test   # against the live site
node tools/fakeFollower.mjs mad-gamer.com 6837 <key>    # a fake controlled computer
```

For live development, run the gateway (`NVR_ALLOWED_ORIGINS='*' npm start` after building)
and `npm run dev:web`; Vite proxies `/ws` to it.

## Deployment

`deploy/deploy.sh` builds, tests and installs everything on this server:

- Site: `/opt/nvremote-web/public`, gateway: `/opt/nvremote-web/gateway`
- Service: `nvremote-web-gateway.service` (settings in `/etc/nvremote-web.env`)
- nginx: `/etc/nginx/sites-available/nvremote.conf` (wildcard certificate)
- Logs: `journalctl -u nvremote-web-gateway`

## Self-hosting

To run your own copy under another domain:

1. In `src/web/links.ts`, set `DEFAULT_HOST` to the NVDA Remote server people should connect to by default.
2. In `/etc/nvremote-web.env` (from `deploy/nvremote-web.env`), set `NVR_ALLOWED_ORIGINS` to your
   site's address. If you also run an NVDA Remote relay on the same machine, list its names in
   `NVR_LOCAL_RELAY_HOSTS`; otherwise leave that empty, since connections to the machine's own
   addresses are blocked.
3. In `deploy/nginx-nvremote.conf`, change `server_name`, the certificate include and the
   `wss://` address in the Content-Security-Policy.
4. Adjust the paths in `deploy/deploy.sh` and the systemd unit if needed, then run the script.

Gateway settings (all optional): `NVR_LISTEN_HOST`, `NVR_LISTEN_PORT`, `NVR_ALLOWED_ORIGINS`
(`*` allows any, for development only), `NVR_LOCAL_RELAY_HOSTS`, `NVR_LOCAL_RELAY_ADDRESS`,
`NVR_LOCAL_RELAY_PORT`, `NVR_TRUST_PROXY`, `NVR_MAX_SESSIONS_PER_IP`,
`NVR_MAX_CONNECTS_PER_MINUTE`, `NVR_MAX_TOTAL_SESSIONS`, `NVR_CONNECT_TIMEOUT_MS`.

## Contributing

Issues and pull requests are welcome. Accessibility is the top priority: changes to the page
should work with keyboard only and with screen readers, and `npx playwright test` must stay
free of axe violations. Note that the full-session browser tests expect an NVDA Remote relay
reachable as `mad-gamer.com`; run `npx playwright test mocked` and `npm test` if you don't
have one.

## Licence

GPL-2.0-or-later (see [LICENSE](LICENSE)). The sounds in `src/web/public/waves` come from NVDA (GPL-2.0).
