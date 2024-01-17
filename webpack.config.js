const path = require('path')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')

module.exports = {
    mode: 'production',
    entry: {
        'epicurrents': { import: path.join(__dirname, 'src', 'index.ts') },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: 'ts-loader',
            },
        ],
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin(),
        ],
        runtimeChunk: {
            name: 'shared',
        },
    },
    output: {
        path: path.resolve(__dirname, 'umd'),
        library: 'EpiCurrentsCore',
    },
    plugins: [
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1,
        }),
    ],
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '#root': path.resolve(__dirname, './'),
            '#assets': path.resolve(__dirname, 'src', 'assets'),
            '#config': path.resolve(__dirname, 'src', 'config'),
            '#errors': path.resolve(__dirname, 'src', 'errors'),
            '#onnx': path.resolve(__dirname, 'src', 'onnx'),
            '#plots': path.resolve(__dirname, 'src', 'plots'),
            '#pyodide': path.resolve(__dirname, 'src', 'pyodide'),
            '#runtime': path.resolve(__dirname, 'src', 'runtime'),
            '#types': path.resolve(__dirname, 'src', 'types'),
            '#util': path.resolve(__dirname, 'src', 'util'),
            '#workers': path.resolve(__dirname, 'src', 'workers'),
        },
        symlinks: false
    },
    stats: {
        children: true
    }
}