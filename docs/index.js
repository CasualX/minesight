const decoder = new TextDecoder();
const encoder = new TextEncoder();

let wasm;
let latestState = null;
let latestError = "";

function publishState(state) {
	latestState = state;
	window.dispatchEvent(new CustomEvent("minetacs:state", { detail: state }));
}

function publishError(message) {
	latestError = message;
	window.dispatchEvent(new CustomEvent("minetacs:error", { detail: message }));
}

function readWasmString(pointer, length) {
	return decoder.decode(new Uint8Array(wasm.memory.buffer, pointer, length));
}

async function instantiateWasm() {
	const imports = {
		env: {
			resultJson(pointer, length) {
				try {
					publishState(JSON.parse(readWasmString(pointer, length)));
				} catch (error) {
					publishError(`Could not read game state: ${error.message}`);
				}
			},
			resultError(pointer, length) {
				publishError(readWasmString(pointer, length));
			},
		},
	};

	const response = await fetch("./minetacs.wasm");
	if (!response.ok) throw new Error(`WASM request failed (${response.status})`);
	let instance;
	try {
		({ instance } = await WebAssembly.instantiateStreaming(response.clone(), imports));
	} catch {
		({ instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports));
	}
	wasm = instance.exports;

	const entropy = new Uint32Array(2);
	crypto.getRandomValues(entropy);
	wasm.minetacs_init(entropy[0], entropy[1]);
}

function withString(value, callback) {
	const bytes = encoder.encode(value);
	const pointer = bytes.length ? wasm.minetacs_alloc(bytes.length) : 0;
	if (bytes.length) new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
	try {
		callback(pointer, bytes.length);
	} finally {
		if (bytes.length) wasm.minetacs_dealloc(pointer, bytes.length);
	}
}

const bridge = {
	get state() {
		return latestState;
	},
	get error() {
		return latestError;
	},
	setMode(mode) {
		wasm.minetacs_set_mode(mode === "challenge" ? 1 : 0);
	},
	configurePractice(category) {
		const categories = latestState.categories.map((option) => option.id);
		wasm.minetacs_configure_practice(Math.max(0, categories.indexOf(category)));
	},
	newPractice() {
		wasm.minetacs_new_practice();
	},
	startChallenge(seed) {
		withString(seed, (pointer, length) => wasm.minetacs_start_challenge(pointer, length));
	},
	startRandomChallenge() {
		const entropy = new Uint32Array(2);
		crypto.getRandomValues(entropy);
		wasm.minetacs_start_random_challenge(entropy[0], entropy[1]);
	},
	challengeHome() {
		wasm.minetacs_challenge_home();
	},
	action(index, action) {
		wasm.minetacs_action(index, action === "mark" ? 1 : 0);
	},
	hint() {
		wasm.minetacs_hint();
	},
	explain() {
		wasm.minetacs_explain();
	},
	reset() {
		wasm.minetacs_reset();
	},
	next() {
		wasm.minetacs_next();
	},
	replayChallenge() {
		wasm.minetacs_replay_challenge();
	},
};

