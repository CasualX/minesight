<script>
const NotificationToast = Vue.defineComponent({
	template: '#notification-toast',
	props: {
		message: { type: String, default: '' },
	},
	data() {
		return {
			visible: false,
			dismissTimer: /** @type {number | undefined} */ (undefined),
		};
	},
	watch: {
		message: {
			immediate: true,
			handler(message) {
				clearTimeout(this.dismissTimer);
				this.visible = Boolean(message);
				if (message) {
					this.dismissTimer = setTimeout(() => {
						this.visible = false;
					}, 2800);
				}
			},
		},
	},
	beforeUnmount() {
		clearTimeout(this.dismissTimer);
	},
});
</script>

<template id="notification-toast">
	<p v-if="visible" class="notification-toast" role="status">{{ message }}</p>
</template>

<style>
.notification-toast {
	position: fixed;
	z-index: 10;
	left: 50%;
	bottom: calc(1.125rem + env(safe-area-inset-bottom));
	width: max-content;
	max-width: calc(100% - 2rem);
	margin: 0;
	padding: .5625rem .8125rem;
	border: 1px solid var(--ink);
	background: var(--ink);
	color: var(--paper);
	box-shadow: 0 3px 14px rgb(0 0 0 / 18%);
	transform: translateX(-50%);
	font: 700 .75rem/1.35 ui-sans-serif, system-ui, sans-serif;
}
</style>
