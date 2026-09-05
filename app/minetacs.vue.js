import loadMinetacs from './minetacs.js';

/** @type {ReturnType<typeof loadMinetacs> | undefined} */
let minetacsPromise;

/**
 * Lazily loads one shared Minetacs WebAssembly instance.
 * A failed load is not cached, so a later action can retry it.
 */
function getMinetacs() {
	if (!minetacsPromise) {
		minetacsPromise = loadMinetacs().catch((error) => {
			minetacsPromise = undefined;
			throw error;
		});
	}
	return minetacsPromise;
}
