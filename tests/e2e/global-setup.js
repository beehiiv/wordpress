const { wpCli } = require( './utils/wp-cli' );

/**
 * The specs read colours from the Twenty Twenty-Five palette (for example
 * `accent-1`). Another active theme has different colour slugs, so those specs
 * fail for a reason that has nothing to do with the plugin. Activate the theme
 * once before the run so the result does not depend on the environment's state.
 */
module.exports = async function globalSetup() {
	wpCli( 'theme activate twentytwentyfive' );
};
