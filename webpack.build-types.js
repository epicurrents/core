const path = require('path')
const { merge } = require('webpack-merge')
const common = require('./webpack.config.js')
const Dotenv = require('dotenv-webpack')

const ASSET_PATH = process.env.ASSET_PATH || '/'

module.exports = merge(common, {
    mode: 'production',
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'build', 'types'),
        publicPath: ASSET_PATH,
        filename: '[name].js',
        chunkFilename: '[name].chunk.js',
        library: '[name]',
        libraryTarget: 'umd'
    },
    plugins: [
        new Dotenv(),
    ],
})
