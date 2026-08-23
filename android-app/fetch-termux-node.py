#!/usr/bin/env python3
"""
Downloads Termux nodejs + dependency .deb packages, npm, and prepares
the multi-architecture payload (arm64-v8a, armeabi-v7a) for embedding in an Android APK.

Usage: python fetch-termux-node.py [--clean] [--skip-debs] [--skip-npm] [--arch arm64-v8a,armeabi-v7a]
"""
import os
import sys
import struct
import hashlib
import urllib.request
import tempfile
import io
import gzip
import zlib
import tarfile
import shutil
from pathlib import Path

SUPPORTED_ABIS = {
    "arm64-v8a": "aarch64",
    "armeabi-v7a": "arm",
}

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


def extract_deb_to_payload(deb_data: bytes, target_dir: Path):
    archive_data = extract_deb_ar(deb_data)
    if not archive_data:
        print("  ERROR: Could not find data.tar in .deb")
        return False

    prefix = "data/data/com.termux/files/usr/"
    symlinks = {}

    try:
        with tarfile.open(fileobj=io.BytesIO(archive_data), mode="r:*") as tf:
            for m in tf.getmembers():
                name = m.name.lstrip("./")
                if not name.startswith(prefix):
                    continue
                rel = name[len(prefix):]
                if not rel:
                    continue

                out_path = target_dir / rel

                if m.isdir():
                    out_path.mkdir(parents=True, exist_ok=True)
                elif m.issym() or m.islnk():
                    symlinks[rel] = m.linkname
                elif m.isfile():
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    src = tf.extractfile(m)
                    if src:
                        out_path.write_bytes(src.read())

            # Resolve symlinks as copies for cross-platform compatibility
            for rel, linkname in symlinks.items():
                out_path = target_dir / rel
                base_dir = os.path.dirname(rel)
                target_rel = os.path.normpath(os.path.join(base_dir, linkname)).replace("\\", "/")
                target_path = target_dir / target_rel

                if target_path.exists() and target_path.is_file():
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(target_path, out_path)

        return True
    except Exception as e:
        print(f"  ERROR extracting deb: {e}")
        return False


def download_npm(common_dir: Path):
    print("\n[+] Downloading npm...")
    npm_dir = common_dir / "npm"

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


def patch_npm_sigstore(common_dir: Path):
    print("\n[+] Patching npm sigstore for Android compatibility...")
    protobuf_specs = common_dir / "npm" / "node_modules" / "@sigstore" / "protobuf-specs" / "dist"
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


def create_soname_aliases(abi_dir: Path):
    lib_dir = abi_dir / "lib"
    if not lib_dir.exists():
        print(f"  No lib/ directory found in {abi_dir}, skipping soname aliases")
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
    print(f"  [{abi_dir.name}] Removed {removed} obsolete aliases, created {created} aliases")


def clean_unneeded_dirs(abi_dir: Path):
    for dir_name in ["include", "share", "cmake", "pkgconfig"]:
        p = abi_dir / dir_name
        if p.exists():
            shutil.rmtree(p)
        lib_sub = abi_dir / "lib" / dir_name
        if lib_sub.exists():
            shutil.rmtree(lib_sub)


def create_manifest(payload_dir: Path):
    print("\n[*] Generating manifest.txt...")
    manifest_path = payload_dir / "manifest.txt"
    files = sorted(
        f"payload/{f.relative_to(payload_dir).as_posix()}"
        for f in payload_dir.rglob("*")
        if f.is_file() and f.name != "manifest.txt"
    )
    manifest_path.write_text("\n".join(files), encoding='utf-8')
    print(f"  Manifest: {len(files)} files written to {manifest_path}")


