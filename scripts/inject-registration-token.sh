#!/usr/bin/env bash
# Replace the REGISTRATION_TOKEN constant placeholder in Config.php.
#
# Must not globally replace BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER: that string
# is also the sentinel in has_registration_token(). A global replace makes the
# check compare the injected token against itself and always fail, which is what
# broke WordPress.org 1.0.1 installs.
set -euo pipefail

FILE="${1:-includes/OAuth/Config.php}"

if [ -z "${BEEHIIV_REGISTRATION_TOKEN:-}" ]; then
	echo "BEEHIIV_REGISTRATION_TOKEN is not set" >&2
	exit 1
fi

if [ ! -f "$FILE" ]; then
	echo "Config file not found: $FILE" >&2
	exit 1
fi

perl -pi -e 's{private const REGISTRATION_TOKEN = '\''BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER'\'';}{private const REGISTRATION_TOKEN = '\''$ENV{BEEHIIV_REGISTRATION_TOKEN}'\'';}' "$FILE"

if grep -q "private const REGISTRATION_TOKEN = 'BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER'" "$FILE"; then
	echo "Failed to replace REGISTRATION_TOKEN placeholder" >&2
	exit 1
fi

placeholder_count="$(grep -c 'BEEHIIV_REGISTRATION_TOKEN_PLACEHOLDER' "$FILE" || true)"
if [ "$placeholder_count" -ne 1 ]; then
	echo "Expected the has_registration_token() sentinel to remain (found ${placeholder_count} placeholders)" >&2
	exit 1
fi
