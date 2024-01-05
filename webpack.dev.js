const path = require('path')
const { merge } = require('webpack-merge')
const common = require('./webpack.config.js')
const Dotenv = require('dotenv-webpack')
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const CircularDependencyPlugin = require('circular-dependency-plugin')

const ASSET_PATH = process.env.ASSET_PATH || '/testing/'
const ROOT_PATH = process.env.ROOT_PATH || '/'

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-cheap-source-map',
    entry: {
        'index': { import: path.join(__dirname, 'src', 'index.ts') },
        'types': { import: path.join(__dirname, 'src', 'types', 'index.ts') },
    },
    output: {
        path: path.resolve(__dirname, 'dev'),
        publicPath: ASSET_PATH,
        filename: '[name].js',
        chunkFilename: '[name].js?v=[contenthash]',
        library: '[name]',
        libraryTarget: 'umd'
    },
    devServer: {
        allowedHosts: 'all',
        client: {
            webSocketURL: 'auto://0.0.0.0:0' + ROOT_PATH + '/ws',
        },
        compress: true,
        headers: {
            // Cross-origin isolation is needed for shared memory buffers.
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        historyApiFallback: true,
        port: 8080,
        static: {
            directory: path.join(__dirname, 'dist'),
            publicPath: ROOT_PATH,
        },
    },
    performance: {
        hints: false
    },
    plugins: [
        new BundleAnalyzerPlugin(),
        new CircularDependencyPlugin({
            // exclude detection of files based on a RegExp
            exclude: /a\.js|node_modules/,
            // include specific files based on a RegExp
            include: /src/,
            // add errors to webpack instead of warnings
            failOnError: true,
            // allow import cycles that include an asyncronous import,
            // e.g. via import(/* webpackMode: "weak" */ './file.js')
            allowAsyncCycles: false,
            // set the current working directory for displaying module paths
            cwd: process.cwd(),
        }),
        new Dotenv()
    ],
    stats: {
        errorDetails: true
    },
    watchOptions: {
        ignored: /node_modules/
    },
})
