import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function expectNoAxeViolations(page: Page) {
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
	expect(summary).toEqual([]);
}

/** Starts the fake controlled computer on the local relay. */
function startFollower(key: string): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const child = spawn("node", ["tools/fakeFollower.mjs", "mad-gamer.com", "6837", key], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		child.stdout!.on("data", (data: Buffer) => {
			if (data.toString().includes("joined")) resolve(child);
		});
		child.on("error", reject);
		setTimeout(() => reject(new Error("follower did not start")), 10_000);
	});
}

test.beforeEach(async ({ page }) => {
	// Full screen is not available in headless Chromium.
	await page.addInitScript(() => {
		if (!localStorage.getItem("nvremote.settings")) {
			localStorage.setItem("nvremote.settings", JSON.stringify({ fullscreenWhileControlling: false }));
		}
	});
});

for (const path of ["/", "/help.html", "/keytest.html", "/privacy.html"]) {
	test(`no accessibility violations on ${path}`, async ({ page }) => {
		await page.goto(path);
		await expectNoAxeViolations(page);
		for (const scheme of ["dark", "light"] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
			expect(results.violations.map((v) => v.nodes.map((n) => n.target.join(" "))).flat(), scheme).toEqual([]);
		}
	});
}

test("validates the form accessibly", async ({ page }) => {
	await page.goto("/");
	await page.getByLabel("Key", { exact: true }).fill("");
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.getByRole("alert")).toContainText("Enter a key");
	await expect(page.getByLabel("Key", { exact: true })).toHaveAttribute("aria-invalid", "true");
	await expect(page.getByLabel("Key", { exact: true })).toBeFocused();
});

test("fills in details from an NVDA Remote link", async ({ page }) => {
	await page.goto("/");
	const server = page.getByRole("textbox", { name: "Server" });
	await server.fill("nvdaremote://example.org:1234?key=abc123&mode=master");
	await server.dispatchEvent("change");
	await expect(server).toHaveValue("example.org");
	await expect(page.getByRole("textbox", { name: "Port" })).toHaveValue("1234");
	await expect(page.getByLabel("Key", { exact: true })).toHaveValue("abc123");
});

test("shows a clear error for private servers", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("textbox", { name: "Server" }).fill("192.168.1.10");
	await page.getByLabel("Key", { exact: true }).fill("x");
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.getByRole("alert")).toContainText("private or reserved network");
	await expect(page.getByText("Not connected")).toBeVisible();
});

test("generates a key", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Generate key" }).click();
	await expect(page.getByLabel("Key", { exact: true })).toHaveValue(/^\d{9}$/);
});

test("full session with a controlled computer", async ({ page }) => {
	const key = `e2e${Date.now()}`;
	const follower = await startFollower(key);
	try {
		await page.goto("/");
		await page.getByLabel("Key", { exact: true }).fill(key);
		await page.getByRole("button", { name: "Connect" }).click();

		await expect(page.locator("#status-text")).toHaveText("Connected to the remote computer");
		await expect(page.getByRole("heading", { name: "Remote session" })).toBeFocused();
		await expectNoAxeViolations(page);

		await page.getByRole("button", { name: "Start controlling the remote computer" }).click();
		const surface = page.getByRole("application");
		await expect(surface).toBeFocused();
		await expect(surface).toHaveAccessibleName(/Controlling the remote computer.*Shift\+Escape/);

		await page.keyboard.press("a");
		await expect(page.locator("#history")).toContainText("a");
		await page.keyboard.press("ArrowDown");
		await expect(page.locator("#history")).toContainText("down arrow extended");
		await page.keyboard.press("F2");
		await expect(page.locator("#history")).toContainText("Tone and sound sent");
		await page.keyboard.press("F1");
		await expect(page.locator("#history")).toContainText("Bonjour");

		await page.keyboard.press("F3");
		await expect(page.locator("#clipboard-text")).toHaveValue("Text from the remote computer");

		await page.keyboard.press("Shift+Escape");
		await expect(page.getByRole("button", { name: "Start controlling the remote computer" })).toBeFocused();

		// The exit key also starts controlling from anywhere on the page.
		await page.keyboard.press("Shift+Escape");
		await expect(surface).toBeFocused();
		await page.keyboard.press("Shift+Escape");

		await page.getByRole("button", { name: "Send Control+Alt+Delete" }).click();
		await expect(page.locator("#history")).toContainText("Secure attention sequence received");

		await page.getByText("Type or paste text to send", { exact: true }).click();
		await page.getByLabel("Text to send").fill("Hi!");
		await page.getByRole("button", { name: "Send as clipboard" }).click();
		await expect(page.locator("#history")).toContainText("Clipboard received: Hi!");

		await page.getByText("On-screen keys", { exact: true }).click();
		await page.getByRole("button", { name: "Read title (NVDA+T)" }).click();
		await expect(page.locator("#history")).toContainText("insert extended");

		await expectNoAxeViolations(page);

		follower.kill();
		await expect(page.locator("#status-text")).toHaveText("Connected, waiting for the remote computer");

		await page.getByRole("button", { name: "Disconnect" }).click();
		await expect(page.locator("#status-text")).toHaveText("Not connected");
		await expect(page.getByRole("button", { name: "Connect" })).toBeFocused();
	} finally {
		follower.kill();
	}
});

test("braille display", async ({ page }) => {
	const key = `braille${Date.now()}`;
	const follower = await startFollower(key);
	try {
		await page.goto("/");
		await page.getByLabel("Show the remote computer's braille display on this page").check();
		await page.getByLabel("Key", { exact: true }).fill(key);
		await page.getByRole("button", { name: "Connect" }).click();
		await expect(page.locator("#status-text")).toHaveText("Connected to the remote computer");
		await page.getByRole("button", { name: "Start controlling the remote computer" }).click();
		await page.keyboard.press("F4");
		await expect(page.locator("#braille-line")).toHaveText("⠓⠑⠇⠇⠕");
	} finally {
		follower.kill();
	}
});
