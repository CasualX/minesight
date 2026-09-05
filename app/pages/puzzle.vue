<link rel="component" href="../play-page.vue.css">
<link rel="component" href="../puzzle-view.vue">
<link rel="component" href="../puzzle.vue.js">

<script>
const SharedPuzzlePage = Vue.defineComponent({
	template: '#shared-puzzle-page',
	components: { PuzzleView },
	props: { route: { type: Object, required: true } },
	emits: ['open-page'],
	data() {
		let error = '';
		let field;
		try {
			if (typeof this.route.payload !== 'string') {
				throw new TypeError('Missing puzzle payload.');
			}
			field = PuzzleField.decode(this.route.payload);
		}
		catch {
			error = 'This puzzle link is invalid or cannot be read.';
		}
		return {
			puzzle: new PuzzleController(field),
			error,
			shareMessage: '',
		};
	},
	computed: {
		statusTitle() { return this.error ? 'Puzzle unavailable' : this.puzzle.result === 'cleared' ? 'Puzzle solved' : 'Shared puzzle'; },
		statusMessage() { return this.error || (this.puzzle.result === 'cleared' ? 'Good solve. You can share this position onward.' : 'Mark every square whose state follows from the clues.'); },
	},
	methods: {
		async share() {
			this.shareMessage = '';
			try { this.shareMessage = await sharePuzzleLink(this.puzzle.field); }
			catch { this.shareMessage = 'The share link could not be copied.'; }
		},
	},
	beforeUnmount() { this.puzzle.destroy(); },
});
</script>

<template id="shared-puzzle-page">
	<main class="play-page" aria-labelledby="shared-puzzle-title">
		<header class="play-page__heading"><div><h1 id="shared-puzzle-title">Shared puzzle</h1><p>A standalone position sent for you to solve.</p></div></header>
		<puzzle-view :puzzle="puzzle" :status-title="statusTitle" :status-message="statusMessage" :share-available="!error" :share-message="shareMessage" @share="share">
			<button v-if="error" type="button" class="control-feedback primary" @click="$emit('open-page', 'home')">Back to menu</button>
			<template v-else>
				<button class="control-feedback" type="button" :disabled="puzzle.disabled" :aria-pressed="puzzle.hintsVisible" @click="puzzle.toggleHints()">Hint</button>
			</template>
		</puzzle-view>
	</main>
</template>
