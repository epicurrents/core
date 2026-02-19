/**
 * Unit tests for FileSystemDirectory class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import FileSystemDirectory from '../../src/assets/reader/filesystem/FileSystemDirectory'

jest.mock('scoped-event-log', () => ({
    Log: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }
}))

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url')

describe('FileSystemDirectory', () => {
    beforeEach(() => {
        (Log.error as jest.Mock).mockClear()
        ;(global.URL.createObjectURL as jest.Mock).mockClear()
    })

    describe('constructor', () => {
        it('should create a directory with name and path', () => {
            const dir = new FileSystemDirectory('mydir', '/root')
            expect(dir.name).toBe('mydir')
            expect(dir.path).toBe('/root')
            expect(dir.type).toBe('directory')
            expect(dir.directories).toEqual([])
            expect(dir.files).toEqual([])
        })

        it('should have undefined file and url', () => {
            const dir = new FileSystemDirectory('test', '/')
            expect(dir.file).toBeUndefined()
            expect(dir.url).toBeUndefined()
        })
    })

    describe('properties', () => {
        it('should allow setting name', () => {
            const dir = new FileSystemDirectory('old', '/')
            dir.name = 'new'
            expect(dir.name).toBe('new')
        })

        it('should allow setting path', () => {
            const dir = new FileSystemDirectory('dir', '/old')
            dir.path = '/new/path'
            expect(dir.path).toBe('/new/path')
        })

        it('should allow setting directories', () => {
            const dir = new FileSystemDirectory('root', '/')
            const sub = new FileSystemDirectory('sub', '/sub')
            dir.directories = [sub]
            expect(dir.directories).toHaveLength(1)
            expect(dir.directories[0].name).toBe('sub')
        })

        it('should allow setting files', () => {
            const dir = new FileSystemDirectory('root', '/')
            dir.files = [] // Just verify setter works
            expect(dir.files).toEqual([])
        })
    })

    describe('static FilesToFsDirectory', () => {
        it('should create directory from files', () => {
            const file1 = new File(['a'], 'file1.txt')
            const file2 = new File(['b'], 'file2.txt')
            const dir = FileSystemDirectory.FilesToFsDirectory(file1, file2)
            expect(dir.name).toBe('')
            expect(dir.files).toHaveLength(2)
            expect(dir.files[0].name).toBe('file1.txt')
            expect(dir.files[1].name).toBe('file2.txt')
        })

        it('should return empty directory when no files given', () => {
            const dir = FileSystemDirectory.FilesToFsDirectory()
            expect(dir.files).toHaveLength(0)
        })
    })

    describe('static UrlsToFsItem', () => {
        it('should create directory from string URLs', () => {
            const dir = FileSystemDirectory.UrlsToFsItem(
                'https://example.com/file1.txt',
                'https://example.com/file2.csv',
            )
            expect(dir.name).toBe('Remote dir')
            expect(dir.files).toHaveLength(2)
            expect(dir.files[0].name).toBe('file1.txt')
            expect(dir.files[1].name).toBe('file2.csv')
        })

        it('should create directory from URL objects', () => {
            const url = new URL('https://example.com/data.json')
            const dir = FileSystemDirectory.UrlsToFsItem(url)
            expect(dir.files).toHaveLength(1)
            expect(dir.files[0].name).toBe('data.json')
        })

        it('should use fallback name when URL has no filename', () => {
            const dir = FileSystemDirectory.UrlsToFsItem('https://example.com/')
            // URL ends with /, so pop() returns '', fallback to 'Remote file 1'
            expect(dir.files[0].name).toBe('Remote file 1')
        })
    })

    describe('static FileListToFsDirectory', () => {
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
            // Non-enumerable so Object.values() only gets the File objects
            Object.defineProperty(list, 'length', { value: files.length, enumerable: false })
            Object.defineProperty(list, 'item', { value: (i: number) => files[i] || null, enumerable: false })
            return list as FileList
        }

        it('should return empty directory for empty FileList', () => {
            const fileList = makeFileList([])
            const dir = FileSystemDirectory.FileListToFsDirectory(fileList)
            expect(dir.name).toBe('')
            expect(dir.files).toHaveLength(0)
        })

        it('should create flat directory from simple file list', () => {
            const fileList = makeFileList([
                { name: 'a.txt', webkitRelativePath: 'root/a.txt' },
                { name: 'b.txt', webkitRelativePath: 'root/b.txt' },
            ])
            const dir = FileSystemDirectory.FileListToFsDirectory(fileList)
            expect(dir.name).toBe('root')
            expect(dir.files).toHaveLength(2)
        })

        it('should create nested directory structure', () => {
            const fileList = makeFileList([
                { name: 'deep.txt', webkitRelativePath: 'root/sub1/sub2/deep.txt' },
            ])
            const dir = FileSystemDirectory.FileListToFsDirectory(fileList)
            expect(dir.name).toBe('root')
            expect(dir.directories).toHaveLength(1)
            expect(dir.directories[0].name).toBe('sub1')
            expect(dir.directories[0].directories).toHaveLength(1)
            expect(dir.directories[0].directories[0].name).toBe('sub2')
            expect(dir.directories[0].directories[0].files).toHaveLength(1)
        })

        it('should reuse existing directories for shared paths', () => {
            const fileList = makeFileList([
                { name: 'a.txt', webkitRelativePath: 'root/sub/a.txt' },
                { name: 'b.txt', webkitRelativePath: 'root/sub/b.txt' },
            ])
            const dir = FileSystemDirectory.FileListToFsDirectory(fileList)
            expect(dir.directories).toHaveLength(1)
            expect(dir.directories[0].files).toHaveLength(2)
        })

        it('should log error for files without webkitRelativePath', () => {
            const fileList = makeFileList([
                { name: 'a.txt', webkitRelativePath: '' },
            ])
            FileSystemDirectory.FileListToFsDirectory(fileList)
            expect(Log.error).toHaveBeenCalled()
        })

        it('should skip files with invalid paths (less than 2 elements)', () => {
            const fileList = makeFileList([
                { name: 'a.txt', webkitRelativePath: 'nodir' },
                { name: 'b.txt', webkitRelativePath: 'root/b.txt' },
            ])
            const dir = FileSystemDirectory.FileListToFsDirectory(fileList)
            expect(Log.error).toHaveBeenCalled()
            expect(dir.files).toHaveLength(1)
        })
    })
})
