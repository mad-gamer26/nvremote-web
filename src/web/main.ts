import "./styles.css";

import { DEFAULT_RELAY_PORT, type RemoteMessage } from "../shared/protocol.js";
import { Announcer } from "./announcer.js";
import { AudioOutput } from "./audio.js";
import { cellsToUnicode } from "./braille.js";
import { RemoteConnection, type CertificateRequest, type ConnectionState } from "./connection.js";
import { ControlSurface } from "./controlSurface.js";
import { keyForCharacter, VK, type RemoteKey } from "./keymap.js";
import {
	DEFAULT_HOST,
	formatAddress,
	nvdaRemoteLink,
	parseAddress,
	parseNvdaRemoteUrl,
	parseShareFragment,
	shareLink,
	type ConnectionDetails,
} from "./links.js";
import { buildOnscreenKeys, pressCombination } from "./onscreenKeys.js";
import {
	EXIT_KEY_LABELS,
	forgetFingerprint,
	isExitKey,
	SettingsStore,
	trustedFingerprints,
	type ExitKey,
	type Settings,
	type SpeechMode,
} from "./settings.js";
import {
	BrowserVoiceOutput,
	LiveRegionOutput,
	NoSpeechOutput,
	parseSequence,
	Priority,
	type SpeechOutput,
} from "./speech.js";
import { readJson, writeJson } from "./storage.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing element #${id}`);
	}
	return element as T;
};

const settings = new SettingsStore();
const audio = new AudioOutput();
const voice = BrowserVoiceOutput.isSupported()
	? new BrowserVoiceOutput(() => ({
			voiceURI: settings.current.voiceURI,
			rate: settings.current.rate,
			pitch: settings.current.pitch,
			volume: settings.current.volume,
		}))
	: null;
const announcerContainer = $("announcer");
const liveOutput = new LiveRegionOutput(announcerContainer);
const silentOutput = new NoSpeechOutput();
const announcer = new Announcer(announcerContainer, (text) => {
	if (settings.current.speakAppMessages && voice) {
		voice.speakText(text);
	}
});

function speechOutput(): SpeechOutput {
	switch (settings.current.speechMode) {
		case "voice":
			return voice ?? liveOutput;
		case "screenReader":
			return liveOutput;
		case "off":
			return silentOutput;
	}
}

// ---------------------------------------------------------------- Elements

const statusText = $("status-text");
const connectSection = $("connect-section");
const connectForm = $<HTMLFormElement>("connect-form");
const connectError = $("connect-error");
const hostInput = $<HTMLInputElement>("host");
const portInput = $<HTMLInputElement>("port");
const keyInput = $<HTMLInputElement>("key");
const rememberKey = $<HTMLInputElement>("remember-key");
const connectButton = $<HTMLButtonElement>("connect-button");
const generateKeyButton = $<HTMLButtonElement>("generate-key");
const sessionSection = $("session-section");
const sessionHeading = $("session-heading");
const sessionSummary = $("session-summary");
const controlToggle = $<HTMLButtonElement>("control-toggle");
const controlHint = $("control-hint");
const surfaceElement = $("control-surface");
const surfaceInstructions = $("control-surface-instructions");
const lastSpeech = $("control-last-speech");
const muteToggle = $<HTMLButtonElement>("mute-toggle");
const clipboardSection = $("clipboard-section");
const clipboardText = $<HTMLTextAreaElement>("clipboard-text");
const sendText = $<HTMLTextAreaElement>("send-text");
const brailleSection = $("braille-section");
const brailleLine = $("braille-line");
const historyList = $<HTMLOListElement>("history");
const historyEmpty = $("history-empty");
const certDialog = $<HTMLDialogElement>("cert-dialog");

// ---------------------------------------------------------------- Connection

let followers = 0;
let muted = false;
let notConnectedAnnounced = false;

const connection = new RemoteConnection({
	onState: handleState,
	onMessage: handleRemoteMessage,
	onError: (message) => {
		if (connection.state === "reconnecting") {
			return;
		}
		showConnectError(message);
	},
	confirmCertificate,
	onCertificateTrusted: () => renderTrustedList(),
});
connection.autoReconnect = settings.current.autoReconnect;

function sendKey(key: RemoteKey, pressed: boolean): void {
	connection.send({ type: "key", vk_code: key.vk, extended: key.extended, pressed });
}

