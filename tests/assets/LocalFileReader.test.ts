/**
 * Unit tests for LocalFileReader class.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import LocalFileReader from '../../src/assets/reader/LocalFileReader'

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url')

describe('LocalFileReader', () => {
    let reader: LocalFileReader

    beforeEach(() => {
        reader = new LocalFileReader()
    })

    describe('readFilesFromSource', () => {
        it('should return undefined when dataTransfer has no items', async () => {
            const event = {
                stopPropagation: jest.fn(),
                preventDefault: jest.fn(),
                dataTransfer: null,
            } as unknown as DragEvent

            const result = await reader.readFilesFromSource(event)
            expect(result).toBeUndefined()
            expect(event.stopPropagation).toHaveBeenCalled()
            expect(event.preventDefault).toHaveBeenCalled()
        })

        it('should process file entries from dataTransfer items', async () => {
            const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' })
            const mockEntry: Partial<FileSystemFileEntry> = {
                isFile: true,
                isDirectory: false,
                name: 'test.txt',
                file: (resolve: (file: File) => void) => resolve(mockFile),
            }
            const mockItem = {
                webkitGetAsEntry: () => mockEntry,
            }
            const event = {
                stopPropagation: jest.fn(),
                preventDefault: jest.fn(),
                dataTransfer: {
                    items: {
                        length: 1,
                        0: mockItem,
                    },
                },
            } as unknown as DragEvent

            const result = await reader.readFilesFromSource(event)
            expect(result).toBeDefined()
            expect(result!.type).toBe('directory')
            expect(result!.files).toHaveLength(1)
            expect(result!.files[0].name).toBe('test.txt')
            expect(result!.files[0].file).toBe(mockFile)
        })

        it('should process directory entries recursively', async () => {
            const mockFile = new File(['data'], 'inner.txt')
            const mockFileEntry: Partial<FileSystemFileEntry> = {
                isFile: true,
                isDirectory: false,
                name: 'inner.txt',
                file: (resolve: (file: File) => void) => resolve(mockFile),
            }
            const mockDirEntry: Partial<FileSystemDirectoryEntry> = {
                isFile: false,
                isDirectory: true,
                name: 'subdir',
                createReader: () => {
                    let called = false
                    return {
                        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
                            if (!called) {
                                called = true
                                resolve([mockFileEntry as FileSystemEntry])
                            } else {
                                resolve([])
                            }
                        },
                    } as FileSystemDirectoryReader
                },
            }
            const event = {
                stopPropagation: jest.fn(),
                preventDefault: jest.fn(),
                dataTransfer: {
                    items: {
                        length: 1,
                        0: { webkitGetAsEntry: () => mockDirEntry },
                    },
                },
            } as unknown as DragEvent

            const result = await reader.readFilesFromSource(event)
            expect(result).toBeDefined()
            expect(result!.directories).toHaveLength(1)
            expect(result!.directories[0].name).toBe('subdir')
            expect(result!.directories[0].files).toHaveLength(1)
            expect(result!.directories[0].files[0].name).toBe('inner.txt')
        })

        it('should handle multiple items', async () => {
            const file1 = new File(['a'], 'a.txt')
            const file2 = new File(['b'], 'b.txt')
            const entry1: Partial<FileSystemFileEntry> = {
                isFile: true, isDirectory: false, name: 'a.txt',
                file: (resolve: (file: File) => void) => resolve(file1),
            }
            const entry2: Partial<FileSystemFileEntry> = {
                isFile: true, isDirectory: false, name: 'b.txt',
                file: (resolve: (file: File) => void) => resolve(file2),
            }
            const event = {
                stopPropagation: jest.fn(),
                preventDefault: jest.fn(),
                dataTransfer: {
                    items: {
                        length: 2,
                        0: { webkitGetAsEntry: () => entry1 },
                        1: { webkitGetAsEntry: () => entry2 },
                    },
                },
            } as unknown as DragEvent

            const result = await reader.readFilesFromSource(event)
            expect(result!.files).toHaveLength(2)
        })
    })
})