document.addEventListener("alpine:init", () => {
	window.Alpine.data("minetacs", () => ({
		state: bridge.state,
		engineError: bridge.error,
		seedInput: new URLSearchParams(location.search).get("challenge") ?? "",
		showHelp: false,
		elapsed: 0,
		startedAt: null,
		finalElapsed: null,
		pressTimer: null,
		longPressed: false,

		init() {
			window.addEventListener("minetacs:state", ({ detail }) => this.receive(detail));
			window.addEventListener("minetacs:error", ({ detail }) => (this.engineError = detail));
			if (this.state?.screen === "challenge") this.startedAt = performance.now();
			this.clock = window.setInterval(() => {
				if (this.startedAt !== null && this.finalElapsed === null) {
					this.elapsed = performance.now() - this.startedAt;
				}
			}, 100);
		},

		receive(nextState) {
			const previousScreen = this.state?.screen;
			this.state = nextState;
			if (nextState.screen === "challenge" && previousScreen !== "challenge") {
				this.startedAt = performance.now();
				this.finalElapsed = null;
				this.elapsed = 0;
			}
			if (nextState.screen === "results" && this.finalElapsed === null) {
				this.finalElapsed = this.elapsed;
			}
			if (nextState.challenge?.seed && nextState.screen !== "results") {
				this.seedInput = nextState.challenge.seed;
			}
		},

		get puzzle() {
			return this.state?.puzzle ?? null;
		},

		setMode(mode) {
			if (mode === "practice") history.replaceState({}, "", location.pathname);
			bridge.setMode(mode);
		},

		configurePractice(category) {
			bridge.configurePractice(category);
		},

		newPractice() {
			bridge.newPractice();
		},

		hint() {
			bridge.hint();
		},

		explain() {
			bridge.explain();
		},

		reset() {
			bridge.reset();
		},

		nextPuzzle() {
			bridge.next();
		},

		replayChallenge() {
			bridge.replayChallenge();
		},

		startChallenge(seed = "") {
			const cleaned = seed.trim();
			if (cleaned) bridge.startChallenge(cleaned);
			else bridge.startRandomChallenge();
			queueMicrotask(() => {
				if (bridge.state?.challenge?.seed) {
					const url = new URL(location.href);
					url.searchParams.set("challenge", bridge.state.challenge.seed);
					history.replaceState({}, "", url);
				}
			});
		},

		challengeHome() {
			history.replaceState({}, "", location.pathname);
			this.seedInput = "";
			bridge.challengeHome();
		},

		pressStart(cell) {
			if (this.cellDisabled(cell)) return;
			this.longPressed = false;
			clearTimeout(this.pressTimer);
			this.pressTimer = setTimeout(() => {
				this.longPressed = true;
				bridge.action(cell.index, "mark");
			}, 520);
		},

		pressEnd() {
			clearTimeout(this.pressTimer);
			this.pressTimer = null;
		},

		reveal(cell) {
			if (this.longPressed) {
				this.longPressed = false;
				return;
			}
			if (!this.cellDisabled(cell)) bridge.action(cell.index, "reveal");
		},

		mark(cell) {
			this.pressEnd();
			if (!this.cellDisabled(cell)) bridge.action(cell.index, "mark");
		},

		cellDisabled(cell) {
			return this.puzzle?.status !== "playing" || cell.state !== "hidden" || !cell.frontier;
		},

		cellText(cell) {
			if (cell.state === "flagged") return "◆";
			if (cell.state === "mine") return "✕";
			if (cell.state === "incorrect") return "!";
			return cell.number || "";
		},

		cellClasses(cell) {
			return [
				`cell--${cell.state}`,
				cell.number ? `number-${cell.number}` : "",
				!cell.frontier && cell.state === "hidden" ? "cell--outside" : "",
				cell.relevantClue ? "cell--clue" : "",
				cell.related ? "cell--related" : "",
				cell.forcedSafe ? "cell--safe" : "",
				cell.forcedMine ? "cell--forced-mine" : "",
				cell.cascade ? "cell--cascade" : "",
			];
		},

		formatTime(milliseconds = this.elapsed) {
			const totalTenths = Math.max(0, Math.floor(milliseconds / 100));
			const minutes = Math.floor(totalTenths / 600);
			const seconds = Math.floor((totalTenths % 600) / 10);
			const tenths = totalTenths % 10;
			return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
		},

		async copySeed() {
			await navigator.clipboard.writeText(this.state.challenge.seed);
			this.engineError = "Seed copied.";
		},

		async copyResult() {
			const challenge = this.state.challenge;
			const score = challenge.perfect ? "Perfect Run" : `${challenge.solved}/${challenge.total}`;
			await navigator.clipboard.writeText(
				`Minetacs — ${score} — ${this.formatTime(this.finalElapsed)} — Seed ${challenge.seed}`,
			);
			this.engineError = "Result copied.";
		},
	}));
});

try {
	await instantiateWasm();
	const sharedSeed = new URLSearchParams(location.search).get("challenge");
	if (sharedSeed) bridge.startChallenge(sharedSeed);
} catch (error) {
	publishError(`Could not start Minetacs: ${error.message}`);
}

await import("./alpine.min.js");
