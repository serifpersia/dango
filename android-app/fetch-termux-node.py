#!/usr/bin/env python3
"""
Downloads Termux nodejs + dependency .deb packages, npm, and prepares
the complete payload for embedding in an Android APK.

Usage: python fetch-termux-node.py [--clean] [--skip-debs] [--skip-npm]
"""
import os
import sys
import struct
import subprocess
import hashlib
import urllib.request
import tempfile
import io
import gzip
import zlib
import tarfile
import shutil
from pathlib import Path

ARCH = "aarch64"
REPO = "https://packages.termux.dev/apt/termux-main"
NPM_REGISTRY = "https://registry.npmjs.org/npm/-/npm-11.19.0.tgz"
SCRIPT_DIR = Path(__file__).resolve().parent
PAYLOAD_DIR = SCRIPT_DIR / "payload"
DEBS_DIR = SCRIPT_DIR / "debs"

PACKAGES = [
    "nodejs",
    "libc++",
    "openssl",
    "c-ares",
    "libicu",
    "libsqlite",
    "zlib",
    "libffi",
]

SONAME_ALIASES = {
    "libz.so": "libz.so.1.3.2",
    "libz.so.1": "libz.so.1.3.2",
    "libsqlite3.so": "libsqlite3.so.3.53.4",
    "libsqlite3.so.0": "libsqlite3.so.3.53.4",
    "libcrypto.so": "libcrypto.so.3",
    "libssl.so": "libssl.so.3",
    "libicui18n.so": "libicui18n.so.78.3",
    "libicui18n.so.78": "libicui18n.so.78.3",
    "libicuuc.so": "libicuuc.so.78.3",
    "libicuuc.so.78": "libicuuc.so.78.3",
    "libicudata.so": "libicudata.so.78.3",
    "libicudata.so.78": "libicudata.so.78.3",
    "libicuio.so": "libicuio.so.78.3",
    "libicuio.so.78": "libicuio.so.78.3",
    "libicutu.so": "libicutu.so.78.3",
    "libicutu.so.78": "libicutu.so.78.3",
    "libicutest.so": "libicutest.so.78.3",
    "libicutest.so.78": "libicutest.so.78.3",
}

OBSOLETE_ALIASES = {
    "libz.so.1",
    "libsqlite3.so.0",
    "libicui18n.so.78",
    "libicuuc.so.78",
    "libicudata.so.78",
    "libicuio.so.78",
    "libicutu.so.78",
    "libicutest.so.78",
}


