# Release Process

Use this checklist to cut a new release.

## 1) Choose a version
- Use semver (e.g., `1.0.0`, `1.0.1`).

## 2) Update versions
- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

## 3) Run tests
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## 4) Build release
```bash
npm run tauri build -- --bundles nsis,msi
```

Artifacts are in:
```
src-tauri/target/release/bundle/
```
Notes:
- The portable app binary is always built at `src-tauri/target/release/codex-manager.exe`.
- MSI/NSIS installers are produced only if the bundlers are installed.
  - NSIS: `winget install --id NSIS.NSIS --exact`
  - WiX: `winget install --id WiXToolset.WiXToolset --exact`

## 5) Commit + tag
```bash
git add -A
git commit -m "Release X.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

## 6) Publish GitHub release
### UI flow
1. GitHub → Releases → Draft a new release
2. Tag: `vX.Y.Z`
3. Title: `vX.Y.Z`
4. Upload installers from `src-tauri/target/release/bundle/`
5. Publish

### CLI flow (optional)
```bash
gh release create vX.Y.Z ^
  "src-tauri/target/release/bundle/**" ^
  --title "vX.Y.Z" ^
  --notes "Release notes here."
```

## 8) Update an existing release (if needed)
If you already published a release (e.g., with the portable exe) and want to
replace assets, update the same release instead of re-tagging:

1) Open the GitHub release and delete the old asset(s).
2) Upload the correct installers from:
   - `src-tauri/target/release/bundle/msi/`
   - `src-tauri/target/release/bundle/nsis/`

CLI alternative:
```bash
gh release upload vX.Y.Z path\to\installer.msi --clobber
gh release upload vX.Y.Z path\to\installer.exe --clobber
```

## 7) Post-release checks
- Install the build and verify app launches.
- Confirm the icon is correct in the taskbar and app window.
