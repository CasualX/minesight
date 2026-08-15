// @ts-check

// Designed with the linked Sound Lab's recipe-based Web Audio approach. These
// effects are synthesized at play time, so the game does not need audio files.

const MIN_GAIN = 0.0001;

/**
 * @typedef {{
 *   kind: 'tone', waveform?: OscillatorType, frequency: number, glideTo?: number,
 *   offset?: number, attack: number, decay: number, peak: number, pan?: number
 * } | {
 *   kind: 'noise', filterType: BiquadFilterType, filterFrequency: number,
 *   filterGlideTo?: number, filterQ?: number, offset?: number, attack: number,
 *   decay: number, peak: number, pan?: number
 * }} SoundLayer
 * @typedef {{
 *   gain: number, layers: SoundLayer[],
 *   echo?: { delay: number, feedback: number, wet: number, lowpass: number }
 * }} SoundRecipe
 */

/** @type {Record<string, SoundRecipe>} */
export const SOUND_RECIPES = {
	// One neutral mechanical clack for either kind of correct deduction.
	mark: {
		gain: .5,
		layers: [
			{ kind: 'noise', filterType: 'bandpass', filterFrequency: 1750, filterQ: 1.7, attack: .001, decay: .035, peak: .105 },
			{ kind: 'tone', waveform: 'triangle', frequency: 210, glideTo: 125, attack: .002, decay: .075, peak: .07 },
		],
	},
	unmark: {
		gain: .4,
		layers: [
			{ kind: 'tone', waveform: 'sine', frequency: 360, glideTo: 245, attack: .003, decay: .075, peak: .075 },
		],
	},
	hint: {
		gain: .42,
		layers: [
			{ kind: 'tone', waveform: 'sine', frequency: 940, attack: .004, decay: .42, peak: .065 },
		],
		echo: { delay: .18, feedback: .28, wet: .2, lowpass: 3200 },
	},
	incorrect: {
		gain: .52,
		layers: [
			{ kind: 'tone', waveform: 'triangle', frequency: 560, glideTo: 510, attack: .004, decay: .1, peak: .075 },
			{ kind: 'tone', waveform: 'triangle', frequency: 410, glideTo: 355, offset: .1, attack: .004, decay: .17, peak: .085 },
		],
	},
	failure: {
		gain: .6,
		layers: [
			{ kind: 'tone', waveform: 'sine', frequency: 145, glideTo: 48, attack: .002, decay: .28, peak: .15 },
			{ kind: 'noise', filterType: 'lowpass', filterFrequency: 480, filterGlideTo: 130, filterQ: .8, attack: .001, decay: .2, peak: .11 },
			{ kind: 'noise', filterType: 'bandpass', filterFrequency: 1800, filterQ: 1.1, attack: .001, decay: .07, peak: .055 },
		],
	},
	success: {
		gain: .48,
		layers: [
			{ kind: 'tone', waveform: 'sine', frequency: 523.25, attack: .004, decay: .12, peak: .065 },
			{ kind: 'tone', waveform: 'sine', frequency: 659.25, offset: .07, attack: .004, decay: .14, peak: .065 },
			{ kind: 'tone', waveform: 'sine', frequency: 783.99, offset: .14, attack: .004, decay: .24, peak: .075 },
		],
		echo: { delay: .11, feedback: .2, wet: .14, lowpass: 4300 },
	},
	complete: {
		gain: .5,
		layers: [
			{ kind: 'tone', waveform: 'sine', frequency: 523.25, attack: .004, decay: .13, peak: .06, pan: -.35 },
			{ kind: 'tone', waveform: 'sine', frequency: 659.25, offset: .08, attack: .004, decay: .13, peak: .06, pan: -.15 },
			{ kind: 'tone', waveform: 'sine', frequency: 783.99, offset: .16, attack: .004, decay: .15, peak: .065, pan: .15 },
			{ kind: 'tone', waveform: 'sine', frequency: 1046.5, offset: .24, attack: .004, decay: .42, peak: .08, pan: .35 },
			{ kind: 'noise', filterType: 'highpass', filterFrequency: 5200, filterQ: .8, offset: .24, attack: .01, decay: .2, peak: .025 },
		],
		echo: { delay: .14, feedback: .29, wet: .22, lowpass: 5000 },
	},
	start: {
		gain: .44,
		layers: [
			{ kind: 'tone', waveform: 'sine', frequency: 660, attack: .003, decay: .09, peak: .07 },
			{ kind: 'tone', waveform: 'sine', frequency: 990, offset: .1, attack: .003, decay: .18, peak: .075 },
		],
	},
	toggle: {
		gain: .38,
		layers: [
			{ kind: 'noise', filterType: 'bandpass', filterFrequency: 2100, filterQ: 1.8, attack: .001, decay: .02, peak: .09 },
			{ kind: 'tone', waveform: 'sine', frequency: 960, offset: .025, attack: .002, decay: .07, peak: .035 },
		],
	},
};

/** @param {number} value */
function clampPan(value) {
	return Math.max(-1, Math.min(1, value));
}

class GameSounds {
	constructor() {
		this.enabled = true;
		/** @type {AudioContext | undefined} */
		this.context = undefined;
		/** @type {GainNode | undefined} */
		this.output = undefined;
	}