def fetch_url(url: str) -> bytes:
    print(f"  Downloading: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "dango-mobile/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def parse_packages_index(data: bytes) -> list[dict]:
    entries = []
    current = {}
    for line in data.decode("utf-8", errors="replace").splitlines():
        if line == "":
            if current:
                entries.append(current)
                current = {}
        elif ":" in line and not line.startswith(" "):
            key, _, val = line.partition(":")
            current[key.strip()] = val.strip()
    if current:
        entries.append(current)
    return entries


def find_package(index: list[dict], name: str, arch: str) -> dict | None:
    matches = [
        e for e in index
        if e.get("Package") == name and e.get("Architecture") in (arch, "all")
    ]
    if not matches:
        return None
    matches.sort(key=lambda e: e.get("Version", ""), reverse=True)
    return matches[0]


def resolve_deps(index: list[dict], pkg: dict, arch: str) -> list[dict]:
    needed = set()
    raw_deps = pkg.get("Depends", "")
    for dep_str in raw_deps.split(","):
        dep_name = dep_str.strip().split()[0].split("(")[0].strip()
        if dep_name:
            needed.add(dep_name)
    results = []
    for dep_name in needed:
        found = find_package(index, dep_name, arch)
        if found:
            results.append(found)
    return results


def extract_deb_ar(data: bytes) -> bytes | None:
    if not data.startswith(b"!<arch>\n"):
        return None
    pos = 8
    while pos < len(data):
        if pos + 60 > len(data):
            break
        name = data[pos:pos + 16].rstrip(b" ").rstrip(b"/").decode("ascii", errors="replace")
        size_str = data[pos + 48:pos + 58].decode("ascii").strip()
        try:
            size = int(size_str)
        except ValueError:
            break
        pos += 60
        if name in ("data.tar.xz", "data.tar.gz", "data.tar.zst"):
            return data[pos:pos + size]
        pos += size
        if pos % 2 != 0:
            pos += 1
    return None


def extract_deb_to_payload(deb_data: bytes, payload_dir: Path):
    archive_data = extract_deb_ar(deb_data)
    if not archive_data:
        print("  ERROR: Could not find data.tar in .deb")
        return False

    with tempfile.NamedTemporaryFile(suffix=".tar.xz", delete=False) as tmp:
        tmp.write(archive_data)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            ["tar", "xf", tmp_path, "-C", str(payload_dir), "--strip-components=6"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            gz_path = tmp_path + ".gz"
            os.rename(tmp_path, gz_path)
            tmp_path = gz_path
            result = subprocess.run(
                ["tar", "xzf", tmp_path, "-C", str(payload_dir), "--strip-components=6"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                print(f"  ERROR extracting: {result.stderr}")
                return False
        return True
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def download_npm(payload_dir: Path):
    print("\n[5/7] Downloading npm...")
    npm_dir = payload_dir / "npm"

    if npm_dir.exists() and (npm_dir / "bin" / "npm-cli.js").exists():
        print("  npm already present, skipping")
        return True

    tgz_data = fetch_url(NPM_REGISTRY)

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tmp.write(tgz_data)
        tmp_path = tmp.name

    try:
        npm_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tmp_path) as tf:
            symlinks = {}
            for m in tf.getmembers():
                if m.issym():
                    base = os.path.dirname(m.name)
                    target = os.path.normpath(os.path.join(base, m.linkname))
                    symlinks[m.name] = target

            for member in tf.getmembers():
                if '/' in member.name:
                    rel = member.name[member.name.index('/') + 1:]
                else:
                    rel = member.name

                if not rel or rel == '.':
                    continue

                out = npm_dir / rel

                if member.isdir():
                    out.mkdir(parents=True, exist_ok=True)
                elif member.issym():
                    pass
                elif member.isfile():
                    out.parent.mkdir(parents=True, exist_ok=True)
                    src = tf.extractfile(member)
                    if src:
                        with open(out, 'wb') as f:
                            f.write(src.read())

            resolved = 0
            for sym_name, target in symlinks.items():
                if '/' in sym_name:
                    rel = sym_name[sym_name.index('/') + 1:]
                else:
                    rel = sym_name

                out = npm_dir / rel
                for m in tf.getmembers():
                    m_rel = m.name[m.name.index('/') + 1:] if '/' in m.name else m.name
                    if m_rel == target or m_rel == target + '/':
                        if m.isfile():
                            src = tf.extractfile(m)
                            if src:
                                out.parent.mkdir(parents=True, exist_ok=True)
                                with open(out, 'wb') as f:
                                    f.write(src.read())
                                resolved += 1
                        break

            print(f"  Extracted npm with {resolved} symlinks resolved as copies")
        return True
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def patch_npm_sigstore(payload_dir: Path):
    print("\n[6/7] Patching npm sigstore for Android compatibility...")
    protobuf_specs = payload_dir / "npm" / "node_modules" / "@sigstore" / "protobuf-specs" / "dist"
    generated = protobuf_specs / "__generated__"

    if not generated.exists():
        print("  No __generated__ directory found, skipping")
        return

    target = protobuf_specs / "generated"
    if target.exists():
        shutil.rmtree(target)
    shutil.move(str(generated), str(target))
    print(f"  Renamed __generated__ -> generated")

    for js_file in protobuf_specs.rglob("*.js"):
        content = js_file.read_text(encoding='utf-8')
        if '__generated__' in content:
            content = content.replace('__generated__', 'generated')
            js_file.write_text(content, encoding='utf-8')
            print(f"  Patched: {js_file.relative_to(protobuf_specs)}")


def create_symlinks(payload_dir: Path):
    print("\n[7/7] Creating soname aliases...")
    lib_dir = payload_dir / "lib"
    if not lib_dir.exists():
        print("  No lib/ directory found, skipping")
        return

    removed = 0
    for alias_name in OBSOLETE_ALIASES:
        alias_path = lib_dir / alias_name
        if alias_path.exists() or alias_path.is_symlink():
            try:
                alias_path.unlink()
                removed += 1
            except OSError as e:
                print(f"  WARNING: Could not remove obsolete alias {alias_name}: {e}")

    created = 0
    for alias_name, source_name in SONAME_ALIASES.items():
        source_path = lib_dir / source_name
        alias_path = lib_dir / alias_name
        if not source_path.exists() or alias_path.exists():
            continue
        try:
            shutil.copy2(source_path, alias_path)
            created += 1
        except OSError as e:
            print(f"  WARNING: Could not create alias {alias_name}: {e}")
    print(f"  Removed {removed} obsolete aliases")
    print(f"  Created {created} aliases")


def create_manifest(payload_dir: Path):
    print("\n[*] Generating manifest.txt...")
    manifest_path = payload_dir / "manifest.txt"
    files = sorted(
        f"payload/{f.relative_to(payload_dir).as_posix()}"
        for f in payload_dir.rglob("*")
        if f.is_file() and f.name != "manifest.txt"
    )
    manifest_path.write_text("\n".join(files), encoding='utf-8')
    print(f"  Manifest: {len(files)} files")


def main():
    print("=== Dango Mobile: Payload Fetcher ===\n")

    skip_debs = "--skip-debs" in sys.argv
    skip_npm = "--skip-npm" in sys.argv

    if not skip_debs:
        print("[1/7] Fetching Packages index...")
        packages_url = f"{REPO}/dists/stable/main/binary-{ARCH}/Packages"
        packages_data = fetch_url(packages_url)
        index = parse_packages_index(packages_data)
        print(f"  Parsed {len(index)} packages\n")

        print("[2/7] Resolving packages...")
        to_download = []
        for pkg_name in PACKAGES:
            found = find_package(index, pkg_name, ARCH)
            if not found:
                print(f"  WARNING: Package '{pkg_name}' not found, skipping")
                continue
            to_download.append(found)
            print(f"  Found: {found['Package']} {found.get('Version', '?')}")

        nodejs_pkg = find_package(index, "nodejs", ARCH)
        if nodejs_pkg:
            transitive = resolve_deps(index, nodejs_pkg, ARCH)
            for t in transitive:
                if t["Package"] not in [d["Package"] for d in to_download]:
                    to_download.append(t)
                    print(f"  Dep:   {t['Package']} {t.get('Version', '?')}")

        DEBS_DIR.mkdir(parents=True, exist_ok=True)

        print(f"\n[3/7] Downloading {len(to_download)} packages...")
        for pkg in to_download:
            filename = pkg.get("Filename", "")
            if not filename:
                continue
            deb_name = filename.split("/")[-1]
            deb_path = DEBS_DIR / deb_name
            if deb_path.exists():
                print(f"  Cached: {deb_name}")
                continue
            url = f"{REPO}/{filename}"
            data = fetch_url(url)
            deb_path.write_bytes(data)
            print(f"  Saved:  {deb_name} ({len(data) / 1024 / 1024:.1f} MB)")

        print(f"\n[4/7] Extracting into {PAYLOAD_DIR}...")
        PAYLOAD_DIR.mkdir(parents=True, exist_ok=True)
        for pkg in to_download:
            filename = pkg.get("Filename", "")
            if not filename:
                continue
            deb_name = filename.split("/")[-1]
            deb_path = DEBS_DIR / deb_name
            if not deb_path.exists():
                continue
            print(f"  Extracting: {deb_name}")
            data = deb_path.read_bytes()
            extract_deb_to_payload(data, PAYLOAD_DIR)
    else:
        print("[1-4/7] Skipped (using existing payload)")

    if not skip_npm:
        download_npm(PAYLOAD_DIR)
    else:
        print("[5/7] Skipped npm")

    patch_npm_sigstore(PAYLOAD_DIR)
    create_symlinks(PAYLOAD_DIR)
    create_manifest(PAYLOAD_DIR)

    node_bin = PAYLOAD_DIR / "bin" / "node"
    if node_bin.exists():
        print(f"\n=== DONE ===")
        print(f"  node: {node_bin} ({node_bin.stat().st_size / 1024 / 1024:.1f} MB)")
    else:
        print(f"\n  WARNING: node binary not found at {node_bin}")

    npm_cli = PAYLOAD_DIR / "npm" / "bin" / "npm-cli.js"
    if npm_cli.exists():
        print(f"  npm:  present")
    else:
        print(f"  WARNING: npm not found")

    lib_dir = PAYLOAD_DIR / "lib"
    if lib_dir.exists():
        libs = list(lib_dir.glob("*.so*"))
        print(f"  libs: {len(libs)} files")

    manifest = PAYLOAD_DIR / "manifest.txt"
    if manifest.exists():
        count = len(manifest.read_text().strip().split("\n"))
        print(f"  manifest: {count} files")

    print(f"\n  Payload ready at: {PAYLOAD_DIR}")


if __name__ == "__main__":
    if "--clean" in sys.argv:
        if PAYLOAD_DIR.exists():
            shutil.rmtree(PAYLOAD_DIR)
            print("Cleaned payload/")
        if DEBS_DIR.exists():
            shutil.rmtree(DEBS_DIR)
            print("Cleaned debs/")
        print("Done.")
        sys.exit(0)

    main()
