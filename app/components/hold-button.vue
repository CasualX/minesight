<script>
const HoldButton = Vue.defineComponent({
	template: '#hold-button',
	props: {
		label: { type: String, required: true },
		disabled: Boolean,
		duration: { type: Number, default: 900 },
	},
	emits: ['confirm'],
	data() {
		return {
			holding: false,
			timerId: /** @type {number | undefined} */ (undefined),
		};
	},
	watch: {
		disabled(value) {
			if (value) {
				this.cancel();
			}
		},
		duration() {
			this.cancel();
		},
	},
	methods: {
		begin(event) {
			if (this.disabled || this.holding || event?.repeat) {
				return;
			}
			this.holding = true;
			this.timerId = setTimeout(() => {
				this.cancel();
				if (!this.disabled) {
					this.$emit('confirm');
				}
			}, this.duration);
		},
		cancel() {
			this.holding = false;
			if (this.timerId !== undefined) {
				clearTimeout(this.timerId);
			}
			this.timerId = undefined;
		},
	},
	mounted() {
		window.addEventListener('blur', this.cancel);
	},
	beforeUnmount() {
		this.cancel();
		window.removeEventListener('blur', this.cancel);
	},
});
</script>

<template id="hold-button">
	<button
		type="button"
		class="control-feedback hold-action"
		:class="{ 'is-holding': holding }"
		:style="{ '--hold-duration': `${duration}ms` }"
		:disabled="disabled"
		:aria-label="holding ? `${label}. Release to cancel.` : `Hold to ${label.toLowerCase()}`"
		:title="`Hold to ${label.toLowerCase()}`"
		@pointerdown.left="begin"
		@pointerup="cancel"
		@pointerleave="cancel"
		@pointercancel="cancel"
		@contextmenu.prevent
		@selectstart.prevent
		@blur="cancel"
		@keydown.esc="cancel"
		@keydown.enter.prevent="begin"
		@keyup.enter.prevent="cancel"
		@keydown.space.prevent="begin"
		@keyup.space.prevent="cancel"
	>
		<span class="hold-action__progress" aria-hidden="true"></span>
		<span class="hold-action__label">{{ label }}</span>
	</button>
</template>

<style>
button.hold-action {
	--hold-fill: var(--danger-soft);
	--hold-edge: var(--danger);
	position: relative;
	isolation: isolate;
	overflow: hidden;
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	transition: border-color 160ms ease;
}
button.hold-action.is-holding,
.puzzle-view__actions button.hold-action.is-holding {
	border-color: var(--hold-edge);
}
.hold-action__label {
	position: relative;
	z-index: 1;
	pointer-events: none;
}
.hold-action__progress {
	position: absolute;
	inset: 0;
	z-index: 0;
	background: var(--hold-fill);
	transform: scaleX(0);
	transform-origin: left;
	transition: transform 180ms ease-out;
	pointer-events: none;
}
.hold-action__progress::after {
	position: absolute;
	inset: 0 0 0 auto;
	width: 26px;
	background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--hold-edge) 45%, transparent));
	content: '';
}
.hold-action.is-holding .hold-action__progress {
	transform: scaleX(1);
	transition: transform var(--hold-duration) linear;
}
</style>
