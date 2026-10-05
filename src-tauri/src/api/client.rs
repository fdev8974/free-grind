use crate::error::AppError;

/// Builds a `grindr::GrindrClient` from a stored (or freshly generated)
/// device identity and an optional resumed session. Used both at app
/// startup and on every account switch / `login_with_jwt` exchange, since a
/// `grindr::GrindrClient`'s session can only be set at construction time.
pub fn build_client(
    device: Option<grindr::DeviceInfo>,
    session: Option<grindr::Session>,
) -> Result<grindr::GrindrClient, AppError> {
    let device = device.unwrap_or_else(grindr::DeviceInfo::generate);
    grindr::GrindrClient::new(device, session).map_err(AppError::from)
}
