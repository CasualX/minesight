use super::*;


#[link(wasm_import_module = "env")]
unsafe extern "C" {
	fn resultJson(ptr: *const u8, len: usize);
	fn resultError(ptr: *const u8, len: usize);
}

fn result_json<T: serde::Serialize>(v: &T) {
	let s = serde_json::to_string(v);
	unsafe {
		resultJson(s.as_ptr(), s.len());
	}
}

fn result_error<T: ToString>(e: &T) {
	let s = e.to_string();
	unsafe {
		resultError(s.as_ptr(), s.len());
	}
}

#[unsafe(no_mangle)]
pub extern "C" fn boardNew() -> *mut GameState {
	Box::into_raw(Box::new(GameState::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn boardDrop(s: *mut GameState) {
	unsafe { drop(Box::from_raw(s)) }
}

#[unsafe(no_mangle)]
pub extern "C" fn boardIsGameOver(s: *mut GameState) -> u8 {
	let s = unsafe { &mut *s };
	match s.is_game_over() {
		None => 0,
		Some(GameOverReason::Detonation) => 1,
		Some(GameOverReason::Cleared) => 2,
	}
}

#[derive(Copy, Clone, Debug)]
enum Cell {
	Clue0,
	Clue1,
	Clue2,
	Clue3,
	Clue4,
	Clue5,
	Clue6,
	Clue7,
	Clue8,
	Bomb,
	Unrevealed,
	Flagged,
}

#[unsafe(no_mangle)]
pub extern "C" fn boardDisplay(s: *mut GameState) {
	let s = unsafe { &mut *s };

}

#[unsafe(no_mangle)]
pub extern "C" fn boardInputReveal(s: *mut GameState, x: i8, y: i8) {
	let s = unsafe { &mut *s };
	s.reveal(x, y);
}

