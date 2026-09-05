<script>
const SCRATCH_PAD_TAP_DISTANCE = .01;
const SCRATCH_PAD_ERASER_RADIUS = .025;
const SCRATCH_PAD_MARK_SIZE = .04125;
const SCRATCH_PAD_MARK_ANIMATION_MS = 220;
const SCRATCH_PAD_POINT_DISTANCE = .0015;

/** @typedef {{ x: number, y: number }} ScratchPadPoint */
/** @typedef {{ color: string, points: ScratchPadPoint[], drawProgress?: number }} ScratchPadStroke */

function scratchPadPointSegmentDistance(point, start, end) {
	let dx = end.x - start.x;
	let dy = end.y - start.y;
	let lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

	let progress = Math.max(0, Math.min(1,
		((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
	));
	return Math.hypot(
		point.x - (start.x + dx * progress),
		point.y - (start.y + dy * progress),
	);
}

function scratchPadSegmentDistance(firstStart, firstEnd, secondStart, secondEnd) {
	let cross = (start, end, point) =>
		(end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
	let boundsOverlap = Math.max(firstStart.x, firstEnd.x) >= Math.min(secondStart.x, secondEnd.x)
		&& Math.max(secondStart.x, secondEnd.x) >= Math.min(firstStart.x, firstEnd.x)
		&& Math.max(firstStart.y, firstEnd.y) >= Math.min(secondStart.y, secondEnd.y)
		&& Math.max(secondStart.y, secondEnd.y) >= Math.min(firstStart.y, firstEnd.y);
	let intersects = boundsOverlap
		&& cross(firstStart, firstEnd, secondStart) * cross(firstStart, firstEnd, secondEnd) <= 0
		&& cross(secondStart, secondEnd, firstStart) * cross(secondStart, secondEnd, firstEnd) <= 0;
	if (intersects) return 0;

	return Math.min(
		scratchPadPointSegmentDistance(firstStart, secondStart, secondEnd),
		scratchPadPointSegmentDistance(firstEnd, secondStart, secondEnd),
		scratchPadPointSegmentDistance(secondStart, firstStart, firstEnd),
		scratchPadPointSegmentDistance(secondEnd, firstStart, firstEnd),
	);
}

const ScratchPad = Vue.defineComponent({
	template: '#scratch-pad',
	expose: ['clear', 'reset', 'resize'],
	props: {
		active: Boolean,
		tool: {
			type: String,
			default: 'pencil',
			validator: (value) => value === 'pencil' || value === 'eraser',
		},
		color: {
			type: String,
			default: 'graphite',
		},
		colors: {
			type: Array,
			default: () => ['graphite', 'blue', 'red'],
			validator: (colors) => colors.length > 0 && colors.every((color) => typeof color === 'string'),
		},
		invertMarks: Boolean,
	},
	emits: ['change', 'update:color', 'update:tool'],
	data() {
		return {
			strokes: /** @type {ScratchPadStroke[]} */ ([]),
			currentStroke: /** @type {ScratchPadStroke | undefined} */ (undefined),
			eraserPoint: /** @type {ScratchPadPoint | undefined} */ (undefined),
			resizeObserver: /** @type {ResizeObserver | undefined} */ (undefined),
			animationFrames: new Set(),
		};
	},
	watch: {
		active(active) {
			if (active) {
				this.$nextTick(() => this.resize());
				return;
			}
			this.finishInteraction();
		},
		tool() {
			this.finishInteraction();
		},
		color() {
			this.render();
		},
	},
	mounted() {
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.$el.parentElement ?? this.$el);
		this.resize();
	},
	beforeUnmount() {
		this.resizeObserver?.disconnect();
		for (let frame of this.animationFrames) cancelAnimationFrame(frame);
		this.animationFrames.clear();
	},
	methods: {
		finishInteraction() {
			this.currentStroke = undefined;
			this.eraserPoint = undefined;
		},
		notifyChange() {
			this.$emit('change', { strokeCount: this.strokes.length });
		},
		resize() {
			let canvas = this.$el;
			if (!(canvas instanceof HTMLCanvasElement)) return;

			let rect = canvas.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			let scale = Math.min(window.devicePixelRatio || 1, 3);
			let width = Math.round(rect.width * scale);
			let height = Math.round(rect.height * scale);
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
			this.render();
		},
		render() {
			let canvas = this.$el;
			if (!(canvas instanceof HTMLCanvasElement)) return;
			let context = canvas.getContext('2d');
			let rect = canvas.getBoundingClientRect();
			if (!context || rect.width <= 0 || rect.height <= 0) return;

			let styles = getComputedStyle(canvas);
			let colors = Object.fromEntries(this.colors.map((color) => [
				color,
				styles.getPropertyValue(`--scratch-${color}`).trim(),
			]));
			let fallbackColor = colors.graphite || '#282b2a';
			let scale = canvas.width / rect.width;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.setTransform(scale, 0, 0, scale, 0, 0);
			context.lineCap = 'round';
			context.lineJoin = 'round';
			context.lineWidth = 2.4;

			for (let stroke of this.strokes) {
				let first = stroke.points[0];
				if (!first) continue;
				let progress = Math.max(0, Math.min(1, stroke.drawProgress ?? 1));
				if (progress === 0) continue;

				context.beginPath();
				context.strokeStyle = colors[stroke.color] || fallbackColor;
				context.moveTo(first.x * rect.width, first.y * rect.height);
				let segments = stroke.points.slice(1).map((point, index) => {
					let previous = stroke.points[index];
					return {
						point,
						previous,
						length: Math.hypot(
							(point.x - previous.x) * rect.width,
							(point.y - previous.y) * rect.height,
						),
					};
				});
				let remaining = segments.reduce((total, segment) => total + segment.length, 0) * progress;
				for (let segment of segments) {
					if (remaining >= segment.length) {
						context.lineTo(segment.point.x * rect.width, segment.point.y * rect.height);
						remaining -= segment.length;
						continue;
					}
					let amount = segment.length === 0 ? 1 : remaining / segment.length;
					context.lineTo(
						(segment.previous.x + (segment.point.x - segment.previous.x) * amount) * rect.width,
						(segment.previous.y + (segment.point.y - segment.previous.y) * amount) * rect.height,
					);
					break;
				}
				if (stroke.points.length === 1) {
					context.lineTo(first.x * rect.width + .01, first.y * rect.height + .01);
				}
				context.stroke();
			}
		},
		pointFromEvent(event) {
			let rect = event.currentTarget.getBoundingClientRect();
			return {
				x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
				y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
			};
		},
		isTap(stroke, endPoint) {
			let first = stroke.points[0];
			if (!first) return false;
			return [...stroke.points, ...(endPoint ? [endPoint] : [])]
				.every((point) => Math.hypot(point.x - first.x, point.y - first.y) < SCRATCH_PAD_TAP_DISTANCE);
		},
		removeStroke(stroke) {
			let index = this.strokes.indexOf(stroke);
			if (index >= 0) this.strokes.splice(index, 1);
		},
		eraseStrokes(start, end) {
			let previousCount = this.strokes.length;
			this.strokes = this.strokes.filter((stroke) => {
				if (stroke === this.currentStroke || stroke.points.length === 0) return true;
				if (stroke.points.length === 1) {
					return scratchPadPointSegmentDistance(stroke.points[0], start, end) > SCRATCH_PAD_ERASER_RADIUS;
				}
				return !stroke.points.slice(1).some((point, index) =>
					scratchPadSegmentDistance(stroke.points[index], point, start, end) <= SCRATCH_PAD_ERASER_RADIUS,
				);
			});
			if (this.strokes.length !== previousCount) this.notifyChange();
		},
		startStroke(event) {
			if (!this.active || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			let point = this.pointFromEvent(event);
			if (this.tool === 'eraser') {
				this.eraserPoint = point;
				this.eraseStrokes(point, point);
				this.render();
				return;
			}

			this.currentStroke = { color: this.color, points: [point] };
			this.strokes.push(this.currentStroke);
			this.notifyChange();
			this.render();
		},
		continueStroke(event) {
			let stroke = this.currentStroke;
			if ((!stroke && !this.eraserPoint) || !event.isPrimary || event.buttons === 0) return;
			event.preventDefault();
			let point = this.pointFromEvent(event);
			if (this.eraserPoint) {
				this.eraseStrokes(this.eraserPoint, point);
				this.eraserPoint = point;
				this.render();
				return;
			}
			if (!stroke) {
				return;
			}
			let previous = stroke.points[stroke.points.length - 1];
			if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < SCRATCH_PAD_POINT_DISTANCE) return;
			stroke.points.push(point);
			this.render();
		},
		endStroke(event) {
			if (!event.isPrimary) return;
			if (this.eraserPoint) {
				this.eraserPoint = undefined;
				return;
			}

			let stroke = this.currentStroke;
			this.currentStroke = undefined;
			if (!stroke) {
				return;
			}
			if (event.type === 'pointercancel') {
				if (this.isTap(stroke)) {
					this.removeStroke(stroke);
					this.notifyChange();
				}
				this.render();
				return;
			}

			let point = this.pointFromEvent(event);
			if (!this.isTap(stroke, point)) return;
			this.removeStroke(stroke);
			this.drawMark(point, this.invertMarks);
		},
		drawMark(point, flag) {
			let jitter = () => (Math.random() - .5) * SCRATCH_PAD_MARK_SIZE * .12;
			let angle = (Math.random() - .5) * .14;
			let rotate = (x, y) => ({
				x: point.x + x * Math.cos(angle) - y * Math.sin(angle) + jitter(),
				y: point.y + x * Math.sin(angle) + y * Math.cos(angle) + jitter(),
			});
			let path = flag
				? [[-.32, .9], [-.32, -.9], [-.3, -.82], [.72, -.48], [-.3, -.08]]
				: [[-.8, -.02], [-.22, .62], [.86, -.72]];
			let stroke = {
				color: this.color,
				points: path.map(([x, y]) => rotate(x * SCRATCH_PAD_MARK_SIZE, y * SCRATCH_PAD_MARK_SIZE)),
				drawProgress: 0,
			};
			this.strokes.push(stroke);
			this.notifyChange();
			this.animateMark(stroke);
		},
		animateMark(stroke) {
			let startTime;
			let drawFrame = (time) => {
				startTime ??= time;
				stroke.drawProgress = Math.min(1, (time - startTime) / SCRATCH_PAD_MARK_ANIMATION_MS);
				this.render();
				if (stroke.drawProgress >= 1) return;
				let frame = requestAnimationFrame(drawFrame);
				this.animationFrames.add(frame);
			};
			let frame = requestAnimationFrame(drawFrame);
			this.animationFrames.add(frame);
		},
		contextMenu(event) {
			if (!this.active) return;
			let point = this.pointFromEvent(event);
			if (this.tool === 'eraser') {
				this.eraseStrokes(point, point);
				this.render();
				return;
			}
			if (this.currentStroke && this.isTap(this.currentStroke, point)) {
				this.removeStroke(this.currentStroke);
				this.currentStroke = undefined;
			}
			this.drawMark(point, !this.invertMarks);
		},
		cycleTool(event) {
			if (!this.active) return;
			let delta = event.deltaY || event.deltaX;
			if (delta === 0) return;
			let tools = [...this.colors, 'eraser'];
			let current = this.tool === 'eraser' ? tools.length - 1 : tools.indexOf(this.color);
			let next = tools[(current + (delta > 0 ? 1 : -1) + tools.length) % tools.length];
			if (next === 'eraser') {
				this.$emit('update:tool', 'eraser');
				return;
			}
			this.$emit('update:color', next);
			this.$emit('update:tool', 'pencil');
		},
		clear() {
			this.strokes = [];
			this.finishInteraction();
			this.notifyChange();
			this.render();
		},
		reset() {
			this.clear();
			this.$nextTick(() => this.resize());
		},
	},
});
</script>

<template id="scratch-pad">
	<canvas
		class="scratch-pad"
		:class="{
			'scratch-pad--active': active,
			'scratch-pad--erasing': active && tool === 'eraser',
		}"
		aria-hidden="true"
		@pointerdown="startStroke"
		@pointermove="continueStroke"
		@pointerup="endStroke"
		@pointercancel="endStroke"
		@wheel.prevent="cycleTool"
		@contextmenu.prevent="contextMenu"
	></canvas>
</template>

<style>
.scratch-pad {
	position: absolute;
	z-index: 2;
	inset: 0;
	display: block;
	width: 100%;
	height: 100%;
	opacity: .88;
	pointer-events: none;
}

.scratch-pad--active {
	cursor: crosshair;
	pointer-events: auto;
	touch-action: none;
}

.scratch-pad--erasing {
	cursor: cell;
}
</style>
