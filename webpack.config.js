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
            '#root': path.resolve(__dirname, './'),
            '#': path.resolve(__dirname, 'src/'),
        },
        symlinks: false
    },
}