const control = new ControlSurface({
	surface: surfaceElement,
	sendKey,
	getKeymap: () => ({
		metaKey: settings.current.metaKey,
		topRowAsFunctionKeys: settings.current.topRowAsFunctionKeys,
	}),
	getExitKey: () => settings.current.exitKey,
	useFullscreen: () => settings.current.fullscreenWhileControlling,
	onChange: (controlling, reason) => {
		controlToggle.textContent = controlling
			? "Stop controlling the remote computer"
			: "Start controlling the remote computer";
		if (controlling) {
			if (settings.current.cueSounds) {
				void audio.playWave("controlling");
			}
			announcer.say("Controlling the remote computer.");
		} else {
			controlToggle.focus();
			announcer.say(`${reason ? `${reason} ` : ""}Stopped controlling. Keys now stay on this device.`);
		}
	},
});

function exitKeyLabel(): string {
	return EXIT_KEY_LABELS[settings.current.exitKey];
}

function updateControlHints(): void {
	const label = exitKeyLabel();
	controlHint.textContent = `Or press ${label} anywhere on this page. Press ${label} again to stop controlling.`;
	surfaceInstructions.textContent = `Your keys now go to the remote computer. Press ${label} to stop controlling.`;
	surfaceElement.setAttribute(
		"aria-label",
		`Controlling the remote computer. Keys go to the remote computer. Press ${label} to stop.`,
	);
}

function setStatus(text: string): void {
	statusText.textContent = text;
}

function updateSessionSummary(): void {
	const details = connection.details;
	if (!details) {
		return;
	}
	const where = `Server ${formatAddress(details.host, details.port)}, key ${details.key}.`;
	const remote =
		followers > 0
			? "The remote computer is connected."
			: "Waiting for the remote computer to connect with the same server and key.";
	sessionSummary.textContent = `${where} ${remote}`;
	setStatus(followers > 0 ? "Connected to the remote computer" : "Connected, waiting for the remote computer");
	($<HTMLInputElement>("nvda-link")).value = nvdaRemoteLink(details);
	($<HTMLInputElement>("share-link")).value = shareLink(`${location.origin}/`, details);
}

function handleState(state: ConnectionState, detail?: string): void {
	const busy = state === "connecting";
	connectButton.disabled = busy;
	connectButton.textContent = busy ? "Connecting…" : "Connect";
	switch (state) {
		case "connecting":
			setStatus("Connecting…");
			announcer.say("Connecting…");
			break;
		case "connected": {
			const wasReconnecting = !sessionSection.hidden;
			followers = 0;
			notConnectedAnnounced = false;
			connectSection.hidden = true;
			sessionSection.hidden = false;
			setSessionControlsEnabled(true);
			updateSessionSummary();
			if (settings.current.cueSounds) {
				void audio.playWave("connected");
			}
			if (wasReconnecting) {
				announcer.say("Reconnected.");
			} else {
				sessionHeading.focus();
				announcer.say("Connected. Waiting for the remote computer.");
			}
			break;
		}
		case "reconnecting":
			control.stop();
			setSessionControlsEnabled(false);
			setStatus("Connection lost. Reconnecting…");
			announcer.say(`${detail ? `${detail} ` : ""}Reconnecting…`, true);
			break;
		case "idle": {
			const wasInSession = !sessionSection.hidden;
			control.stop();
			speechOutput().cancel();
			followers = 0;
			sessionSection.hidden = true;
			connectSection.hidden = false;
			setStatus("Not connected");
			if (wasInSession) {
				if (settings.current.cueSounds) {
					void audio.playWave("disconnected");
				}
				announcer.say(detail ?? "Disconnected.");
				connectButton.focus();
			} else if (detail && detail !== "Disconnected.") {
				showConnectError(detail);
			}
			break;
		}
	}
}

function setSessionControlsEnabled(enabled: boolean): void {
	for (const element of sessionSection.querySelectorAll<HTMLButtonElement>("button")) {
		if (element.id !== "disconnect-button") {
			element.disabled = !enabled;
		}
	}
}

function showConnectError(message: string): void {
	connectError.textContent = message;
	connectError.hidden = false;
}

function clearConnectError(): void {
	connectError.hidden = true;
	connectError.textContent = "";
	for (const input of [hostInput, portInput, keyInput]) {
		input.removeAttribute("aria-invalid");
	}
}

