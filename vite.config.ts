import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(__dirname, "src/web");

export default defineConfig({
	root,
	publicDir: resolve(root, "public"),
	build: {
		outDir: resolve(__dirname, "dist/web"),
		emptyOutDir: true,
		target: "es2022",
		rollupOptions: {
			input: {
				index: resolve(root, "index.html"),
				help: resolve(root, "help.html"),
				keytest: resolve(root, "keytest.html"),
				privacy: resolve(root, "privacy.html"),
			},
		},
	},
	server: {
		proxy: {
			"/ws": { target: process.env.NVR_GATEWAY_URL ?? "ws://127.0.0.1:39870", ws: true },
		},
	},
	preview: {
		proxy: {
			"/ws": { target: process.env.NVR_GATEWAY_URL ?? "ws://127.0.0.1:39870", ws: true },
		},
	},
	test: {
		root: __dirname,
		include: ["tests/**/*.test.ts"],
	},
});
