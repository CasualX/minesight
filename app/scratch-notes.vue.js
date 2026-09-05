// Owner-side note state. Rendering and canvas commands stay with the owner.
class ScratchNotes {
	constructor() {
		this.active = false;
		this.tool = 'pencil';
		this.color = 'graphite';
		this.strokeCount = 0;
	}

	toggle() {
		this.active = !this.active;
		if (this.active && this.tool === 'eraser') this.selectPencil('graphite');
	}

	selectPencil(color) {
		this.color = color;
		this.tool = 'pencil';
	}

	reset() {
		this.active = false;
		this.strokeCount = 0;
	}
}
