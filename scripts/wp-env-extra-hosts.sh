#!/usr/bin/env sh
# Apply optional extra_hosts overlay onto the running wp-env compose project.
set -e
cd "$(dirname "$0")/.."

if [ ! -f docker-compose.extra-hosts.yml ]; then
	echo "Skipping extra_hosts: copy docker-compose.extra-hosts.example.yml to docker-compose.extra-hosts.yml and set your local hostnames."
	exit 0
fi

WP_ENV=wp-env
if [ -x ./node_modules/.bin/wp-env ]; then
	WP_ENV=./node_modules/.bin/wp-env
fi

INSTALL_PATH=$(
	"$WP_ENV" status --json | node -e '
		let data = "";
		process.stdin.on("data", (chunk) => { data += chunk; });
		process.stdin.on("end", () => {
			const status = JSON.parse(data);
			if (!status.installPath) {
				console.error("wp-env status did not include installPath.");
				process.exit(1);
			}
			process.stdout.write(status.installPath);
		});
	'
)

COMPOSE_FILE="${INSTALL_PATH}/docker-compose.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
	echo "wp-env docker-compose.yml not found at ${COMPOSE_FILE}. Is the environment started?"
	exit 1
fi

docker compose \
	-f "$COMPOSE_FILE" \
	-f docker-compose.extra-hosts.yml \
	up -d --force-recreate wordpress cli
