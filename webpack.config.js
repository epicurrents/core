const path = require('path')
const { VueLoaderPlugin } = require('vue-loader')

module.exports = {
    entry: {
        'epicurrents-core': { import: path.join(__dirname, 'src', 'index.ts') },
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
    optimization: {
        runtimeChunk: {
            name: 'shared',
        },
    },
    plugins: [
        new VueLoaderPlugin(),
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
    stats: {
        warningsFilter: [
            /* This suppresses an annoying "Critical dependency: the request of a dependency is an expression" warning */
            './node_modules/pyodide/load-pyodide.js'
        ]
    }
}
