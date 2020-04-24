'use strict';

const pkg = require('../package.json');
const fs = require('fs');
const webpack = require('webpack');
const path = require('path');
const sass = require('sass');
const fibers = require('fibers');
const autoPrefix = require('autoprefixer');
const sortQueries = require('postcss-sort-media-queries');
const PluginCopy = require('copy-webpack-plugin');
const PluginStyleLint = require('stylelint-webpack-plugin');
const PluginCSSExtract = require('extract-css-chunks-webpack-plugin');
const PluginOptimizeCSS = require('optimize-css-assets-webpack-plugin');
const PluginIgnoreEmit = require('ignore-emit-webpack-plugin');

// TO DO:
// * allow configuring src/dist directories
// * allow configuring css global/module directories
// * improve error handling and options validation
// * make use of webpack.DefinePlugin for inserting user package name/version
// * allow specifying ts-loader compilerOptions like aliases, target, module (and maybe lib?)

const VALID_FILE_EXTENSIONS = [ '.ts', '.tsx', '.js', '.jsx', '.scss', '.css' ];
const FILE_EXTENSION_REGEX = /\.[0-9a-z]+$/i;

const SOURCE_DIRECTORY = path.resolve('.', 'src');
const OUTPUT_DIRECTORY = path.resolve('.', 'dist');
const CSS_GLOBAL_DIRECTORIES = [ path.resolve(SOURCE_DIRECTORY, 'styles') ];
const CSS_MODULE_DIRECTORIES = [ path.resolve(SOURCE_DIRECTORY, 'components') ];
const LIB_PATH = path.resolve('node_modules', pkg.name, 'lib');
const POLYFILLS_MODULE = 'core-js/stable';

let ESLINT_CONFIG_PATH = path.resolve(LIB_PATH, '.eslintrc');
let STYLELINT_CONFIG_PATH = path.resolve(LIB_PATH, '.stylelintrc');
let TS_CONFIG_PATH = path.resolve(LIB_PATH, 'tsconfig.json');
let BABEL_CONFIG_PATH = path.resolve(LIB_PATH, 'babel.config.js');

const defineEntry = (usePolyfills, entryFilename) => ({ entry: usePolyfills ? [ POLYFILLS_MODULE, entryFilename ] : [ entryFilename ] });

const defineOutput = scriptOutputFilename => ({ output: { path: OUTPUT_DIRECTORY, filename: scriptOutputFilename } });

const commonSettings = (devMode, aliases) => ({
    mode: devMode ? 'development' : 'production',
    context: SOURCE_DIRECTORY,
    resolve: {
		extensions: [ '.ts', '.tsx', '.js', '.jsx' ],
		alias: (() => {
            const map = {};
            Object.entries(aliases).forEach(([key, value]) => map[key] = path.resolve(SOURCE_DIRECTORY, value))
            return map;
        })(),
	},
    devtool: devMode ? 'eval' : false, // Script source maps
    performance: { hints: devMode ? false : 'warning' },
    stats: 'normal',
});

const devServerSettings = (devMode, useHttps, allowCors) => ({
    devServer: {
		contentBase: OUTPUT_DIRECTORY,
		hot: devMode,
        historyApiFallback: true,
        https: useHttps,
        headers: allowCors ? { 'Access-Control-Allow-Origin': '*' } : {},
	},
});

const rulesForScripts = (devMode, nodeModulesToBabel, usePolyfills, skipLinting, eslintConfigPath, babelConfigPath, tsConfigPath) => ([
    skipLinting ? {} : {
        test: /\.(tsx?|jsx?)$/,
        loader: 'eslint-loader',
        enforce: 'pre',
        include: [
            SOURCE_DIRECTORY,
        ],
        options: {
            configFile: eslintConfigPath || ESLINT_CONFIG_PATH,
            fix: true,
        },
    },
    {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
            configFile: tsConfigPath || TS_CONFIG_PATH,
            transpileOnly: true,
            compilerOptions: {
                baseUrl: SOURCE_DIRECTORY,
                outDir: OUTPUT_DIRECTORY,
                module: usePolyfills ? 'commonjs' : 'es6',
            },
        },
    },
    {
        test: /\.jsx$/,
        loader: 'babel-loader',
        include: [ SOURCE_DIRECTORY, ...nodeModulesToBabel ],
        options: { configFile: babelConfigPath || BABEL_CONFIG_PATH },
    },
]);

