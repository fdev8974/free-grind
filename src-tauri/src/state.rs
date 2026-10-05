use std::sync::RwLock;

use crate::error::AppError;

/// Everything spawned against the *current* `grindr::GrindrClient` that must
/// be torn down and respawned whenever the client itself is swapped out
/// (account switch, `login_with_jwt`'s exchange). Held next to the client so
/// swapping never leaves an old bridge task pinned to a stale client.
#[derive(Default)]
pub struct ClientTasks {
    pub handles: Vec<tauri::async_runtime::JoinHandle<()>>,
}

impl ClientTasks {
    pub fn abort_all(&mut self) {
        for handle in self.handles.drain(..) {
            handle.abort();
        }
    }
}

/// Plain `std::sync::RwLock`, not `tokio::sync::RwLock` — every access here
/// is a brief clone/replace with no `.await` held across it, so a blocking
/// lock is simpler and lets client construction happen synchronously in
/// Tauri's (sync) `.setup()` hook instead of needing `block_on`.
pub struct AppState {
    pub client: RwLock<Option<grindr::GrindrClient>>,
    pub tasks: RwLock<ClientTasks>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            client: RwLock::new(None),
            tasks: RwLock::new(ClientTasks::default()),
        }
    }
}

impl AppState {
    pub fn client(&self) -> Result<grindr::GrindrClient, AppError> {
        self.client
            .read()
            .unwrap()
            .clone()
            .ok_or(AppError::NotInitialized)
    }

    /// Replaces the active client and aborts whatever background tasks were
    /// bound to the previous one, returning the outgoing client (if any) so
    /// the caller can close it out. Callers are responsible for respawning
    /// the session-persistence / websocket-bridge tasks against the new one.
    pub fn set_client(&self, client: grindr::GrindrClient) -> Option<grindr::GrindrClient> {
        self.tasks.write().unwrap().abort_all();
        self.client.write().unwrap().replace(client)
    }

    pub fn add_task(&self, handle: tauri::async_runtime::JoinHandle<()>) {
        self.tasks.write().unwrap().handles.push(handle);
    }
}
