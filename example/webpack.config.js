const { webpackConfig } = require('esnext-build');

module.exports = (env, argv) => webpackConfig({
    argv,
    entries: {
        main: {
            file: 'index.js',
        },
        tstest: {
            file: 'test.ts',
        },
        styletest: {
            file: 'styles/styles.scss',
            useCssModules: true,
        },
    },
    aliases: {
        Styles: 'styles',
        Types: 'types',
    },
});