const styleLoaders = (devMode, useModuleLoaders) => ([
    {
        loader: PluginCSSExtract.loader,
        options: { hot: devMode },
    },
    {
        loader: 'css-loader',
        options: !useModuleLoaders ? { url: false } : {
            modules: true,
            url: false,
            localsConvention: 'camelCaseOnly',
        },
    },
    {
        loader: 'postcss-loader',
        options: { plugins: [ autoPrefix(), sortQueries() ] },
    },
    {
        loader: 'sass-loader',
        options: {
            implementation: sass,
            prependData: `$env: ${devMode ? 'dev' : 'prod'};`,
            sassOptions: { fiber: fibers },
        },
    },
])

const rulesForStyles = (devMode, useCssModules) => useCssModules ? [
    { test: /\.(scss|css)$/, include: [ CSS_MODULE_DIRECTORIES ], use: styleLoaders(devMode, true) },
    { test: /\.(scss|css)$/, include: [ CSS_GLOBAL_DIRECTORIES ], use: styleLoaders(devMode, false) },
] : [ { test: /\.(scss|css)$/, include: [ SOURCE_DIRECTORY ], use: styleLoaders(devMode, false) } ];

const pluginCopyFiles = (...pathObjects) => new PluginCopy(pathObjects.map(({ from, to }) => ({ from: path.resolve(SOURCE_DIRECTORY, from), to: path.resolve(OUTPUT_DIRECTORY, to) })), { info: true });

const pluginIgnoreOutput = (...filenames) => new PluginIgnoreEmit(filenames);

const pluginLintStyles = stylelintConfigPath => new PluginStyleLint({ configFile: stylelintConfigPath || STYLELINT_CONFIG_PATH, fix: true, allowEmptyInput: true });

const pluginExtractStyles = styleOutputFilename => new PluginCSSExtract({ filename: styleOutputFilename, chunkFilename: '[id].css' });

const pluginOptimizeStyles = devMode => new PluginOptimizeCSS({
    cssProcessorOptions: {
        minimize: !devMode,
        map: devMode ? { inline: false, annotation: true } : undefined, // Style source maps
    },
});

const generateConfig = ({
    entryFile,
    scriptOutputFilename,
    styleOutputFilename,
    devMode,
    useCssModules,
    aliases,
    nodeModulesToBabel,
    plugins,
    ignoredOutputFiles,
    usePolyfills,
    skipLinting,
    eslintConfigPath,
    stylelintConfigPath,
    babelConfigPath,
    tsConfigPath,
    useHttps,
    allowCors,
}) => ({
    ...defineEntry(usePolyfills, entryFile),
    ...defineOutput(scriptOutputFilename),
    ...commonSettings(devMode, aliases),
    ...devServerSettings(devMode, useHttps, allowCors),
    module: {
        rules: [
            ...rulesForScripts(devMode, nodeModulesToBabel, usePolyfills, skipLinting, eslintConfigPath, babelConfigPath, tsConfigPath),
            ...rulesForStyles(devMode, useCssModules, stylelintConfigPath),
        ],
    },
    plugins: [
        skipLinting ? () => {} : pluginLintStyles(stylelintConfigPath),
        pluginExtractStyles(styleOutputFilename),
        pluginOptimizeStyles(devMode),
        fs.existsSync(path.resolve(SOURCE_DIRECTORY, 'index.html')) ? pluginCopyFiles({ from: 'index.html', to: 'index.html' }) : () => {},
        pluginIgnoreOutput(ignoredOutputFiles),
        // new webpack.DefinePlugin({ 'testKey': 'test1' }),
        ...plugins,
    ],
});

