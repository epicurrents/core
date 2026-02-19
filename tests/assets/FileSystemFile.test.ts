/**
 * Unit tests for FileSystemFile class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import FileSystemFile from '../../src/assets/reader/filesystem/FileSystemFile'

// Mock URL.createObjectURL
const mockCreateObjectURL = jest.fn().mockReturnValue('blob:mock-url')
global.URL.createObjectURL = mockCreateObjectURL

describe('FileSystemFile', () => {
    beforeEach(() => {
        mockCreateObjectURL.mockClear()
    })

    describe('constructor', () => {
        it('should create from a File object', () => {
            const file = new File(['content'], 'test.txt', { type: 'text/plain' })
            const fsFile = new FileSystemFile('test.txt', '/path', file)
            expect(fsFile.name).toBe('test.txt')
            expect(fsFile.path).toBe('/path')
            expect(fsFile.file).toBe(file)
            expect(fsFile.url).toBe('blob:mock-url')
            expect(fsFile.type).toBe('file')
        })

        it('should use provided URL when File and URL are given', () => {
            const file = new File(['content'], 'test.txt')
            const fsFile = new FileSystemFile('test.txt', '/path', file, 'https://example.com/test.txt')
            expect(fsFile.file).toBe(file)
            expect(fsFile.url).toBe('https://example.com/test.txt')
            expect(mockCreateObjectURL).not.toHaveBeenCalled()
        })

        it('should create from a URL object', () => {
            const url = new URL('https://example.com/file.txt')
            const fsFile = new FileSystemFile('file.txt', '/remote', url)
            expect(fsFile.name).toBe('file.txt')
            expect(fsFile.url).toBe('https://example.com/file.txt')
            expect(fsFile.file).toBeUndefined()
        })

        it('should create from a string URL', () => {
            const fsFile = new FileSystemFile('file.txt', '/remote', 'https://example.com/file.txt')
            expect(fsFile.url).toBe('https://example.com/file.txt')
            expect(fsFile.file).toBeUndefined()
        })
    })

    describe('static FileToFsFile', () => {
        it('should create a FileSystemFile from a File', () => {
            const file = new File(['data'], 'report.pdf', { type: 'application/pdf' })
            const fsFile = FileSystemFile.FileToFsFile(file)
            expect(fsFile.name).toBe('report.pdf')
            expect(fsFile.path).toBe('')
            expect(fsFile.file).toBe(file)
            expect(fsFile.url).toBe('blob:mock-url')
        })
    })

    describe('static UrlToFsFile', () => {
        it('should create a FileSystemFile from a string URL', () => {
            const fsFile = FileSystemFile.UrlToFsFile('https://example.com/data.csv')
            expect(fsFile.name).toBe('Remote file')
            expect(fsFile.path).toBe('')
            expect(fsFile.url).toBe('https://example.com/data.csv')
        })

        it('should create a FileSystemFile from a URL object', () => {
            const url = new URL('https://example.com/data.csv')
            const fsFile = FileSystemFile.UrlToFsFile(url)
            expect(fsFile.name).toBe('Remote file')
            expect(fsFile.url).toBe('https://example.com/data.csv')
        })
    })

    describe('properties', () => {
        it('should return empty arrays for directories and files', () => {
            const fsFile = new FileSystemFile('test.txt', '/', 'https://example.com/test.txt')
            expect(fsFile.directories).toEqual([])
            expect(fsFile.files).toEqual([])
        })

        it('should allow setting name', () => {
            const fsFile = new FileSystemFile('old.txt', '/', 'https://example.com')
            fsFile.name = 'new.txt'
            expect(fsFile.name).toBe('new.txt')
        })

        it('should allow setting path', () => {
            const fsFile = new FileSystemFile('test.txt', '/old', 'https://example.com')
            fsFile.path = '/new/path'
            expect(fsFile.path).toBe('/new/path')
        })

        it('should allow setting file', () => {
            const fsFile = new FileSystemFile('test.txt', '/', 'https://example.com')
            const file = new File(['data'], 'test.txt')
            fsFile.file = file
            expect(fsFile.file).toBe(file)
        })

        it('should allow setting url', () => {
            const fsFile = new FileSystemFile('test.txt', '/', 'https://example.com')
            fsFile.url = 'https://other.com/file.txt'
            expect(fsFile.url).toBe('https://other.com/file.txt')
        })

        it('should allow setting file to undefined', () => {
            const file = new File(['data'], 'test.txt')
            const fsFile = new FileSystemFile('test.txt', '/', file)
            fsFile.file = undefined
            expect(fsFile.file).toBeUndefined()
        })
    })
})
