use std::process::Command;

// The media proxy's GStreamer source for <video> on Linux (src/media_proxy/element.rs).
const EXTENSION_SOURCE: &str = "webkit-extension/fgmedia.c";
const EXTENSION_DIR: &str = "gen/webkit-extensions";
const EXTENSION_OUTPUT: &str = "gen/webkit-extensions/libfgmedia.so";
const EXTENSION_LIBRARIES: [&str; 4] = [
    "webkit2gtk-web-extension-4.1",
    "gstreamer-1.0",
    "gstreamer-base-1.0",
    "gio-unix-2.0",
];

fn main() {
    embed_commit_hash();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        build_webkit_extension();
    }
    tauri_build::build()
}

/// The short commit the app is built from, as FG_COMMIT_HASH (shown in
/// Settings next to the app version). Read from git, not CI env, so a rebuild
/// of the same commit bakes in the same string; empty outside a checkout.
fn embed_commit_hash() {
    // Re-run on commits and checkouts, not on every build.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/logs/HEAD");
    let hash = Command::new("git")
        .args(["rev-parse", "--short=7", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_default();
    println!("cargo:rustc-env=FG_COMMIT_HASH={hash}");
}

/// Without the GStreamer headers the build still goes through: it leaves an
/// empty library behind (tauri.linux.conf.json bundles it either way), which
/// the app reads as "no extension" and then serves video the buffered way.
fn build_webkit_extension() {
    println!("cargo:rerun-if-changed={EXTENSION_SOURCE}");
    std::fs::create_dir_all(EXTENSION_DIR).expect("create gen/webkit-extensions");
    println!("cargo:rerun-if-env-changed=FG_REQUIRE_MEDIA_EXTENSION");
    if let Err(reason) = compile_webkit_extension() {
        // Release builds (CI) must not ship without it.
        if std::env::var_os("FG_REQUIRE_MEDIA_EXTENSION").is_some() {
            panic!("Linux video streaming extension not built: {reason}");
        }
        println!(
            "cargo:warning=Linux video streaming extension not built ({reason}); \
             install the GStreamer dev packages (gstreamer1-devel and \
             gstreamer1-plugins-base-devel, or libgstreamer1.0-dev and \
             libgstreamer-plugins-base1.0-dev) to get it"
        );
        std::fs::write(EXTENSION_OUTPUT, b"").expect("write the empty extension");
    }
}

fn compile_webkit_extension() -> Result<(), String> {
    let pkg_config = std::env::var("PKG_CONFIG").unwrap_or_else(|_| "pkg-config".to_owned());
    let flags = Command::new(pkg_config)
        .args(["--cflags", "--libs"])
        .args(EXTENSION_LIBRARIES)
        .output()
        .map_err(|e| format!("pkg-config: {e}"))?;
    if !flags.status.success() {
        return Err(String::from_utf8_lossy(&flags.stderr).trim().to_owned());
    }
    let status = cc::Build::new()
        .debug(false)
        .get_compiler()
        .to_command()
        .args([
            "-shared",
            "-fPIC",
            "-O2",
            "-Wall",
            "-o",
            EXTENSION_OUTPUT,
            EXTENSION_SOURCE,
        ])
        .args(String::from_utf8_lossy(&flags.stdout).split_whitespace())
        .status()
        .map_err(|e| format!("C compiler: {e}"))?;
    if !status.success() {
        return Err(format!("compiling {EXTENSION_SOURCE} failed"));
    }
    Ok(())
}