def process_abi(abi: str, termux_arch: str, skip_debs: bool):
    print(f"\n==========================================")
    print(f"=== Processing ABI: {abi} ({termux_arch}) ===")
    print(f"==========================================")

    abi_payload_dir = PAYLOAD_DIR / abi
    abi_debs_dir = DEBS_DIR / abi

    if not skip_debs:
        print(f"[{abi} 1/4] Fetching Packages index for {termux_arch}...")
        packages_url = f"{REPO}/dists/stable/main/binary-{termux_arch}/Packages"
        packages_data = fetch_url(packages_url)
        index = parse_packages_index(packages_data)
        print(f"  Parsed {len(index)} packages\n")

        print(f"[{abi} 2/4] Resolving packages...")
        to_download = []
        for pkg_name in PACKAGES:
            found = find_package(index, pkg_name, termux_arch)
            if not found:
                print(f"  WARNING: Package '{pkg_name}' not found for {termux_arch}, skipping")
                continue
            to_download.append(found)
            print(f"  Found: {found['Package']} {found.get('Version', '?')}")

        nodejs_pkg = find_package(index, "nodejs", termux_arch)
        if nodejs_pkg:
            transitive = resolve_deps(index, nodejs_pkg, termux_arch)
            for t in transitive:
                if t["Package"] not in [d["Package"] for d in to_download]:
                    to_download.append(t)
                    print(f"  Dep:   {t['Package']} {t.get('Version', '?')}")

        abi_debs_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n[{abi} 3/4] Downloading {len(to_download)} packages...")
        for pkg in to_download:
            filename = pkg.get("Filename", "")
            if not filename:
                continue
            deb_name = filename.split("/")[-1].replace(":", "_")
            deb_path = abi_debs_dir / deb_name
            if deb_path.exists():
                print(f"  Cached: {deb_name}")
                continue
            url = f"{REPO}/{filename}"
            data = fetch_url(url)
            deb_path.write_bytes(data)
            print(f"  Saved:  {deb_name} ({len(data) / 1024 / 1024:.1f} MB)")

        print(f"\n[{abi} 4/4] Extracting into {abi_payload_dir}...")
        abi_payload_dir.mkdir(parents=True, exist_ok=True)
        for pkg in to_download:
            filename = pkg.get("Filename", "")
            if not filename:
                continue
            deb_name = filename.split("/")[-1].replace(":", "_")
            deb_path = abi_debs_dir / deb_name
            if not deb_path.exists():
                continue
            print(f"  Extracting: {deb_name}")
            data = deb_path.read_bytes()
            extract_deb_to_payload(data, abi_payload_dir)
    else:
        print(f"[{abi}] Skipped deb download/extraction")

    # If etc/tls exists in abi_payload_dir, copy to common/etc/tls
    abi_etc_tls = abi_payload_dir / "etc" / "tls"
    common_etc_tls = PAYLOAD_DIR / "common" / "etc" / "tls"
    if abi_etc_tls.exists():
        common_etc_tls.mkdir(parents=True, exist_ok=True)
        for f in abi_etc_tls.glob("*"):
            if f.is_file():
                shutil.copy2(f, common_etc_tls / f.name)
        shutil.rmtree(abi_payload_dir / "etc", ignore_errors=True)

    create_soname_aliases(abi_payload_dir)
    clean_unneeded_dirs(abi_payload_dir)

    node_bin = abi_payload_dir / "bin" / "node"
    if node_bin.exists():
        print(f"  [{abi}] node binary: {node_bin} ({node_bin.stat().st_size / 1024 / 1024:.1f} MB)")
    else:
        print(f"  WARNING: [{abi}] node binary not found at {node_bin}")

    lib_dir = abi_payload_dir / "lib"
    if lib_dir.exists():
        libs = list(lib_dir.glob("*.so*"))
        print(f"  [{abi}] libs: {len(libs)} files")


def main():
    print("=== Dango Mobile: Multi-Architecture Payload Fetcher ===\n")

    skip_debs = "--skip-debs" in sys.argv
    skip_npm = "--skip-npm" in sys.argv

    target_abis = list(SUPPORTED_ABIS.keys())
    for arg in sys.argv:
        if arg.startswith("--arch="):
            target_abis = [a.strip() for a in arg.split("=", 1)[1].split(",")]
        elif arg == "--arch" and sys.argv.index(arg) + 1 < len(sys.argv):
            target_abis = [a.strip() for a in sys.argv[sys.argv.index(arg) + 1].split(",")]

    print(f"Target ABIs: {', '.join(target_abis)}")

    PAYLOAD_DIR.mkdir(parents=True, exist_ok=True)
    common_dir = PAYLOAD_DIR / "common"
    common_dir.mkdir(parents=True, exist_ok=True)

    for abi in target_abis:
        if abi not in SUPPORTED_ABIS:
            print(f"WARNING: Unsupported ABI '{abi}'. Supported ABIs: {list(SUPPORTED_ABIS.keys())}")
            continue
        termux_arch = SUPPORTED_ABIS[abi]
        process_abi(abi, termux_arch, skip_debs)

    if not skip_npm:
        download_npm(common_dir)
    else:
        print("\n[+] Skipped npm")

    patch_npm_sigstore(common_dir)
    create_manifest(PAYLOAD_DIR)

    print("\n=== SUMMARY ===")
    for abi in target_abis:
        node_bin = PAYLOAD_DIR / abi / "bin" / "node"
        print(f"  {abi} node: {'EXISTS' if node_bin.exists() else 'MISSING'} ({node_bin})")
    npm_cli = common_dir / "npm" / "bin" / "npm-cli.js"
    print(f"  common npm: {'EXISTS' if npm_cli.exists() else 'MISSING'}")
    print(f"\nPayload successfully prepared at: {PAYLOAD_DIR}\n")


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
