const path = require('path')

module.exports = {
    entry: {
        'index': { import: path.join(__dirname, 'src', 'index.ts') },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: "ts-loader",
                exclude: /node_modules/,
                options: {
                    appendTsSuffixTo: [/\.vue$/]
                }
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
            'CONFIG': path.resolve(__dirname, 'src/config/'),
            'CORE': path.resolve(__dirname, 'src/core/'),
            'ROOT': path.resolve(__dirname, './'),
            'RUNTIME': path.resolve(__dirname, 'src/runtime/'),
            'SRC': path.resolve(__dirname, 'src/'),
            'TYPES': path.resolve(__dirname, 'types/'),
            'UTIL': path.resolve(__dirname, 'src/util/'),
        },
        symlinks: false
    },
}
