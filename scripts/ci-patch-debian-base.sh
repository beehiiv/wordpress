#!/usr/bin/env bash
# Re-tag wordpress:php<version> with apt sources pointed at archive.debian.org.
#
# The PHP 7.4 / 8.0 official images are Debian bullseye, whose security mirror
# no longer serves packages. wp-env's generated Dockerfile runs
# `apt-get install` on top of those images and fails with 404s. Building
# over the same local tag lets wp-env pick up the patched base unchanged.
#
# Usage: scripts/ci-patch-debian-base.sh <php-version>   e.g. 7.4

set -euo pipefail

php_version="${1:?Usage: $0 <php-version>}"
image="wordpress:php${php_version}"

docker pull "${image}"

docker build -t "${image}" - <<DOCKERFILE
FROM ${image}
RUN for f in /etc/apt/sources.list /etc/apt/sources.list.d/*; do \\
		[ -f "\$f" ] || continue; \\
		sed -i -e 's|deb.debian.org/debian-security|archive.debian.org/debian-security|g' \\
			-e 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' \\
			-e 's|deb.debian.org/debian|archive.debian.org/debian|g' \\
			-e '/bullseye-updates/d' "\$f"; \\
	done; \\
	echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive
DOCKERFILE
