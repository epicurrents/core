const path = require('path')
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
            use: 'ts-loader',
            exclude: /node_modules/,
        },
        ],
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin(),
        ],
    },
    output: {
        path: path.resolve(__dirname, 'umd'),
        library: "EpiCurrentsLib"
    },
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
        },
        symlinks: false
    },
}