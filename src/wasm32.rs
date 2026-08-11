use super::{ActionKind, Game, Mode};
use std::cell::RefCell;

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn resultJson(ptr: *const u8, len: usize);
    fn resultError(ptr: *const u8, len: usize);
}

thread_local! {
    static GAME: RefCell<Option<Game>> = const { RefCell::new(None) };
}

fn emit_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string(value) {
        Ok(json) => unsafe { resultJson(json.as_ptr(), json.len()) },
        Err(error) => emit_error(&error.to_string()),
    }
}

fn emit_error(error: &str) {
    unsafe { resultError(error.as_ptr(), error.len()) }
}

fn with_game(mut operation: impl FnMut(&mut Game)) {
    GAME.with(|slot| {
        let mut slot = slot.borrow_mut();
        let game = slot.get_or_insert_with(|| Game::new(0x4d49_4e45_5441_4353));
        operation(game);
        emit_json(&game.snapshot());
    });
}

fn read_string(ptr: *const u8, len: usize) -> Result<String, &'static str> {
    if len == 0 {
        return Ok(String::new());
    }
    if ptr.is_null() && len != 0 {
        return Err("received a null string pointer");
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| "seed must be valid UTF-8")
}

/// Allocates a UTF-8 input buffer for the JavaScript adapter.
#[unsafe(no_mangle)]
pub extern "C" fn minetacs_alloc(len: usize) -> *mut u8 {
    let mut bytes = Vec::<u8>::with_capacity(len);
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    pointer
}

/// Releases an input buffer previously returned by [`minetacs_alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn minetacs_dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_init(entropy_low: u32, entropy_high: u32) {
    let entropy = u64::from(entropy_low) | (u64::from(entropy_high) << 32);
    GAME.with(|slot| *slot.borrow_mut() = Some(Game::new(entropy)));
    with_game(|_| {});
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_snapshot() {
    with_game(|_| {});
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_set_mode(mode: u32) {
    with_game(|game| {
        game.set_mode(if mode == 1 {
            Mode::Challenge
        } else {
            Mode::Practice
        })
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_configure_practice(category: u32) {
    with_game(|game| game.configure_practice(category as usize));
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_new_practice() {
    with_game(Game::new_practice);
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_start_challenge(ptr: *const u8, len: usize) {
    match read_string(ptr, len) {
        Ok(seed) => with_game(|game| game.start_challenge(&seed)),
        Err(error) => emit_error(error),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_start_random_challenge(entropy_low: u32, entropy_high: u32) {
    let entropy = u64::from(entropy_low) | (u64::from(entropy_high) << 32);
    let seed = Game::random_challenge_seed(entropy);
    with_game(|game| game.start_challenge(&seed));
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_challenge_home() {
    with_game(Game::challenge_home);
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_action(index: u32, action: u32) {
    let Some(action) = ActionKind::from_u32(action) else {
        emit_error("unknown action");
        return;
    };
    with_game(|game| game.act(index as usize, action));
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_hint() {
    with_game(Game::hint);
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_explain() {
    with_game(Game::explain);
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_reset() {
    with_game(Game::reset);
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_next() {
    with_game(Game::next);
}

#[unsafe(no_mangle)]
pub extern "C" fn minetacs_replay_challenge() {
    with_game(Game::replay_challenge);
}
