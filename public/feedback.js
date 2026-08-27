// @ts-check

const SUCCESS_COLORS = ['#55713d', '#88a867', '#dfd39f', '#f7f2d4', '#111111'];
const FAILURE_COLORS = ['#8f302b', '#c77e78', '#e2aaa5', '#4c2522', '#111111'];
const FIREWORK_COLORS = ['#e6b84a', '#df6b57', '#70a6d8', '#88a867', '#d78ab3', '#f7f2d4'];

/** @returns {{ x: number, y: number }} */
function elementCenter(element) {
	if (!(element instanceof Element)) {
		return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
	}
	let bounds = element.getBoundingClientRect();
	return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

/** @param {number} cellIndex */
function effectOrigin(cellIndex = -1) {
	if (cellIndex >= 0) {
		let cell = document.querySelector(`.board-card .cell[data-cell-index="${cellIndex}"]`);
		if (cell) return elementCenter(cell);
	}
	return elementCenter(document.querySelector('.board-card .minefield'));
}

function feedbackLayer() {
	let layer = document.querySelector('.feedback-layer');
	if (layer instanceof HTMLElement) return layer;
	layer = document.createElement('div');
	layer.className = 'feedback-layer';
	layer.setAttribute('aria-hidden', 'true');
	document.body.append(layer);
	return layer;
}

/** @param {HTMLElement} sequence @param {string} className */
function addElement(sequence, className) {
	let element = document.createElement('span');
	element.className = className;
	sequence.append(element);
	return element;
}

/**
 * Large, pointer-transparent feedback effects for game outcomes.
 * All generated DOM lives under `.feedback-layer` and removes itself.
 */
class FeedbackEffects {
	constructor() {
		this.runId = 0;
	}

	/** @param {number} streak */
	streakLost(streak) {
		let counter = document.querySelector('.study-streak > strong');
		if (!(counter instanceof HTMLElement)) return;

		let bounds = counter.getBoundingClientRect();
		let styles = window.getComputedStyle(counter);
		let fallingNumber = document.createElement('span');
		fallingNumber.className = 'feedback-streak-drop';
		fallingNumber.textContent = String(streak);
		fallingNumber.style.left = `${bounds.left}px`;
		fallingNumber.style.top = `${bounds.top}px`;
		fallingNumber.style.width = `${bounds.width}px`;
		fallingNumber.style.height = `${bounds.height}px`;
		fallingNumber.style.color = styles.color;
		fallingNumber.style.font = styles.font;
		fallingNumber.style.fontSize = `${Number.parseFloat(styles.fontSize) * 1.35}px`;
		let fallDistance = window.innerHeight - bounds.top + bounds.height;
		let driftDirection = Math.random() < .5 ? -1 : 1;
		let drift = driftDirection * (35 + Math.random() * 30);
		fallingNumber.style.setProperty('--streak-fall-distance', `${fallDistance}px`);
		fallingNumber.style.setProperty('--streak-pop-drift', `${driftDirection * 4}px`);
		fallingNumber.style.setProperty('--streak-drift', `${drift}px`);
		let spinDirection = Math.random() < .5 ? -1 : 1;
		let spin = spinDirection * (150 + Math.random() * 100);
		fallingNumber.style.setProperty('--streak-pop-spin', `${spinDirection * -12}deg`);
		fallingNumber.style.setProperty('--streak-spin', `${spin}deg`);
		feedbackLayer().append(fallingNumber);
		window.setTimeout(() => fallingNumber.remove(), 1400);
	}

	/** @param {{ grand?: boolean }} [options] */
	success({ grand = false } = {}) {
		let origin = effectOrigin();
		let sequence = this.createSequence('success', origin, grand ? 2300 : 1800);
		if (grand) sequence.classList.add('is-grand');

		addElement(sequence, 'feedback-veil');
		addElement(sequence, 'feedback-rays');
		addElement(sequence, 'feedback-ring feedback-ring-one');
		addElement(sequence, 'feedback-ring feedback-ring-two');
		addElement(sequence, 'feedback-core');
		this.addParticles(sequence, grand ? 72 : 48, SUCCESS_COLORS, false);
	}

	fireworks() {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		let sequence = this.createSequence('fireworks', { x: 0, y: 0 }, 4300);
		let positions = [
			{ x: .17, y: .28, delay: 560 },
			{ x: .78, y: .22, delay: 900 },
			{ x: .48, y: .14, delay: 1260 },
			{ x: .28, y: .48, delay: 1660 },
			{ x: .72, y: .46, delay: 2020 },
		];
		let sparkDistance = Math.min(150, Math.max(90, Math.min(window.innerWidth, window.innerHeight) * .16));

		for (let [burstIndex, position] of positions.entries()) {
			let x = window.innerWidth * position.x;
			let y = window.innerHeight * position.y;
			let primaryColor = FIREWORK_COLORS[burstIndex % FIREWORK_COLORS.length];
			let secondaryColor = FIREWORK_COLORS[(burstIndex + 2) % FIREWORK_COLORS.length];
			let launch = addElement(sequence, 'feedback-firework-launch');
			launch.style.left = `${x}px`;
			launch.style.top = `${y}px`;
			launch.style.setProperty('--launch-distance', `${window.innerHeight - y + 20}px`);
			launch.style.setProperty('--launch-delay', `${Math.max(0, position.delay - 520)}ms`);
			launch.style.setProperty('--firework-color', primaryColor);

			let burst = addElement(sequence, 'feedback-firework-burst');
			burst.style.left = `${x}px`;
			burst.style.top = `${y}px`;
			burst.style.setProperty('--burst-delay', `${position.delay}ms`);
			burst.style.setProperty('--firework-color', primaryColor);
			addElement(burst, 'feedback-firework-flash');
			addElement(burst, 'feedback-firework-ring');

			let sparkCount = 28;
			for (let index = 0; index < sparkCount; index += 1) {
				let spark = addElement(burst, 'feedback-firework-spark');
				let angle = index / sparkCount * Math.PI * 2 + (Math.random() - .5) * .09;
				let distance = sparkDistance * (.68 + Math.random() * .36);
				let color = index % 3 === 0 ? secondaryColor : primaryColor;
				spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
				spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance + distance * .2}px`);
				spark.style.setProperty('--spark-angle', `${angle}rad`);
				spark.style.setProperty('--spark-delay', `${position.delay + Math.random() * 75}ms`);
				spark.style.setProperty('--spark-duration', `${920 + Math.random() * 420}ms`);
				spark.style.setProperty('--firework-color', color);
				if (index % 4 === 0) spark.classList.add('is-glitter');
			}
		}
	}

	/** @param {{ cellIndex: number, mine: boolean }} options */
	mark({ cellIndex, mine }) {
		let origin = effectOrigin(cellIndex);
		let sequence = this.createSequence('mark', origin, 720);
		if (mine) sequence.classList.add('is-mine');

		addElement(sequence, 'feedback-mark-ring');
		for (let index = 0; index < 8; index += 1) {
			let spark = addElement(sequence, 'feedback-mark-spark');
			spark.style.setProperty('--spark-angle', `${index * 45 + (Math.random() - .5) * 12}deg`);
			spark.style.setProperty('--spark-distance', `${22 + Math.random() * 9}px`);
			spark.style.setProperty('--spark-delay', `${Math.random() * 55}ms`);
		}
	}

	/** @param {{ cellIndex?: number, terminal?: boolean }} [options] */
	failure({ cellIndex = -1, terminal = false } = {}) {
		let origin = effectOrigin(cellIndex);
		let sequence = this.createSequence('failure', origin, terminal ? 1500 : 1150);
		if (terminal) sequence.classList.add('is-terminal');

		addElement(sequence, 'feedback-veil');
		addElement(sequence, 'feedback-impact');
		addElement(sequence, 'feedback-ring feedback-ring-one');
		addElement(sequence, 'feedback-ring feedback-ring-two');
		this.addCracks(sequence, terminal ? 10 : 7);
		this.addParticles(sequence, terminal ? 42 : 28, FAILURE_COLORS, true);
		this.animateBoard('failure', terminal ? 760 : 560);
	}

	/** @param {'success' | 'failure' | 'mark'} kind @param {{ x: number, y: number }} origin @param {number} lifetime */
	createSequence(kind, origin, lifetime) {
		let sequence = document.createElement('div');
		sequence.className = `feedback-sequence feedback-${kind}`;
		sequence.style.setProperty('--origin-x', `${origin.x}px`);
		sequence.style.setProperty('--origin-y', `${origin.y}px`);
		feedbackLayer().append(sequence);
		window.setTimeout(() => sequence.remove(), lifetime);
		return sequence;
	}

	/** @param {HTMLElement} sequence @param {number} count @param {string[]} colors @param {boolean} falling */
	addParticles(sequence, count, colors, falling) {
		let viewportDistance = Math.hypot(window.innerWidth, window.innerHeight);
		for (let index = 0; index < count; index += 1) {
			let particle = addElement(sequence, 'feedback-particle');
			let angle = (index / count) * Math.PI * 2 + (Math.random() - .5) * .28;
			let distance = falling
				? 90 + Math.random() * Math.min(260, viewportDistance * .34)
				: viewportDistance * (.18 + Math.random() * .48);
			let x = Math.cos(angle) * distance;
			let y = Math.sin(angle) * distance + (falling ? 70 + Math.random() * 120 : 0);
			let size = falling ? 5 + Math.random() * 9 : 4 + Math.random() * 8;

			particle.classList.add(falling ? 'is-shard' : index % 4 === 0 ? 'is-dot' : 'is-confetti');
			particle.style.setProperty('--particle-color', colors[index % colors.length]);
			particle.style.setProperty('--travel-x', `${x}px`);
			particle.style.setProperty('--travel-y', `${y}px`);
			particle.style.setProperty('--particle-spin', `${(Math.random() - .5) * 1080}deg`);
			particle.style.setProperty('--particle-delay', `${Math.random() * 150}ms`);
			particle.style.setProperty('--particle-time', `${falling ? 680 + Math.random() * 380 : 900 + Math.random() * 550}ms`);
			particle.style.width = `${size}px`;
			particle.style.height = `${falling ? size * 1.65 : index % 3 === 0 ? size * 2.2 : size}px`;
		}
	}

	/** @param {HTMLElement} sequence @param {number} count */
	addCracks(sequence, count) {
		for (let index = 0; index < count; index += 1) {
			let crack = addElement(sequence, 'feedback-crack');
			crack.style.setProperty('--crack-angle', `${(360 / count) * index + (Math.random() - .5) * 18}deg`);
			crack.style.setProperty('--crack-length', `${55 + Math.random() * 110}px`);
			crack.style.setProperty('--crack-delay', `${Math.random() * 90}ms`);
		}
	}

	/** @param {'success' | 'failure'} kind @param {number} lifetime */
	animateBoard(kind, lifetime) {
		let board = document.querySelector('.board-wrap');
		if (!(board instanceof HTMLElement)) return;
		let runId = String(++this.runId);
		let className = `feedback-board-${kind}`;
		board.dataset.feedbackRun = runId;
		board.classList.remove('feedback-board-success', 'feedback-board-failure');
		void board.offsetWidth;
		board.classList.add(className);
		window.setTimeout(() => {
			if (board.dataset.feedbackRun === runId) board.classList.remove(className);
		}, lifetime);
	}
}

export const feedbackEffects = new FeedbackEffects();
