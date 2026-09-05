const LONG_PRESS_DELAY = 500;

function installLongPressContextMenuPolyfill(root, options = {}) {
	let activePress;
	let longPressTimer;
	let suppressedClickTarget;
	let suppressedClickUntil = 0;
	let suppressedContextMenuTarget;
	let suppressedContextMenuUntil = 0;

	let selector = options.selector ?? 'button';
	let moveTolerance = options.moveTolerance ?? 10;

	function eventTarget(event) {
		let target = event.target instanceof Element ? event.target.closest(selector) : undefined;
		return target && root.contains(target) ? target : undefined;
	}

	function cancelPress() {
		if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
		longPressTimer = undefined;
		activePress = undefined;
	}

	function handlePointerDown(event) {
		if (event.pointerType === 'mouse' || event.button !== 0) return;
		let target = eventTarget(event);
		if (!target || target.disabled) return;

		cancelPress();
		activePress = {
			pointerId: event.pointerId,
			target,
			startX: event.clientX,
			startY: event.clientY,
		};
		longPressTimer = window.setTimeout(() => {
			let press = activePress;
			if (!press) return;

			longPressTimer = undefined;
			activePress = undefined;
			suppressedClickTarget = press.target;
			suppressedClickUntil = Date.now() + 1000;
			suppressedContextMenuTarget = press.target;
			suppressedContextMenuUntil = Date.now() + 1000;

			let contextMenuEvent = new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				button: 2,
			});
			Object.defineProperty(contextMenuEvent, 'minefieldInputSource', {
				value: 'long-press',
			});
			press.target.dispatchEvent(contextMenuEvent);
		}, LONG_PRESS_DELAY);
	}

	function handlePointerMove(event) {
		if (!activePress || event.pointerId !== activePress.pointerId) return;
		let movedX = event.clientX - activePress.startX;
		let movedY = event.clientY - activePress.startY;
		if (Math.hypot(movedX, movedY) > moveTolerance) cancelPress();
	}

	function handlePointerEnd(event) {
		if (activePress?.pointerId === event.pointerId) cancelPress();
	}

	function handleContextMenu(event) {
		let target = eventTarget(event);
		if (!target) return;

		if (
			event.minefieldInputSource !== 'long-press'
			&& target === suppressedContextMenuTarget
			&& Date.now() <= suppressedContextMenuUntil
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}

		if (activePress?.target === target) {
			cancelPress();
			suppressedClickTarget = target;
			suppressedClickUntil = Date.now() + 1000;
		}
	}

	function handleClick(event) {
		let target = eventTarget(event);
		if (target !== suppressedClickTarget || Date.now() > suppressedClickUntil) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		suppressedClickTarget = undefined;
		suppressedClickUntil = 0;
	}

	root.addEventListener('pointerdown', handlePointerDown, true);
	root.addEventListener('pointermove', handlePointerMove, true);
	root.addEventListener('pointerup', handlePointerEnd, true);
	root.addEventListener('pointercancel', handlePointerEnd, true);
	root.addEventListener('contextmenu', handleContextMenu, true);
	root.addEventListener('click', handleClick, true);

	return () => {
		cancelPress();
		root.removeEventListener('pointerdown', handlePointerDown, true);
		root.removeEventListener('pointermove', handlePointerMove, true);
		root.removeEventListener('pointerup', handlePointerEnd, true);
		root.removeEventListener('pointercancel', handlePointerEnd, true);
		root.removeEventListener('contextmenu', handleContextMenu, true);
		root.removeEventListener('click', handleClick, true);
	};
}