// ---------------------------------------------------------------- Remote messages

function handleRemoteMessage(message: RemoteMessage): void {
	switch (message.type) {
		case "speak": {
			const text = parseSequence(message.sequence)
				.map((chunk) => chunk.text)
				.join(" ");
			if (text) {
				addHistory(text);
				lastSpeech.textContent = text;
			}
			if (!muted) {
				speechOutput().speak(message.sequence, typeof message.priority === "number" ? message.priority : Priority.Normal);
			}
			break;
		}
		case "cancel":
			speechOutput().cancel();
			break;
		case "pause_speech":
			speechOutput().pause(Boolean(message.switch));
			break;
		case "tone":
			if (!muted && settings.current.soundsEnabled) {
				audio.beep(Number(message.hz), Number(message.length), num(message.left, 50), num(message.right, 50));
			}
			break;
		case "wave":
			if (!muted && settings.current.soundsEnabled) {
				audio.playRemoteWave(message.fileName);
			}
			break;
		case "display":
			if (settings.current.brailleEnabled) {
				brailleLine.textContent = cellsToUnicode(message.cells);
			}
			break;
		case "set_clipboard_text":
			void receiveClipboard(String(message.text ?? ""));
			break;
		case "channel_joined": {
			const clients = Array.isArray(message.clients) ? (message.clients as Array<{ connection_type?: string }>) : null;
			const ids = Array.isArray(message.user_ids) ? message.user_ids : [];
			// Older servers do not say which kind each client is; assume they are computers to control.
			followers = clients ? clients.filter((c) => c.connection_type !== "master").length : ids.length;
			updateSessionSummary();
			sendBrailleInfo();
			if (followers > 0) {
				announcer.say("The remote computer is connected.");
			}
			break;
		}
		case "client_joined": {
			const client = message.client as { connection_type?: string } | undefined;
			if (client?.connection_type === "master") {
				announcer.say("Another controller joined this session.");
				break;
			}
			followers++;
			notConnectedAnnounced = false;
			updateSessionSummary();
			sendBrailleInfo();
			if (settings.current.cueSounds) {
				void audio.playWave("controlling");
			}
			announcer.say("The remote computer connected.");
			break;
		}
		case "client_left": {
			const client = message.client as { connection_type?: string } | undefined;
			if (client?.connection_type === "master") {
				announcer.say("Another controller left this session.");
				break;
			}
			followers = Math.max(0, followers - 1);
			updateSessionSummary();
			if (settings.current.cueSounds) {
				void audio.playWave("disconnected");
			}
			announcer.say("The remote computer disconnected.", true);
			break;
		}
		case "motd":
			showMotd(String(message.motd ?? ""), Boolean(message.force_display));
			break;
		case "nvda_not_connected":
			if (!notConnectedAnnounced) {
				notConnectedAnnounced = true;
				announcer.say("The remote computer is not connected yet, so keys are not going anywhere.", true);
			}
			break;
		case "version_mismatch":
			announcer.say("The remote computer uses an incompatible version of NVDA Remote.", true);
			break;
		case "error":
			announcer.say(`The server reported an error: ${String(message.error ?? "unknown")}.`, true);
			break;
	}
}

function num(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function showMotd(motd: string, force: boolean): void {
	if (!motd) {
		return;
	}
	// Like NVDA, only show a message of the day again when it changes, unless the server insists.
	const details = connection.details;
	const address = details ? formatAddress(details.host, details.port) : "";
	const seen = readJson<Record<string, string>>("nvremote.motdSeen", {});
	if (!force && seen[address] === motd) {
		return;
	}
	writeJson("nvremote.motdSeen", { ...seen, [address]: motd });
	addHistory(`Message from the server: ${motd}`);
	announcer.say(`Message from the server: ${motd}`);
}

function sendBrailleInfo(): void {
	const cells = settings.current.brailleEnabled ? settings.current.brailleCells : 0;
	connection.send({ type: "set_braille_info", name: "webBraille", numCells: cells });
}

// ---------------------------------------------------------------- Clipboard

async function receiveClipboard(text: string): Promise<void> {
	clipboardText.value = text;
	clipboardSection.hidden = false;
	if (settings.current.cueSounds) {
		void audio.playWave("clipboardReceive");
	}
	try {
		await navigator.clipboard.writeText(text);
		announcer.say("Clipboard received and copied to this device.");
	} catch {
		announcer.say("Clipboard received. Use the Copy to my clipboard button to copy it to this device.");
	}
}

function sendClipboardText(text: string): void {
	if (!text) {
		announcer.say("There is no text to send.");
		return;
	}
	connection.send({ type: "set_clipboard_text", text });
	if (settings.current.cueSounds) {
		void audio.playWave("clipboardPush");
	}
	announcer.say("Clipboard sent.");
}

async function copyToLocalClipboard(text: string, what: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		announcer.say(`${what} copied.`);
	} catch {
		announcer.say(`Could not copy ${what.toLowerCase()}. Select the text and copy it instead.`, true);
	}
}

