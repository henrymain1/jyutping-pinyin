"""Build store packages from extension/ into dist/.

Usage:
    python tools/package.py

Writes:
    dist/jyutping-pinyin-firefox-<version>.zip
        For addons.mozilla.org. The manifest as it is.
    dist/jyutping-pinyin-chrome-<version>.zip
        For the Chrome Web Store and Edge Add-ons. The same files, with the
        Firefox-only manifest keys (browser_specific_settings, background.scripts)
        removed so Chrome's store doesn't warn about them.

Zip entries use forward slashes, which addons.mozilla.org requires.
"""

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
DIST = ROOT / "dist"


def chrome_manifest(manifest):
    out = dict(manifest)
    out.pop("browser_specific_settings", None)
    out["background"] = {"service_worker": manifest["background"]["service_worker"]}
    return out


def write_zip(path, manifest):
    files = sorted(p for p in SOURCE.rglob("*") if p.is_file() and p.name != "manifest.json")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        for file in files:
            z.write(file, file.relative_to(SOURCE).as_posix())
    print(f"{path.relative_to(ROOT).as_posix()}  {path.stat().st_size / 1e3:.0f} KB, {len(files) + 1} files")


def main():
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    DIST.mkdir(exist_ok=True)
    write_zip(DIST / f"jyutping-pinyin-firefox-{version}.zip", manifest)
    write_zip(DIST / f"jyutping-pinyin-chrome-{version}.zip", chrome_manifest(manifest))


if __name__ == "__main__":
    main()
