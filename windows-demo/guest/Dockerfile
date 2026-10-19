FROM alpine:3.24.2
# Build-time only. Docker is never installed or invoked on the tester's PC.
RUN apk add --no-cache linux-virt mkinitfs apache2 apache2-ssl php85-apache2 php85-openssl php85-dom php85-fileinfo php85-gd php85-session openssl \
    && adduser -D -u 1000 tcg \
    && mkdir -p /srv/tcg/public /opt/tcg /run/apache2 \
    && chown -R tcg:tcg /srv/tcg
COPY site/ /srv/tcg/public/
COPY guest/ /opt/tcg/
RUN chown -R tcg:tcg /srv/tcg \
    && chmod 700 /srv/tcg \
    && chmod +x /opt/tcg/boot.sh \
    && printf '::sysinit:/opt/tcg/boot.sh\n::shutdown:/bin/umount -a -r\n' > /etc/inittab \
    && printf 'features="base virtio ext4"\n' > /etc/mkinitfs/mkinitfs.conf \
    && mkinitfs -o /boot/tcg-initramfs $(ls /lib/modules) \
    && rm -rf /var/cache/apk/* /tmp/*
