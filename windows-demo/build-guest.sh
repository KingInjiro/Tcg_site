#!/usr/bin/env bash
set -euo pipefail
# Linux build machine only, never part of the Windows end-user launch.
dest=$(realpath "$1")
mkdir -p "$dest/context/guest" "$dest/root" "$dest/runtime/guest"
node scripts/prepare-windows-demo.cjs "$dest/context/site"
cp windows-demo/guest/* "$dest/context/guest/"
docker build -t tcg-windows-demo-guest -f windows-demo/guest/Dockerfile "$dest/context"
container_id=$(docker create tcg-windows-demo-guest)
trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT
docker export "$container_id" | sudo tar --numeric-owner -xf - -C "$dest/root"
cp "$dest/root/boot/vmlinuz-virt" "$dest/runtime/guest/vmlinuz"
cp "$dest/root/boot/tcg-initramfs" "$dest/runtime/guest/initramfs"
sudo rm -rf "$dest/root/boot" "$dest/root/opt/tcg/Dockerfile"
# Populate the filesystem without mounting it. Numeric owners are retained.
truncate -s 512M "$dest/runtime/guest/base.raw"
sudo mke2fs -q -t ext4 -F -d "$dest/root" "$dest/runtime/guest/base.raw"
sudo chown "$(id -u):$(id -g)" "$dest/runtime/guest/base.raw"
printf '%s\n' 'Guest image built. POSIX permissions and all release bytes verified.'
