const path = require('path')
require('dotenv').config()

const ASSET_PATH = process.env.ASSET_PATH || '/epicurrents/'

module.exports = {
    mode: 'production',
    entry: {
        'epicurrents':       { import: path.join(__dirname, 'src', 'index.ts') },
        'montage.worker':    { import: path.join(__dirname, 'src', 'workers', 'montage.worker.ts') },
        'memory-manager.worker': { import: path.join(__dirname, 'src', 'workers', 'memory-manager.worker.ts') },
        'trend.worker':      { import: path.join(__dirname, 'src', 'workers', 'trend.worker.ts') },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: '/node_modules/',
                use: {
                    loader: 'ts-loader',
                    options: {
                        // Suppress declaration-file emit during the webpack pass.
                        // Full type-checking and .d.ts generation are handled by build:tsc.
                        transpileOnly: true,
                    },
                },
            },
        ],
    },
    optimization: {
        minimize: true,
        splitChunks: false,
    },
    output: {
        path: path.resolve(__dirname, 'umd'),
        publicPath: ASSET_PATH,
        library: 'EpiCCore',
        libraryTarget: 'umd',
    },
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '#root': path.resolve(__dirname, './'),
            '#assets': path.resolve(__dirname, 'src', 'assets'),
            '#config': path.resolve(__dirname, 'src', 'config'),
            '#errors': path.resolve(__dirname, 'src', 'errors'),
            '#events': path.resolve(__dirname, 'src', 'events'),
            '#onnx': path.resolve(__dirname, 'src', 'onnx'),
            '#plots': path.resolve(__dirname, 'src', 'plots'),
            '#pyodide': path.resolve(__dirname, 'src', 'pyodide'),
            '#runtime': path.resolve(__dirname, 'src', 'runtime'),
            '#types': path.resolve(__dirname, 'src', 'types'),
            '#util': path.resolve(__dirname, 'src', 'util'),
        },
        symlinks: true
    },
}