$("push-clipboard").addEventListener("click", async () => {
	try {
		sendClipboardText(await navigator.clipboard.readText());
	} catch {
		announcer.say(
			"This browser did not allow reading your clipboard. Paste into Type or paste text to send, then choose Send as clipboard.",
			true,
		);
		($<HTMLDetailsElement>("send-text-details")).open = true;
		sendText.focus();
	}
});
$("copy-clipboard").addEventListener("click", () => void copyToLocalClipboard(clipboardText.value, "Clipboard text"));
$("send-text-clipboard").addEventListener("click", () => sendClipboardText(sendText.value));

$("type-text").addEventListener("click", () => {
	const text = sendText.value;
	if (!text) {
		announcer.say("There is no text to type.");
		return;
	}
	let skipped = 0;
	for (const char of text.replace(/\r\n?/g, "\n")) {
		const typed = keyForCharacter(char);
		if (!typed) {
			skipped++;
			continue;
		}
		const keys: RemoteKey[] = typed.shift
			? [{ vk: VK.LSHIFT, extended: false }, { vk: typed.vk, extended: false }]
			: [{ vk: typed.vk, extended: false }];
		pressCombination(keys, sendKey);
	}
	announcer.say(
		skipped
			? `Typed. ${skipped} character${skipped === 1 ? "" : "s"} could not be typed; use Send as clipboard for those.`
			: "Typed.",
	);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
	button.addEventListener("click", () => {
		const input = $<HTMLInputElement>(button.dataset.copy!);
		void copyToLocalClipboard(input.value, "Link");
	});
}

// ---------------------------------------------------------------- Session actions

controlToggle.addEventListener("click", () => {
	if (control.controlling) {
		control.stop();
	} else {
		void control.start();
	}
});
$("control-stop").addEventListener("click", () => control.stop());
surfaceElement.addEventListener("click", (event) => {
	// Clicking the surface (outside the stop button) keeps focus on it.
	if (event.target === surfaceElement) {
		surfaceElement.focus();
	}
});

document.addEventListener("keydown", (event) => {
	if (control.controlling || sessionSection.hidden || connection.state !== "connected") {
		return;
	}
	if (isExitKey(event, settings.current.exitKey)) {
		event.preventDefault();
		void control.start();
	}
});

$("send-sas").addEventListener("click", () => {
	connection.send({ type: "send_SAS" });
	announcer.say("Sent Control+Alt+Delete.");
});

muteToggle.addEventListener("click", () => {
	muted = !muted;
	muteToggle.setAttribute("aria-pressed", String(muted));
	if (muted) {
		speechOutput().cancel();
	}
	announcer.say(muted ? "Remote speech and sounds muted." : "Remote speech and sounds unmuted.");
});

$("disconnect-button").addEventListener("click", () => connection.disconnect());

buildOnscreenKeys($("onscreen-keys"), sendKey, (text) => announcer.say(text));

// ---------------------------------------------------------------- Speech history

function addHistory(text: string): void {
	const item = document.createElement("li");
	item.textContent = text;
	historyList.append(item);
	historyEmpty.hidden = true;
	while (historyList.children.length > settings.current.historyLimit) {
		historyList.firstElementChild?.remove();
	}
}

$("clear-history").addEventListener("click", () => {
	historyList.replaceChildren();
	historyEmpty.hidden = false;
	announcer.say("Speech history cleared.");
});
$("copy-history").addEventListener("click", () => {
	const text = [...historyList.children].map((item) => item.textContent).join("\n");
	void copyToLocalClipboard(text, "Speech history");
});

// ---------------------------------------------------------------- Connect form

const LAST_CONNECTION_KEY = "nvremote.lastConnection";

function loadInitialDetails(): void {
	const saved = readJson<{ host: string; port: number; key: string; rememberKey: boolean }>(LAST_CONNECTION_KEY, {
		host: DEFAULT_HOST,
		port: DEFAULT_RELAY_PORT,
		key: "",
		rememberKey: false,
	});
	hostInput.value = saved.host;
	portInput.value = String(saved.port);
	keyInput.value = saved.rememberKey ? saved.key : "";
	rememberKey.checked = saved.rememberKey;

	const shared = parseShareFragment(location.hash);
	if (shared) {
		hostInput.value = shared.host ?? DEFAULT_HOST;
		portInput.value = String(shared.port ?? DEFAULT_RELAY_PORT);
		keyInput.value = shared.key ?? "";
		// Keep the key out of the address bar and browser history.
		history.replaceState(null, "", location.pathname);
		announcer.say("Connection details filled in from the link. Press Connect when ready.");
	}
}

function applyNvdaLink(): boolean {
	const parsed = parseNvdaRemoteUrl(hostInput.value);
	if (!parsed) {
		return false;
	}
	hostInput.value = parsed.host;
	portInput.value = String(parsed.port);
	if (parsed.key) {
		keyInput.value = parsed.key;
	}
	announcer.say("Server, port and key filled in from the NVDA Remote link.");
	return true;
}

hostInput.addEventListener("paste", () => window.setTimeout(applyNvdaLink, 0));
hostInput.addEventListener("change", () => {
	if (applyNvdaLink()) {
		return;
	}
	// Accept "host:port" typed into the server field, as NVDA does.
	const parsed = parseAddress(hostInput.value);
	if (parsed && hostInput.value.trim().match(/:\d+$|\]:\d+$/)) {
		hostInput.value = parsed.host;
		portInput.value = String(parsed.port);
	}
});

