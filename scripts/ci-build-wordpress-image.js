#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, console is its output. */
const { execFileSync } = require( 'node:child_process' );
const {
	mkdtempSync,
	readFileSync,
	writeFileSync,
	rmSync,
} = require( 'node:fs' );
const { tmpdir } = require( 'node:os' );
const path = require( 'node:path' );
const { assertPhpVersion } = require( './check-php-version' );

// Official WordPress source revisions from docker-library/official-images/library/wordpress.
const sourceCommits = {
	apache: '5ec12a3ef21493a12f3d211e0d69d0c6a30a9794',
	alpine: '27edf122404ed2b503604eedc5f171e79fa019bf',
};

// Both Linux amd64 and arm64 manifests were verified on October 21, 2026.
const phpBases = {
	8.2: {
		version: '8.2.35',
		apache: 'sha256:9e5766bc6f10979a782e11e883837f9ef35a344dbc1a9d0628a2307e8c21f9da',
		alpine: 'sha256:991b0d92a3c405629a80ee58019d215876e1b478523134d2ca91f2d5f6c2d89c',
	},
	8.3: {
		version: '8.3.36',
		apache: 'sha256:d89e8b3d2033c3179dcd9999d913670eb12a07410a95e60205c64e7d0fac7aef',
		alpine: 'sha256:bb27e1707a571d43413b6e3ad2f670fb9665782162779d26cb01be499f6ceef5',
	},
	8.4: {
		version: '8.4.27',
		apache: 'sha256:e6bad969f0b673ce9121c88dabb53488ab1ca139d8ebfac1d1b1ab63f245f725',
		alpine: 'sha256:bccf6e169aaeb823e3d8d925a257629d3c5f7944b1ffa859e986b730bdb94193',
	},
	8.5: {
		version: '8.5.12',
		apache: 'sha256:4d1f268dd3b670bd003861c5385cb2f8ba7196dbc88ee84dcae47270c116f242',
		alpine: 'sha256:eef5baa8671b37f2909d4b2f1849ea663df6ff4fe8936f102208ce54f1e32e01',
	},
};

function getRecipe( image ) {
	const match = /^wordpress:(cli-)?php(8\.[2-5])$/.exec( image );
	if ( ! match || match[ 0 ] !== image ) {
		throw new Error( `Unsupported WordPress image: ${ image }` );
	}
	const [ , cli, series ] = match;
	const variant = cli ? 'alpine' : 'apache';
	const php = phpBases[ series ];
	return {
		series,
		commit: sourceCommits[ variant ],
		directory: `${ cli ? 'cli' : 'latest' }/php${ series }/${ variant }`,
		originalBase: `php:${ series }-${ variant }`,
		base: `php:${ php.version }-${ cli ? 'cli-alpine' : 'apache' }@${
			php[ variant ]
		}`,
	};
}

function pinBase( dockerfile, recipe ) {
	const stages = dockerfile.match( /^[\t ]*FROM[\t ]+[^\r\n]*$/gim ) || [];
	if (
		stages.length !== 1 ||
		stages[ 0 ].trim() !== `FROM ${ recipe.originalBase }`
	) {
		throw new Error( 'Unexpected FROM in the official WordPress recipe.' );
	}
	return dockerfile.replace( stages[ 0 ], `FROM ${ recipe.base }` );
}

function run( command, args, capture = false ) {
	return execFileSync( command, args, {
		encoding: 'utf8',
		stdio: [ 'ignore', capture ? 'pipe' : 'inherit', 'inherit' ],
	} );
}

function buildImage( image, environment = process.env, execute = run ) {
	if (
		environment.GITHUB_ACTIONS !== 'true' ||
		environment.RUNNER_ENVIRONMENT !== 'github-hosted'
	) {
		throw new Error(
			'WordPress image reconstruction is restricted to disposable GitHub-hosted CI runners.'
		);
	}
	const recipe = getRecipe( image );
	execute( 'docker', [ 'pull', recipe.base ] );
	const version = execute(
		'docker',
		[
			'run',
			'--rm',
			'--network',
			'none',
			'--entrypoint',
			'php',
			recipe.base,
			'-r',
			'echo PHP_VERSION;',
		],
		true
	);
	assertPhpVersion( version, recipe.base, recipe.series );

	const directory = mkdtempSync(
		path.join( tmpdir(), 'wordpress-ci-build-' )
	);
	try {
		execute( 'git', [ 'init', '--quiet', directory ] );
		execute( 'git', [
			'-C',
			directory,
			'fetch',
			'--quiet',
			'--depth=1',
			'https://github.com/docker-library/wordpress.git',
			recipe.commit,
		] );
		const commit = execute(
			'git',
			[ '-C', directory, 'rev-parse', 'FETCH_HEAD' ],
			true
		).trim();
		if ( commit !== recipe.commit ) {
			throw new Error( 'WordPress source commit verification failed.' );
		}
		execute( 'git', [
			'-C',
			directory,
			'checkout',
			'--quiet',
			'--detach',
			recipe.commit,
		] );
		const context = path.join( directory, recipe.directory );
		const dockerfile = path.join( context, 'Dockerfile' );
		writeFileSync(
			dockerfile,
			pinBase( readFileSync( dockerfile, 'utf8' ), recipe )
		);
		console.log(
			`Rebuilding ${ image } from official WordPress source ${ commit } with ${ recipe.base } for this CI runner only.`
		);
		// wp-env hardcodes these tags; the replacement exists only on this disposable runner.
		execute( 'docker', [ 'build', '--pull', '--tag', image, context ] );
	} finally {
		rmSync( directory, { recursive: true, force: true } );
	}
}

if ( require.main === module ) {
	try {
		if ( process.argv.length !== 3 ) {
			throw new Error(
				'Usage: node scripts/ci-build-wordpress-image.js wordpress:[cli-]php8.x'
			);
		}
		buildImage( process.argv[ 2 ] );
	} catch ( error ) {
		console.error( error.message );
		process.exitCode = 1;
	}
}

module.exports = { getRecipe, pinBase, buildImage };
