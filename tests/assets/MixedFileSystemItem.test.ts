/**
 * Unit tests for MixedFileSystemItem class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import MixedFileSystemItem from '../../src/assets/reader/filesystem/MixedFileSystemItem'

jest.mock('scoped-event-log', () => ({
    Log: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }
}))

global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url')

describe('MixedFileSystemItem', () => {
    beforeEach(() => {
        (Log.error as jest.Mock).mockClear()
        ;(global.URL.createObjectURL as jest.Mock).mockClear()
    })

    describe('constructor', () => {
        it('should create a file item', () => {
            const item = new MixedFileSystemItem('test.txt', '/path', 'file')
            expect(item.name).toBe('test.txt')
            expect(item.path).toBe('/path')
            expect(item.type).toBe('file')
            expect(item.file).toBeUndefined()
            expect(item.url).toBeUndefined()
        })

        it('should create a directory item', () => {
            const item = new MixedFileSystemItem('mydir', '/root', 'directory')
            expect(item.type).toBe('directory')
            expect(item.directories).toEqual([])
            expect(item.files).toEqual([])
        })

        it('should accept file and url parameters', () => {
            const file = new File(['data'], 'test.txt')
            const item = new MixedFileSystemItem('test.txt', '/', 'file', file, 'https://example.com/test.txt')
            expect(item.file).toBe(file)
            expect(item.url).toBe('https://example.com/test.txt')
        })
    })

    describe('properties', () => {
        it('should allow setting name', () => {
            const item = new MixedFileSystemItem('old', '/', 'file')
            item.name = 'new'
            expect(item.name).toBe('new')
        })

        it('should allow setting path', () => {
            const item = new MixedFileSystemItem('test', '/old', 'file')
            item.path = '/new'
            expect(item.path).toBe('/new')
        })

        it('should allow setting file', () => {
            const item = new MixedFileSystemItem('test', '/', 'file')
            const file = new File(['data'], 'test.txt')
            item.file = file
            expect(item.file).toBe(file)
        })

        it('should allow setting url', () => {
            const item = new MixedFileSystemItem('test', '/', 'file')
            item.url = 'https://example.com'
            expect(item.url).toBe('https://example.com')
        })

        it('should allow setting directories and files arrays', () => {
            const dir = new MixedFileSystemItem('root', '/', 'directory')
            const sub = new MixedFileSystemItem('sub', '/sub', 'directory')
            const file = new MixedFileSystemItem('f.txt', '/', 'file')
            dir.directories = [sub]
            dir.files = [file]
            expect(dir.directories).toHaveLength(1)
            expect(dir.files).toHaveLength(1)
        })
    })

    describe('static FilesToFsItem', () => {
        it('should create a file item from a single file', () => {
            const file = new File(['data'], 'single.txt')
            const item = MixedFileSystemItem.FilesToFsItem(file)
            expect(item.type).toBe('file')
            expect(item.name).toBe('single.txt')
            expect(item.file).toBe(file)
            expect(item.url).toBe('blob:mock-url')
        })

        it('should create a directory item from multiple files', () => {
            const f1 = new File(['a'], 'a.txt')
            const f2 = new File(['b'], 'b.txt')
            const item = MixedFileSystemItem.FilesToFsItem(f1, f2)
            expect(item.type).toBe('directory')
            expect(item.name).toBe('root')
            expect(item.files).toHaveLength(2)
            expect(item.files[0].name).toBe('a.txt')
            expect(item.files[1].name).toBe('b.txt')
        })
    })

    describe('static UrlsToFsItem', () => {
        it('should create a file item from a single URL string', () => {
            const item = MixedFileSystemItem.UrlsToFsItem('https://example.com/file.txt')
            expect(item.type).toBe('file')
            expect(item.name).toBe('Remote file')
            expect(item.url).toBe('https://example.com/file.txt')
        })

        it('should create a file item from a single URL object', () => {
            const url = new URL('https://example.com/file.txt')
            const item = MixedFileSystemItem.UrlsToFsItem(url)
            expect(item.type).toBe('file')
            expect(item.url).toBe('https://example.com/file.txt')
        })

        it('should create a directory item from multiple URLs', () => {
            const item = MixedFileSystemItem.UrlsToFsItem(
                'https://example.com/a.txt',
                'https://example.com/b.txt',
            )
            expect(item.type).toBe('directory')
            expect(item.name).toBe('Remote dir')
            expect(item.files).toHaveLength(2)
            expect(item.files[0].name).toBe('a.txt')
            expect(item.files[1].name).toBe('b.txt')
        })
    })

    describe('static FileListToFsItem', () => {
        function makeFileList(entries: { name: string, webkitRelativePath: string }[]): FileList {
            const files = entries.map(e => {
                const f = new File([''], e.name)
                Object.defineProperty(f, 'webkitRelativePath', { value: e.webkitRelativePath })
                return f
            })
            const list = {} as any
            for (let i = 0; i < files.length; i++) {
                list[i] = files[i]
            }
            Object.defineProperty(list, 'length', { value: files.length, enumerable: false })
            Object.defineProperty(list, 'item', { value: (i: number) => files[i] || null, enumerable: false })
            return list as FileList
        }

        it('should return empty directory for empty FileList', () => {
            const fileList = makeFileList([])
            const item = MixedFileSystemItem.FileListToFsItem(fileList)
            expect(item.type).toBe('directory')
            expect(item.files).toHaveLength(0)
        })

        it('should create flat structure from simple file list', () => {
            const fileList = makeFileList([
                { name: 'a.txt', webkitRelativePath: 'root/a.txt' },
                { name: 'b.txt', webkitRelativePath: 'root/b.txt' },
            ])
            const item = MixedFileSystemItem.FileListToFsItem(fileList)
            expect(item.name).toBe('root')
            expect(item.files).toHaveLength(2)
        })

        it('should create nested directories', () => {
            const fileList = makeFileList([
                { name: 'deep.txt', webkitRelativePath: 'root/sub/deep.txt' },
            ])
            const item = MixedFileSystemItem.FileListToFsItem(fileList)
            expect(item.directories).toHaveLength(1)
            expect(item.directories[0].name).toBe('sub')
            expect(item.directories[0].files).toHaveLength(1)
        })

        it('should log error for missing webkitRelativePath', () => {
            const fileList = makeFileList([
                { name: 'a.txt', webkitRelativePath: '' },
            ])
            MixedFileSystemItem.FileListToFsItem(fileList)
            expect(Log.error).toHaveBeenCalled()
        })
    })
})
