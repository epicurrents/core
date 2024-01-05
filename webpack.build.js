const path = require('path')
const { merge } = require('webpack-merge')
const common = require('./webpack.config.js')
const TerserPlugin = require('terser-webpack-plugin')
const Dotenv = require('dotenv-webpack')

const ASSET_PATH = process.env.ASSET_PATH || '/'

module.exports = merge(common, {
    mode: 'production',
    devtool: 'source-map',
    entry: {
        'index': { import: path.join(__dirname, 'src', 'index.ts') },
    },
    output: {
        path: path.resolve(__dirname, 'umd'),
        publicPath: ASSET_PATH,
        filename: '[name].min.js',
        chunkFilename (chunkData) {
            const outDir = chunkData.chunk.name?.endsWith('-worker') ? 'workers/' : 'chunks/'
            return `${outDir}[name].min.js`
        },
        library: '[name]',
        libraryTarget: 'umd'
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin(),
        ],
    },
    plugins: [
        new Dotenv(),
    ],
})
