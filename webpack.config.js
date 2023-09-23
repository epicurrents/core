const path = require('path')

module.exports = {
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.py$/,
                loader: 'raw-loader',
                options: {
                    name: '[path][name].[ext]?[hash]'
                }
            },
        ]
    },
    experiments: {
        topLevelAwait: true,
    },
    ignoreWarnings: [
        /* This suppresses an annoying warning in load-pyodide.js */
        { message: new RegExp("Critical dependency: the request of a dependency is an expression") },
    ],
    optimization: {
        runtimeChunk: {
            name: 'shared',
        },
    },
    plugins: [
    ],
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '@': path.resolve(__dirname, 'src/'),
            '#assets': path.resolve(__dirname, 'src/assets/'),
            '#config': path.resolve(__dirname, 'src/config/'),
            '#root': path.resolve(__dirname, './'),
            '#runtime': path.resolve(__dirname, 'src/runtime/'),
            '#types/': path.resolve(__dirname, 'src/types/'),
            '#util': path.resolve(__dirname, 'src/util/'),
        },
        symlinks: false
    },
}
