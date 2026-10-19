#!/bin/sh
set -eu
trap 'result=$?; if [ "$result" -ne 0 ]; then echo "TCG-BOOT-FAILED ($result)" >&2; sync; /sbin/poweroff -f; fi' EXIT
mount -o remount,rw /
mountpoint -q /proc || mount -t proc proc /proc
mountpoint -q /sys || mount -t sysfs sysfs /sys
mountpoint -q /dev || mount -t devtmpfs devtmpfs /dev
mkdir -p /run /dev/pts /dev/shm
mountpoint -q /run || mount -t tmpfs tmpfs /run
mountpoint -q /dev/pts || mount -t devpts devpts /dev/pts
mountpoint -q /dev/shm || mount -t tmpfs tmpfs /dev/shm
mkdir -p /run/apache2
umask 077
hostname tcg-local-demo
modprobe virtio_net
ip link set lo up
ip link set eth0 up
ip addr add 10.0.2.15/24 dev eth0
# No default route or DNS. QEMU also restricts all guest outbound traffic.
modprobe qemu_fw_cfg
php85 /opt/tcg/configure.php
stty -F /dev/ttyS1 raw -echo
(
  while IFS= read -r command; do
    if [ "$command" = "poweroff:$(cat /run/tcg-stop-token)" ]; then
      /usr/sbin/httpd -k graceful-stop || true
      sleep 2
      sync
      /sbin/poweroff
      exit
    fi
  done < /dev/ttyS1
) &
/usr/sbin/httpd -DFOREGROUND
