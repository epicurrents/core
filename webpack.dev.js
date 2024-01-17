const path = require('path')
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const CircularDependencyPlugin = require('circular-dependency-plugin')

const ASSET_PATH = '/'
const ROOT_PATH = '/'

module.exports = {
    mode: 'development',
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
        port: 8081,
        static: {
            directory: path.join(__dirname, 'dev'),
            publicPath: ROOT_PATH,
        },
    },
    output: {
        path: path.resolve(__dirname, 'dev'),
        publicPath: ASSET_PATH,
        filename: '[name].js',
        chunkFilename: '[name].js?v=[contenthash]',
        library: 'EpiCurrentsCore',
        libraryTarget: 'umd'
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
        })
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
        errorDetails: true
    },
}