const path = require('path')
const TerserPlugin = require('terser-webpack-plugin')

module.exports = {
    mode: 'production',
    entry: {
        'memory-manager.worker': { import: path.join(__dirname, 'src', 'workers', 'memory-manager.worker.ts') },
        'montage.worker': { import: path.join(__dirname, 'src', 'workers', 'montage.worker.ts') },
        'pyodide.worker': { import: path.join(__dirname, 'src', 'workers', 'pyodide.worker.ts') },
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
        path: path.resolve(__dirname, 'umd', 'assets'),
    },
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '#root': path.resolve(__dirname, './'),
            '#assets': path.resolve(__dirname, 'src', 'assets'),
            '#config': path.resolve(__dirname, 'src', 'config'),
            '#pyodide': path.resolve(__dirname, 'src', 'pyodide'),
            '#types': path.resolve(__dirname, 'src', 'types'),
            '#util': path.resolve(__dirname, 'src', 'util'),
        },
        symlinks: false
    },
    stats: {
        children: true
    }
}