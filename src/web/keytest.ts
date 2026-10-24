import "./styles.css";

import { Announcer } from "./announcer.js";
import { describeVk, mapKey } from "./keymap.js";
import { SettingsStore } from "./settings.js";

const settings = new SettingsStore();
const area = document.getElementById("key-test-area")!;
const instructions = document.getElementById("key-test-instructions")!;
const last = document.getElementById("key-test-last")!;
const log = document.getElementById("key-log")!;
const empty = document.getElementById("key-log-empty")!;
const announcer = new Announcer(document.getElementById("key-announcer")!);

const STOP_HINT = "Press Escape three times in a row to stop testing.";
let escapeCount = 0;
let testing = false;

interface KeyboardLock {
	lock(): Promise<void>;
	unlock(): void;
}
const keyboardLock = () => (navigator as unknown as { keyboard?: KeyboardLock }).keyboard;

async function start(fullscreen: boolean): Promise<void> {
	area.hidden = false;
	testing = true;
	escapeCount = 0;
	let note = "";
	if (fullscreen) {
		try {
			await area.requestFullscreen();
			await keyboardLock()?.lock();
			note = keyboardLock() ? " Full screen with keyboard lock is on." : " Full screen is on, but this browser cannot lock the keyboard.";
		} catch {
			note = " Full screen was not allowed.";
		}
	}
	instructions.textContent = `Press any key. ${STOP_HINT}${note}`;
	area.setAttribute("aria-label", `Key tester. Press any key. ${STOP_HINT}`);
	area.focus();
	announcer.say(`Testing keys. ${STOP_HINT}`);
}

function stop(): void {
	testing = false;
	keyboardLock()?.unlock();
	if (document.fullscreenElement) {
		void document.exitFullscreen().catch(() => {});
	}
	area.hidden = true;
	document.getElementById("start-test")!.focus();
	announcer.say("Stopped testing keys.");
}

area.addEventListener("keydown", (event) => {
	if (!testing) {
		return;
	}
	event.preventDefault();
	escapeCount = event.code === "Escape" ? escapeCount + 1 : 0;
	if (escapeCount >= 3) {
		stop();
		return;
	}
	if (event.repeat) {
		return;
	}
	const current = settings.current;
	const remote = mapKey(event.code, event.key, {
		metaKey: current.metaKey,
		topRowAsFunctionKeys: current.topRowAsFunctionKeys,
	});
	const summary = remote ? `Sends ${describeVk(remote)}` : "Cannot be sent";
	const detail = remote
		? `${summary}. Browser reported key "${event.key}", code "${event.code}". Virtual key ${remote.vk}${remote.extended ? ", extended" : ""}.`
		: `${summary}. Browser reported key "${event.key}", code "${event.code || "none"}".`;
	const item = document.createElement("li");
	item.textContent = detail;
	log.prepend(item);
	empty.hidden = true;
	while (log.children.length > 50) {
		log.lastElementChild?.remove();
	}
	last.textContent = summary;
	announcer.say(summary);
});
area.addEventListener("keyup", (event) => event.preventDefault());
area.addEventListener("blur", () => {
	if (testing && !document.fullscreenElement) {
		stop();
	}
});
document.addEventListener("fullscreenchange", () => {
	if (testing && !document.fullscreenElement) {
		stop();
	}
});

document.getElementById("start-test")!.addEventListener("click", () => void start(false));
document.getElementById("start-test-fullscreen")!.addEventListener("click", () => void start(true));
