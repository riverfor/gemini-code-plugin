import { vi } from 'vitest';

// Mock the GoogleGenerativeAI module globally
vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn(() => ({
        getGenerativeModel: vi.fn(() => ({
            generateContent: vi.fn(() => Promise.resolve({
                response: { text: () => 'Mock AI Response' }
            })),
        })),
    })),
}));

// Mock fs module for readFileSync globally
vi.mock('fs', () => ({
    readFileSync: vi.fn(() => '<html><body>Mock HTML</body></html>'),
}));

// Mock path module globally
vi.mock('path', () => ({
    join: vi.fn((...args) => args.join('/')),
    relative: vi.fn((from, to) => to.replace(from, '').replace(/^\//, '')),
}));

// Mock the vscode module using the __mocks__ directory
vi.mock('vscode');