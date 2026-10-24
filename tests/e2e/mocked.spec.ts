// Flows that are hard to produce with real servers, using a mocked gateway WebSocket.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FINGERPRINT = "ab".repeat(32);

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem("nvremote.settings", JSON.stringify({ fullscreenWhileControlling: false }));
	});
});

test("asks before trusting a certificate, then remembers it", async ({ page }) => {
	const connects: Array<Record<string, unknown>> = [];
	await page.routeWebSocket("**/ws", (ws) => {
		ws.onMessage((raw) => {
			const message = JSON.parse(String(raw));
			if (message.op !== "connect") return;
			connects.push(message);
			if (message.fingerprint !== FINGERPRINT) {
				ws.send(JSON.stringify({ op: "status", state: "connecting" }));
				ws.send(
					JSON.stringify({
						op: "certRequired",
						host: "self.example",
						port: 6837,
						fingerprint: FINGERPRINT,
						reason: "DEPTH_ZERO_SELF_SIGNED_CERT",
					}),
				);
				return;
			}
			ws.send(JSON.stringify({ op: "status", state: "connected" }));
			ws.send(JSON.stringify({ op: "msg", msg: { type: "channel_joined", channel: "k", clients: [] } }));
		});
	});

	await page.goto("/");
	await page.getByRole("textbox", { name: "Server" }).fill("self.example");
	await page.getByLabel("Key", { exact: true }).fill("k");
	await page.getByRole("button", { name: "Connect" }).click();

	const dialog = page.getByRole("dialog", { name: "Trust self.example?" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("self-signed certificate");
	await expect(dialog).toContainText("AB:AB:AB");
	await expect(page.getByRole("button", { name: "Don't connect" })).toBeFocused();
	const results = await new AxeBuilder({ page }).include("#cert-dialog").analyze();
	expect(results.violations.map((v) => v.id)).toEqual([]);

	await page.getByRole("button", { name: "Trust and connect" }).click();
	await expect(page.locator("#status-text")).toHaveText("Connected, waiting for the remote computer");
	expect(connects.at(-1)?.fingerprint).toBe(FINGERPRINT);

	await expect(page.getByRole("list", { name: "Trusted server certificates" })).toContainText("self.example");
	await page.getByRole("button", { name: "Forget self.example" }).click();
	await expect(page.getByText("None. You will be asked")).toBeVisible();
});

test("pressing Escape in the certificate dialog cancels", async ({ page }) => {
	await page.routeWebSocket("**/ws", (ws) => {
		ws.onMessage(() => {
			ws.send(
				JSON.stringify({ op: "certRequired", host: "x.example", port: 6837, fingerprint: FINGERPRINT, reason: "CERT_HAS_EXPIRED" }),
			);
		});
	});
	await page.goto("/");
	await page.getByLabel("Key", { exact: true }).fill("k");
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.getByRole("dialog")).toContainText("expired");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
	await expect(page.getByRole("alert")).toContainText("certificate was not trusted");
});

test("reconnects automatically after the connection drops", async ({ page }) => {
	let connectCount = 0;
	await page.clock.install();
	await page.routeWebSocket("**/ws", (ws) => {
		ws.onMessage((raw) => {
			if (JSON.parse(String(raw)).op !== "connect") return;
			connectCount++;
			ws.send(JSON.stringify({ op: "status", state: "connected" }));
			ws.send(
				JSON.stringify({ op: "msg", msg: { type: "channel_joined", channel: "k", clients: [{ id: 1, connection_type: "slave" }] } }),
			);
			if (connectCount === 1) {
				setTimeout(() => ws.send(JSON.stringify({ op: "status", state: "disconnected", reason: "The server closed the connection." })), 200);
			}
		});
	});
	await page.goto("/");
	await page.getByLabel("Key", { exact: true }).fill("k");
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.locator("#status-text")).toHaveText("Connection lost. Reconnecting…");
	await expect(page.getByRole("button", { name: "Start controlling the remote computer" })).toBeDisabled();
	await page.clock.runFor(5500);
	await expect(page.locator("#status-text")).toHaveText("Connected to the remote computer");
	await expect(page.getByRole("button", { name: "Start controlling the remote computer" })).toBeEnabled();
	expect(connectCount).toBe(2);
});

test("message of the day is shown once", async ({ page }) => {
	await page.routeWebSocket("**/ws", (ws) => {
		ws.onMessage((raw) => {
			if (JSON.parse(String(raw)).op !== "connect") return;
			ws.send(JSON.stringify({ op: "status", state: "connected" }));
			ws.send(JSON.stringify({ op: "msg", msg: { type: "motd", motd: "Welcome!", force_display: false } }));
		});
	});
	await page.goto("/");
	await page.getByLabel("Key", { exact: true }).fill("k");
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.locator("#history")).toContainText("Message from the server: Welcome!");
});
