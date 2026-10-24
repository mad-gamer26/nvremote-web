// Braille cells from the remote computer, shown as Unicode braille patterns.
// Each cell is a number whose bits are dots 1 to 8, which matches the Unicode braille block.

export function cellsToUnicode(cells: unknown): string {
	if (!Array.isArray(cells)) {
		return "";
	}
	return cells
		.map((cell) => (typeof cell === "number" && cell >= 0 && cell <= 255 ? String.fromCharCode(0x2800 + cell) : ""))
		.join("")
		.replace(/⠀+$/, "");
}
