#!/usr/bin/env sh
# Apply optional extra_hosts overlay onto the running wp-env compose project.
set -e
cd "$(dirname "$0")/.."

if [ ! -f docker-compose.extra-hosts.yml ]; then
	echo "Skipping extra_hosts: copy docker-compose.extra-hosts.example.yml to docker-compose.extra-hosts.yml and set your local hostnames."
	exit 0
fi

docker compose \
	-f "$(wp-env install-path)/docker-compose.yml" \
	-f docker-compose.extra-hosts.yml \
	up -d --force-recreate wordpress cli
