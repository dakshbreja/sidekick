#!/usr/bin/env python3
"""Build only reviewed instruction files; never package a workspace or browser profile."""
import argparse
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parent.parent
PACKAGE = REPOSITORY / "plugins" / "school-bridge-community"
FILES = (
    "COPYRIGHT",
    "plugin.json",
    "skills/save-recovery/SKILL.md",
    "skills/workspace-onboarding/SKILL.md",
)


def build(output):
    output = Path(output).resolve()
    if output.is_relative_to(REPOSITORY):
        raise ValueError("Plugin archive must be outside the repository")
    subprocess.run(["node", "scripts/plugin-audit.mjs"], cwd=REPOSITORY, check=True)
    # Read the reviewed files before creating an output; a failed read must not
    # leave a partially useful package that someone could mistake for complete.
    contents = [(name, (PACKAGE / name).read_bytes()) for name in FILES]
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".partial", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, data in contents:
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "ok": True,
        "files": len(FILES),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "host_installation_verified": False,
        "efficiency_benchmarked": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.output), indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError):
        parser.exit(1, "Plugin packaging failed. Output must be outside the repository and the package audit must pass.\n")
