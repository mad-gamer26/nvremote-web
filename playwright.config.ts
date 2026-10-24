import { defineConfig } from "@playwright/test";

const GATEWAY_PORT = 39872;
const WEB_PORT = 4173;

// Set PW_BASE_URL (for example https://nvremote.mad-gamer.com) to test a deployed site instead.
const deployed = process.env.PW_BASE_URL;

export default defineConfig({
	testDir: "tests/e2e",
	timeout: 30_000,
	retries: 0,
	workers: 1,
	use: {
		baseURL: deployed ?? `http://127.0.0.1:${WEB_PORT}`,
		browserName: "chromium",
	},
	webServer: deployed ? [] : [
		{
			command: "node dist/gateway/gateway/server.js",
			url: `http://127.0.0.1:${GATEWAY_PORT}/healthz`,
			env: { NVR_LISTEN_PORT: String(GATEWAY_PORT), NVR_ALLOWED_ORIGINS: "*" },
			reuseExistingServer: false,
		},
		{
			command: `npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
			url: `http://127.0.0.1:${WEB_PORT}/`,
			env: { NVR_GATEWAY_URL: `ws://127.0.0.1:${GATEWAY_PORT}` },
			reuseExistingServer: false,
		},
	],
});
