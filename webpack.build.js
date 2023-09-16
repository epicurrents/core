const webpack = require('webpack')
const path = require('path')
const { merge } = require('webpack-merge')
const common = require('./webpack.config.js')
const TerserPlugin = require('terser-webpack-plugin')
const dotenv = require('dotenv').config()

const ASSET_PATH = process.env.ASSET_PATH || '/static/'

module.exports = merge(common, {
    mode: 'production',
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'build', 'static'),
        publicPath: ASSET_PATH,
        filename: '[name].min.js',
        chunkFilename: '[name].chunk.min.js',
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
        new dotenv(),
        new webpack.DefinePlugin({
            // Workaround for __VUE_PROD_DEVTOOLS__ is not defined error
            __VUE_PROD_DEVTOOLS__: true,
        }),
    ],
})