	ensureContext() {
		if (!this.context) {
			let AudioContextClass = window.AudioContext ?? /** @type {typeof AudioContext | undefined} */ (
				Reflect.get(window, 'webkitAudioContext')
			);
			if (!AudioContextClass) return undefined;
			this.context = new AudioContextClass();
			this.output = this.context.createGain();
			this.output.gain.value = .72;
			this.output.connect(this.context.destination);
		}
		if (this.context.state === 'suspended') void this.context.resume();
		return this.context;
	}

	/** @param {boolean} enabled */
	setEnabled(enabled) {
		this.enabled = enabled;
	}

	toggle() {
		if (this.enabled) {
			this.play('toggle');
			this.setEnabled(false);
		}
		else {
			this.setEnabled(true);
			this.play('toggle');
		}
		return this.enabled;
	}

	/**
	 * @param {keyof typeof SOUND_RECIPES} name
	 * @param {{ rate?: number, gain?: number, pan?: number }} [options]
	 */
	play(name, { rate = 1, gain = 1, pan = 0 } = {}) {
		if (!this.enabled) return;
		let recipe = SOUND_RECIPES[name];
		if (!recipe) return;
		let context = this.ensureContext();
		if (!context || !this.output) return;

		let bus = context.createGain();
		/** @type {AudioNode[]} */
		let disposableNodes = [bus];
		bus.gain.value = recipe.gain * gain;
		bus.connect(this.output);
		if (recipe.echo) disposableNodes.push(...this.connectEcho(context, bus, recipe.echo));

		let startTime = context.currentTime + .008;
		for (let layer of recipe.layers) {
			let layerStart = startTime + (layer.offset ?? 0);
			let envelope = context.createGain();
			envelope.gain.setValueAtTime(MIN_GAIN, layerStart);
			envelope.gain.exponentialRampToValueAtTime(layer.peak, layerStart + layer.attack);
			envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, layerStart + layer.attack + layer.decay);

			this.connectPan(context, envelope, bus, clampPan(pan + (layer.pan ?? 0)));
			if (layer.kind === 'tone') this.playTone(context, layer, envelope, layerStart, rate);
			else this.playNoise(context, layer, envelope, layerStart, rate);
		}

		let soundLength = Math.max(...recipe.layers.map((layer) => (
			(layer.offset ?? 0) + layer.attack + layer.decay
		)));
		let echoTail = recipe.echo ? recipe.echo.delay * 8 + .25 : .1;
		window.setTimeout(() => {
			for (let node of disposableNodes) node.disconnect();
		}, (soundLength + echoTail) * 1000);
	}

	/**
	 * @param {AudioContext} context @param {GainNode} source @param {GainNode} destination @param {number} pan
	 */
	connectPan(context, source, destination, pan) {
		if (!pan || typeof context.createStereoPanner !== 'function') {
			source.connect(destination);
			return destination;
		}
		let panner = context.createStereoPanner();
		panner.pan.value = pan;
		source.connect(panner).connect(destination);
		return panner;
	}

	/** @param {AudioContext} context @param {GainNode} bus @param {NonNullable<SoundRecipe['echo']>} echo */
	connectEcho(context, bus, echo) {
		let delay = context.createDelay(1);
		let lowpass = context.createBiquadFilter();
		let feedback = context.createGain();
		let wet = context.createGain();
		delay.delayTime.value = echo.delay;
		lowpass.type = 'lowpass';
		lowpass.frequency.value = echo.lowpass;
		feedback.gain.value = echo.feedback;
		wet.gain.value = echo.wet;
		bus.connect(delay);
		delay.connect(lowpass).connect(feedback).connect(delay);
		lowpass.connect(wet).connect(this.output);
		return [delay, lowpass, feedback, wet];
	}

	/** @param {AudioContext} context @param {Extract<SoundLayer, { kind: 'tone' }>} layer @param {GainNode} envelope @param {number} startTime @param {number} rate */
	playTone(context, layer, envelope, startTime, rate) {
		let oscillator = context.createOscillator();
		oscillator.type = layer.waveform ?? 'sine';
		oscillator.frequency.setValueAtTime(layer.frequency * rate, startTime);
		if (layer.glideTo) {
			oscillator.frequency.exponentialRampToValueAtTime(layer.glideTo * rate, startTime + layer.attack + layer.decay);
		}
		oscillator.connect(envelope);
		oscillator.start(startTime);
		oscillator.stop(startTime + layer.attack + layer.decay + .03);
	}

	/** @param {AudioContext} context @param {Extract<SoundLayer, { kind: 'noise' }>} layer @param {GainNode} envelope @param {number} startTime @param {number} rate */
	playNoise(context, layer, envelope, startTime, rate) {
		let duration = layer.attack + layer.decay + .03;
		let buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
		let samples = buffer.getChannelData(0);
		for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

		let source = context.createBufferSource();
		let filter = context.createBiquadFilter();
		source.buffer = buffer;
		filter.type = layer.filterType;
		filter.Q.value = layer.filterQ ?? .7;
		filter.frequency.setValueAtTime(layer.filterFrequency * rate, startTime);
		if (layer.filterGlideTo) {
			filter.frequency.exponentialRampToValueAtTime(layer.filterGlideTo * rate, startTime + layer.attack + layer.decay);
		}
		source.connect(filter).connect(envelope);
		source.start(startTime);
		source.stop(startTime + duration);
	}
}

export const gameSounds = new GameSounds();
