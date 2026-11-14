use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(windows)]
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let output_dir = manifest_dir.join("..").join("cef-runtime");
        let target_dir = std::env::current_exe()?
            .parent()
            .ok_or("bundle tool executable has no parent directory")?
            .to_path_buf();
        let executable = cef::build_util::win::bundle(&output_dir, &target_dir, "cefbrowser")?;
        println!("CEF runtime prepared at {}", executable.display());
    }

    #[cfg(not(windows))]
    {
        return Err("The embedded CEF host is currently supported on Windows desktop only.".into());
    }

    Ok(())
}
