#!/usr/bin/env bash
# Build dist/beehiiv.zip with the registration token baked in, matching what
# .github/workflows/deploy.yml ships to WordPress.org. Unlike CI's throwaway
# checkout, this runs against the real working tree, so the token is written
# to includes/OAuth/Config.php only for the duration of the build and is
# always restored afterward, even on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG_FILE="includes/OAuth/Config.php"
ENV_FILE=".env.build"

if [ -f "$ENV_FILE" ]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi

if [ -z "${BEEHIIV_REGISTRATION_TOKEN:-}" ]; then
	echo "BEEHIIV_REGISTRATION_TOKEN is not set. Copy .env.build.example to .env.build and fill in a token (see wp-config.php for the local value), or export it in your shell." >&2
	exit 1
fi

BACKUP_FILE="$(mktemp)"
cp "$CONFIG_FILE" "$BACKUP_FILE"

restore_config() {
	cp "$BACKUP_FILE" "$CONFIG_FILE"
	rm -f "$BACKUP_FILE"
}
trap restore_config EXIT

npm run build

composer install --no-dev --optimize-autoloader --prefer-dist --no-interaction --no-progress

perl -pi -e 's/BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER/$ENV{BEEHIIV_REGISTRATION_TOKEN}/g' "$CONFIG_FILE"
if grep -q 'BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER' "$CONFIG_FILE"; then
	echo "Failed to replace registration token placeholder" >&2
	exit 1
fi

find . -name '.DS_Store' -not -path './node_modules/*' -not -path './.git/*' -delete
rm -rf dist
mkdir -p dist
composer archive --format=zip --dir=dist --file=beehiiv

echo "Built dist/beehiiv.zip with registration token injected."