const webpackConfig = ({
    argv,
    entries,
    aliases = {},
    nodeModulesToBabel = [],
    useHttps = true,
    allowCors = false,
    eslintConfigPath = null,
    stylelintConfigPath = null,
    babelConfigPath = null,
    tsConfigPath = null,
    env,
}) => {
    try {
        if (env) {
            throw new Error('You passed the env prop to createWebpackConfig. Did you mean to pass argv?')
        }

        const devMode = argv === undefined || argv.prod === undefined;
        const analyzeMode = argv && argv.analyze !== undefined;
        nodeModulesToBabel = nodeModulesToBabel.map(moduleName => path.resolve('.', 'node_modules', moduleName));
        ESLINT_CONFIG_PATH = eslintConfigPath ? eslintConfigPath : ESLINT_CONFIG_PATH;
        STYLELINT_CONFIG_PATH = stylelintConfigPath ? stylelintConfigPath : STYLELINT_CONFIG_PATH;
        BABEL_CONFIG_PATH = babelConfigPath ? babelConfigPath : BABEL_CONFIG_PATH;
        TS_CONFIG_PATH = tsConfigPath ? tsConfigPath : TS_CONFIG_PATH;

        return Object.entries(entries).map(([ outputFilename, entryConfig ]) => {
            const {
                file: entryFile,
                plugins = [],
                useCssModules = false,
                usePolyfills = false,
                skipLinting = false,
                eslintConfigPath = null,
                stylelintConfigPath = null,
                babelConfigPath = null,
                tsConfigPath = null,
            } = entryConfig;
            let { scriptOutputFilename = null, styleOutputFilename = null } = entryConfig;
            const fileExtensionMatches = entryFile.match(FILE_EXTENSION_REGEX);
            const fileExtension = fileExtensionMatches[0];

            if (!fileExtensionMatches || !VALID_FILE_EXTENSIONS.includes(fileExtension)) {
                throw new Error(`Invalid file extension "${fileExtension}" in entry with key ${outputFilename}: ${entryConfig}`);
            }

            if (!Array.isArray(plugins)) {
                throw new Error(`Invalid plugins format in entry with key ${outputFilename}:\n\n${JSON.stringify(plugins)}`);
            }

            const isStyleEntryFile = fileExtension === '.scss' || fileExtension === '.css';
            scriptOutputFilename = scriptOutputFilename ? `${scriptOutputFilename.replace(FILE_EXTENSION_REGEX, '')}.js` : `${outputFilename}.js`;
            styleOutputFilename = styleOutputFilename ? `${styleOutputFilename.replace(FILE_EXTENSION_REGEX, '')}.css` : `${outputFilename}.css`;
            const ignoredOutputFiles = isStyleEntryFile ? [ scriptOutputFilename ] : [];

            return generateConfig({
                entryFile,
                scriptOutputFilename,
                styleOutputFilename,
                devMode,
                aliases,
                useCssModules,
                nodeModulesToBabel,
                plugins,
                ignoredOutputFiles,
                usePolyfills,
                skipLinting,
                eslintConfigPath,
                stylelintConfigPath,
                babelConfigPath,
                tsConfigPath,
                useHttps,
                allowCors,
            });
        });
    }
    catch (error) {
        console.error('\n\n\x1b[31m%s\x1b[0m', error, '\n\n');
        process.exit(1)
    }
};

module.exports = {
    defineEntry,
    defineOutput,
    commonSettings,
    devServerSettings,
    rulesForScripts,
    rulesForStyles,
    pluginCopyFiles,
    pluginIgnoreOutput,
    pluginLintStyles,
    pluginExtractStyles,
    pluginOptimizeStyles,
    generateConfig,
    webpackConfig,
};