function readForm(requireKey: boolean): ConnectionDetails | null {
	clearConnectError();
	applyNvdaLink();
	const host = hostInput.value.trim();
	const port = Number(portInput.value.trim());
	const key = keyInput.value.trim();
	const problems: Array<[HTMLInputElement, string]> = [];
	if (!host) {
		problems.push([hostInput, "Enter a server."]);
	}
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		problems.push([portInput, "The port must be a number from 1 to 65535."]);
	}
	if (requireKey && !key) {
		problems.push([keyInput, "Enter a key, or choose Generate key."]);
	}
	if (problems.length) {
		for (const [input] of problems) {
			input.setAttribute("aria-invalid", "true");
		}
		showConnectError(problems.map(([, message]) => message).join(" "));
		problems[0]![0].focus();
		return null;
	}
	return { host, port, key };
}

function unlockAudio(): void {
	audio.unlock();
	if (voice) {
		// Speaking something silent during a user action lets later speech play without one.
		speechSynthesis.speak(new SpeechSynthesisUtterance(""));
	}
}

connectForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const details = readForm(true);
	if (!details) {
		return;
	}
	unlockAudio();
	writeJson(LAST_CONNECTION_KEY, {
		host: details.host,
		port: details.port,
		key: rememberKey.checked ? details.key : "",
		rememberKey: rememberKey.checked,
	});
	void connection.connect(details);
});

generateKeyButton.addEventListener("click", async () => {
	const details = readForm(false);
	if (!details) {
		return;
	}
	generateKeyButton.disabled = true;
	announcer.say("Generating key…");
	try {
		keyInput.value = await connection.generateKey(details.host, details.port);
		keyInput.focus();
		announcer.say(`Key generated: ${keyInput.value.split("").join(" ")}`);
	} catch (error) {
		showConnectError(`Could not generate a key. ${(error as Error).message}`);
	} finally {
		generateKeyButton.disabled = false;
	}
});

// ---------------------------------------------------------------- Certificate dialog

function formatFingerprint(fingerprint: string): string {
	return (fingerprint.toUpperCase().match(/.{2}/g) ?? []).join(":");
}

function describeCertificateProblem(reason: string): string {
	if (/SELF_SIGNED|DEPTH_ZERO/i.test(reason)) {
		return "The server uses a self-signed certificate, which is common for NVDA Remote servers run by individuals.";
	}
	if (/EXPIRED/i.test(reason)) {
		return "The server's certificate has expired.";
	}
	if (/ALTNAME|hostname|IP/i.test(reason)) {
		return "The server's certificate is for a different name.";
	}
	return "The server's certificate could not be verified.";
}

