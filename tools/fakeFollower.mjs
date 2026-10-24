// A stand-in for a controlled NVDA computer, for testing the web client without Windows.
// It joins a channel as the "slave" side, announces every key it receives as speech,
// and sends sample tones, sounds, braille and clipboard text when certain keys are pressed.
//
// Usage: node tools/fakeFollower.mjs <host> <port> <key> [--insecure]

import tls from "node:tls";

const [host = "mad-gamer.com", port = "6837", key = "test123", flag] = process.argv.slice(2);

const VK_NAMES = {
	8: "backspace", 9: "tab", 13: "enter", 16: "shift", 17: "control", 18: "alt", 20: "caps lock",
	27: "escape", 32: "space", 33: "page up", 34: "page down", 35: "end", 36: "home",
	37: "left arrow", 38: "up arrow", 39: "right arrow", 40: "down arrow", 45: "insert", 46: "delete",
	91: "windows", 92: "right windows", 93: "applications", 144: "num lock",
	160: "left shift", 161: "right shift", 162: "left control", 163: "right control", 164: "left alt", 165: "right alt",
};
const vkName = (vk) =>
	VK_NAMES[vk] ??
	(vk >= 0x30 && vk <= 0x5a ? String.fromCharCode(vk).toLowerCase() : vk >= 0x70 && vk <= 0x87 ? `f${vk - 0x6f}` : `key ${vk}`);

const socket = tls.connect({ host, port: Number(port), servername: host, rejectUnauthorized: flag !== "--insecure" });
const send = (msg) => socket.write(JSON.stringify(msg) + "\n");
const speak = (...sequence) => send({ type: "speak", sequence, priority: 0 });

socket.on("secureConnect", () => {
	send({ type: "protocol_version", version: 2 });
	send({ type: "join", channel: key, connection_type: "slave" });
	console.log(`joined ${host}:${port} channel ${key} as follower`);
});

let buffer = "";
let brailleCells = 0;
socket.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let newline;
	while ((newline = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		const msg = JSON.parse(line);
		if (msg.type !== "ping") console.log("<-", line);
		handle(msg);
	}
});

function handle(msg) {
	switch (msg.type) {
		case "client_joined":
			speak("Controller connected");
			break;
		case "set_braille_info":
			brailleCells = msg.numCells ?? 0;
			break;
		case "set_clipboard_text":
			speak(`Clipboard received: ${msg.text}`);
			break;
		case "send_SAS":
			speak("Secure attention sequence received");
			break;
		case "key": {
			if (!msg.pressed) return;
			const name = vkName(msg.vk_code) + (msg.extended ? " extended" : "");
			send({ type: "cancel" });
			if (msg.vk_code === 0x70) {
				// F1: sample of speech commands
				speak(["LangChangeCommand", { lang: "fr_FR", isDefault: false }], "Bonjour", ["LangChangeCommand", { lang: null, isDefault: true }], ["BreakCommand", { time: 300 }], ["CharacterModeCommand", { state: true, isDefault: false }], "NVDA", ["CharacterModeCommand", { state: false, isDefault: true }], ["EndUtteranceCommand", {}]);
			} else if (msg.vk_code === 0x71) {
				send({ type: "tone", hz: 440, length: 100, left: 50, right: 50 });
				send({ type: "wave", fileName: "C:\\Program Files\\NVDA\\waves\\browseMode.wav" });
				speak("Tone and sound sent");
			} else if (msg.vk_code === 0x72) {
				send({ type: "set_clipboard_text", text: "Text from the remote computer" });
			} else if (msg.vk_code === 0x73 && brailleCells > 0) {
				// F4: braille "hello" in cells (dots as bits)
				send({ type: "display", cells: [0x13, 0x11, 0x07, 0x07, 0x15] });
				speak("Braille sent");
			} else {
				speak(name);
			}
			break;
		}
	}
}
socket.on("error", (e) => console.error("error:", e.message));
socket.on("close", () => {
	console.log("closed");
	process.exit(0);
});
