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
            'ASSETS': path.resolve(__dirname, 'src/assets/'),
            'CONFIG': path.resolve(__dirname, 'src/config/'),
            'ROOT': path.resolve(__dirname, './'),
            'RUNTIME': path.resolve(__dirname, 'src/runtime/'),
            'TYPES': path.resolve(__dirname, 'src/types/'),
            'UTIL': path.resolve(__dirname, 'src/util/'),
        },
        symlinks: false
    },
}