function confirmCertificate(request: CertificateRequest): Promise<boolean> {
	const address = formatAddress(request.host, request.port);
	const description = $("cert-description");
	description.replaceChildren();
	const lines = request.previousFingerprint
		? [
				`Warning: the certificate for ${address} has changed since you last trusted it.`,
				"This can happen when a server is reinstalled, but it can also mean someone is intercepting the connection. Only continue if you know why it changed.",
			]
		: [
				`${describeCertificateProblem(request.reason)}`,
				`Only trust ${address} if you know who runs it. If they can, ask them to confirm the fingerprint below.`,
			];
	for (const line of lines) {
		const paragraph = document.createElement("p");
		paragraph.textContent = line;
		description.append(paragraph);
	}
	$("cert-title").textContent = request.previousFingerprint ? "Server certificate changed" : `Trust ${address}?`;
	$("cert-fingerprint").textContent = formatFingerprint(request.fingerprint);
	if (settings.current.cueSounds) {
		void audio.playWave("error");
	}
	return new Promise((resolve) => {
		const trust = $<HTMLButtonElement>("cert-trust");
		const cancel = $<HTMLButtonElement>("cert-cancel");
		const finish = (result: boolean) => {
			trust.removeEventListener("click", onTrust);
			cancel.removeEventListener("click", onCancel);
			certDialog.removeEventListener("close", onClose);
			if (certDialog.open) {
				certDialog.close();
			}
			resolve(result);
		};
		const onTrust = () => finish(true);
		const onCancel = () => finish(false);
		const onClose = () => finish(false);
		trust.addEventListener("click", onTrust);
		cancel.addEventListener("click", onCancel);
		certDialog.addEventListener("close", onClose);
		certDialog.showModal();
		cancel.focus();
	});
}

// ---------------------------------------------------------------- Settings form

const voiceSelect = $<HTMLSelectElement>("voice-select");

function populateVoices(): void {
	if (!voice) {
		voiceSelect.replaceChildren(new Option("Not available in this browser", ""));
		voiceSelect.disabled = true;
		return;
	}
	const voices = speechSynthesis.getVoices();
	const options = [new Option("Browser default", "")];
	const pageLanguage = (navigator.language || "en").split("-")[0]!.toLowerCase();
	const sorted = [...voices].sort((a, b) => {
		const aLocal = a.lang.toLowerCase().startsWith(pageLanguage) ? 0 : 1;
		const bLocal = b.lang.toLowerCase().startsWith(pageLanguage) ? 0 : 1;
		return aLocal - bLocal || a.name.localeCompare(b.name);
	});
	for (const v of sorted) {
		options.push(new Option(`${v.name} (${v.lang})${v.localService ? "" : ", online"}`, v.voiceURI));
	}
	voiceSelect.replaceChildren(...options);
	voiceSelect.value = settings.current.voiceURI;
}

if (voice) {
	speechSynthesis.addEventListener("voiceschanged", populateVoices);
}

const exitKeySelect = $<HTMLSelectElement>("exit-key");
exitKeySelect.replaceChildren(
	...Object.entries(EXIT_KEY_LABELS).map(([value, label]) => new Option(label, value)),
);

function renderTrustedList(): void {
	const list = $("trusted-list");
	const entries = Object.entries(trustedFingerprints());
	$("trusted-empty").hidden = entries.length > 0;
	list.replaceChildren(
		...entries.map(([address, fingerprint]) => {
			const item = document.createElement("li");
			const text = document.createElement("span");
			text.textContent = `${address} `;
			const forget = document.createElement("button");
			forget.type = "button";
			forget.className = "secondary small";
			forget.textContent = `Forget ${address}`;
			forget.title = formatFingerprint(fingerprint);
			forget.addEventListener("click", () => {
				forgetFingerprint(address);
				renderTrustedList();
				announcer.say(`Forgot the certificate for ${address}.`);
				$("trusted-heading").focus();
			});
			item.append(text, forget);
			return item;
		}),
	);
}
$("trusted-heading").tabIndex = -1;

