const assert = require( 'node:assert/strict' );
const { test } = require( 'node:test' );
const {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} = require( 'node:fs' );
const path = require( 'node:path' );
const {
	getRecipe,
	pinBase,
	buildImage,
} = require( '../../scripts/ci-build-wordpress-image' );

const hostedRunner = {
	GITHUB_ACTIONS: 'true',
	RUNNER_ENVIRONMENT: 'github-hosted',
};

test( 'local and self-hosted runners cannot replace WordPress image tags', () => {
	for ( const environment of [
		{},
		{ GITHUB_ACTIONS: 'true' },
		{ RUNNER_ENVIRONMENT: 'github-hosted' },
		{ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
	] ) {
		assert.throws(
			() =>
				buildImage( 'wordpress:php8.4', environment, () => {
					assert.fail( 'No command may run outside hosted CI.' );
				} ),
			/restricted to disposable GitHub-hosted/
		);
	}
} );

test( 'unsupported tags are rejected before any command runs', () => {
	for ( const image of [
		'wordpress:latest',
		'wordpress:php7.4',
		'wordpress:php8.4.27',
		'wordpress:php8.4-fpm',
		'other/wordpress:php8.4',
		'wordpress:php8.4; echo unsafe',
		'wordpress:php8.4\n',
	] ) {
		assert.throws(
			() =>
				buildImage( image, hostedRunner, () => {
					assert.fail( 'No command may run for an unsupported tag.' );
				} ),
			/Unsupported WordPress image/
		);
	}
} );

test( 'web and CLI recipes retain their OS families on every supported PHP series', () => {
	for ( const version of [ '8.2.35', '8.3.36', '8.4.27', '8.5.12' ] ) {
		const series = version.slice( 0, 3 );
		const web = getRecipe( `wordpress:php${ series }` );
		const cli = getRecipe( `wordpress:cli-php${ series }` );
		assert.equal( web.directory, `latest/php${ series }/apache` );
		assert.equal( cli.directory, `cli/php${ series }/alpine` );
		assert.ok( web.base.startsWith( `php:${ version }-apache@sha256:` ) );
		assert.ok(
			cli.base.startsWith( `php:${ version }-cli-alpine@sha256:` )
		);
		for ( const recipe of [ web, cli ] ) {
			assert.match( recipe.base, /@sha256:[a-f0-9]{64}$/ );
			assert.match( recipe.commit, /^[a-f0-9]{40}$/ );
		}
	}
} );

test( 'pinning the base preserves the upstream recipe and integrity checks', () => {
	const recipe = getRecipe( 'wordpress:cli-php8.4' );
	const instructions =
		'\nRUN sha512sum -c checksums\nCOPY docker-entrypoint.sh /usr/local/bin/\n';
	assert.equal(
		pinBase( `# upstream\nFROM php:8.4-alpine${ instructions }`, recipe ),
		`# upstream\nFROM ${ recipe.base }${ instructions }`
	);
} );

test( 'an unexpected or additional upstream build stage is rejected', () => {
	const recipe = getRecipe( 'wordpress:php8.4' );
	for ( const dockerfile of [
		'FROM php:8.3-apache\n',
		'FROM php:8.4-alpine\n',
		'FROM php:8.4-apache\nFROM other/image\n',
		'FROM php:8.4-apache AS builder\n',
		'ARG IMAGE\nFROM ${IMAGE}\n',
		'# no build stage\n',
	] ) {
		assert.throws( () => pinBase( dockerfile, recipe ), /Unexpected FROM/ );
	}
} );

function fixture( response = () => undefined ) {
	const recipe = getRecipe( 'wordpress:php8.4' );
	const calls = [];
	let directory;
	const execute = ( command, args ) => {
		calls.push( [ command, ...args ] );
		const result = response( command, args );
		if ( result !== undefined ) {
			return result;
		}
		if ( command === 'docker' && args[ 0 ] === 'run' ) {
			return '8.4.27';
		}
		if ( command === 'git' && args[ 0 ] === 'init' ) {
			directory = args.at( -1 );
		}
		if ( command === 'git' && args.includes( 'rev-parse' ) ) {
			return recipe.commit;
		}
		if ( command === 'git' && args.includes( 'checkout' ) ) {
			const context = path.join( directory, recipe.directory );
			mkdirSync( context, { recursive: true } );
			writeFileSync(
				path.join( context, 'Dockerfile' ),
				'FROM php:8.4-apache\nCOPY docker-entrypoint.sh /usr/local/bin/\n'
			);
			writeFileSync(
				path.join( context, 'docker-entrypoint.sh' ),
				'upstream'
			);
		}
	};
	return { calls, execute, directory: () => directory };
}

test( 'a failed registry pull cannot start a source build', () => {
	const { calls, execute } = fixture( () => {
		throw new Error( 'registry unavailable' );
	} );
	assert.throws(
		() => buildImage( 'wordpress:php8.4', hostedRunner, execute ),
		/registry unavailable/
	);
	assert.equal( calls.length, 1 );
} );

test( 'an affected PHP base cannot be used for reconstruction', () => {
	const { calls, execute } = fixture( ( command, args ) =>
		command === 'docker' && args[ 0 ] === 'run' ? '8.4.26' : undefined
	);
	assert.throws(
		() => buildImage( 'wordpress:php8.4', hostedRunner, execute ),
		/is affected/
	);
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'git' ),
		false
	);
} );

test( 'an unexpected source commit prevents checkout and cleans the temporary directory', () => {
	const { calls, execute, directory } = fixture( ( command, args ) =>
		args.includes( 'rev-parse' ) ? '0'.repeat( 40 ) : undefined
	);
	assert.throws(
		() => buildImage( 'wordpress:php8.4', hostedRunner, execute ),
		/source commit verification failed/
	);
	assert.equal(
		calls.some( ( call ) => call.includes( 'checkout' ) ),
		false
	);
	assert.equal( existsSync( directory() ), false );
} );

test( 'the complete verified context is built locally and cleaned afterward', () => {
	const recipe = getRecipe( 'wordpress:php8.4' );
	let built = false;
	const { calls, execute, directory } = fixture( ( command, args ) => {
		if ( command === 'docker' && args[ 0 ] === 'build' ) {
			built = true;
			assert.equal(
				args[ args.indexOf( '--tag' ) + 1 ],
				'wordpress:php8.4'
			);
			const context = args.at( -1 );
			assert.equal(
				readFileSync( path.join( context, 'Dockerfile' ), 'utf8' ),
				`FROM ${ recipe.base }\nCOPY docker-entrypoint.sh /usr/local/bin/\n`
			);
			assert.equal(
				readFileSync(
					path.join( context, 'docker-entrypoint.sh' ),
					'utf8'
				),
				'upstream'
			);
		}
	} );
	buildImage( 'wordpress:php8.4', hostedRunner, execute );
	assert.equal( built, true );
	assert.equal(
		calls.some( ( call ) => call.includes( 'push' ) ),
		false
	);
	assert.equal( existsSync( directory() ), false );
} );

for ( const stage of [ 'fetch', 'build' ] ) {
	test( `a failed ${ stage } cleans the temporary directory`, () => {
		const { execute, directory } = fixture( ( command, args ) => {
			if ( args.includes( stage ) ) {
				throw new Error( `${ stage } failed` );
			}
		} );
		assert.throws(
			() => buildImage( 'wordpress:php8.4', hostedRunner, execute ),
			new RegExp( `${ stage } failed` )
		);
		assert.equal( existsSync( directory() ), false );
	} );
}