function renderSettings(current: Settings): void {
	for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="speechMode"]')) {
		radio.checked = radio.value === current.speechMode;
	}
	($<HTMLFieldSetElement>("voice-settings")).disabled = !voice || current.speechMode !== "voice";
	voiceSelect.value = current.voiceURI;
	($<HTMLInputElement>("rate")).value = String(current.rate);
	($<HTMLInputElement>("pitch")).value = String(current.pitch);
	($<HTMLInputElement>("volume")).value = String(current.volume);
	($<HTMLInputElement>("sounds-enabled")).checked = current.soundsEnabled;
	($<HTMLInputElement>("cue-sounds")).checked = current.cueSounds;
	($<HTMLInputElement>("sound-volume")).value = String(current.soundVolume);
	($<HTMLInputElement>("speak-app-messages")).checked = current.speakAppMessages;
	($<HTMLSelectElement>("meta-key")).value = current.metaKey;
	($<HTMLInputElement>("top-row")).checked = current.topRowAsFunctionKeys;
	exitKeySelect.value = current.exitKey;
	($<HTMLInputElement>("fullscreen")).checked = current.fullscreenWhileControlling;
	($<HTMLInputElement>("braille-enabled")).checked = current.brailleEnabled;
	($<HTMLInputElement>("braille-cells")).value = String(current.brailleCells);
	($<HTMLInputElement>("braille-cells")).disabled = !current.brailleEnabled;
	($<HTMLInputElement>("auto-reconnect")).checked = current.autoReconnect;
	brailleSection.hidden = !current.brailleEnabled;
	audio.volume = current.soundVolume;
	connection.autoReconnect = current.autoReconnect;
	updateControlHints();
}

settings.subscribe((current) => renderSettings(current));

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="speechMode"]')) {
	radio.addEventListener("change", () => {
		speechOutput().cancel();
		settings.update({ speechMode: radio.value as SpeechMode });
	});
}

const bindRange = (id: string, field: "rate" | "pitch" | "volume" | "soundVolume") => {
	$<HTMLInputElement>(id).addEventListener("change", (event) => {
		settings.update({ [field]: Number((event.target as HTMLInputElement).value) });
	});
};
bindRange("rate", "rate");
bindRange("pitch", "pitch");
bindRange("volume", "volume");
bindRange("sound-volume", "soundVolume");

const bindCheckbox = (
	id: string,
	field: "soundsEnabled" | "cueSounds" | "speakAppMessages" | "topRowAsFunctionKeys" | "fullscreenWhileControlling" | "autoReconnect",
) => {
	$<HTMLInputElement>(id).addEventListener("change", (event) => {
		settings.update({ [field]: (event.target as HTMLInputElement).checked });
	});
};
bindCheckbox("sounds-enabled", "soundsEnabled");
bindCheckbox("cue-sounds", "cueSounds");
bindCheckbox("speak-app-messages", "speakAppMessages");
bindCheckbox("top-row", "topRowAsFunctionKeys");
bindCheckbox("fullscreen", "fullscreenWhileControlling");
bindCheckbox("auto-reconnect", "autoReconnect");

voiceSelect.addEventListener("change", () => settings.update({ voiceURI: voiceSelect.value }));
$<HTMLSelectElement>("meta-key").addEventListener("change", (event) => {
	settings.update({ metaKey: (event.target as HTMLSelectElement).value as Settings["metaKey"] });
});
exitKeySelect.addEventListener("change", () => settings.update({ exitKey: exitKeySelect.value as ExitKey }));

$<HTMLInputElement>("braille-enabled").addEventListener("change", (event) => {
	settings.update({ brailleEnabled: (event.target as HTMLInputElement).checked });
	if (!settings.current.brailleEnabled) {
		brailleLine.textContent = "";
	}
	sendBrailleInfo();
});
$<HTMLInputElement>("braille-cells").addEventListener("change", (event) => {
	const value = Math.round(Number((event.target as HTMLInputElement).value));
	if (Number.isFinite(value) && value >= 1 && value <= 160) {
		settings.update({ brailleCells: value });
		sendBrailleInfo();
	}
});

$("test-voice").addEventListener("click", () => {
	unlockAudio();
	voice?.cancel();
	voice?.speakText("This is how the remote computer will sound.");
});

$("reset-settings").addEventListener("click", () => {
	settings.reset();
	announcer.say("Settings reset.");
});

// ---------------------------------------------------------------- Start up

loadInitialDetails();
populateVoices();
renderSettings(settings.current);
renderTrustedList();
window.addEventListener("beforeunload", () => {
	control.releaseAll();
});
