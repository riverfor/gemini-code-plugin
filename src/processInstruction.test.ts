import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { processInstruction } from './extension';

// Minimal mocks for vscode objects that processInstruction directly interacts with
const mockVscode = vi.hoisted(() => {
    const mockTerminal = {
        show: vi.fn(),
        sendText: vi.fn(),
        dispose: vi.fn(),
        name: 'mockTerminal',
        processId: 123,
        creationOptions: {}, // Minimal properties for Terminal
        exitStatus: undefined,
        state: 1,
        shellIntegration: false,
        hide: vi.fn(),
    };

    const mockEditor = {
        document: {
            getText: vi.fn(),
            positionAt: vi.fn((offset) => new vscode.Position(0, offset)),
        },
        selection: {
            isEmpty: true,
            active: new vscode.Position(0, 0),
            start: new vscode.Position(0, 0),
            end: new vscode.Position(0, 0),
        },
        edit: vi.fn((callback) => {
            const editBuilder = {
                replace: vi.fn(),
                insert: vi.fn(),
            };
            callback(editBuilder);
            return Promise.resolve(true);
        }),
    };

    const mockWorkspace = {
        fs: {
            writeFile: vi.fn(() => Promise.resolve()),
            delete: vi.fn(() => Promise.resolve()),
            rename: vi.fn(() => Promise.resolve()),
        },
        openTextDocument: vi.fn(() => Promise.resolve({
            getText: vi.fn(() => 'file content'),
            positionAt: vi.fn((offset) => new vscode.Position(0, offset)),
        } as unknown as vscode.TextDocument)),
    };

    const mockWindow = {
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        createTerminal: vi.fn(() => mockTerminal),
        activeTextEditor: mockEditor as unknown as vscode.TextEditor,
        showTextDocument: vi.fn(() => Promise.resolve(mockEditor as unknown as vscode.TextEditor)),
    };

    return {
        workspace: mockWorkspace as unknown as typeof vscode.workspace,
        window: mockWindow as unknown as typeof vscode.window,
        Uri: {
            file: vi.fn((p) => ({ fsPath: p, scheme: 'file' })) as unknown as typeof vscode.Uri.file,
        },
        Range: vi.fn((start, end) => new vscode.Range(start, end)) as unknown as typeof vscode.Range,
        Position: vi.fn((line, character) => new vscode.Position(line, character)) as unknown as typeof vscode.Position,
    };
});

vi.mock('vscode', () => mockVscode);

describe('processInstruction', () => {
    let mockPanel: vscode.WebviewPanel;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPanel = {
            webview: {
                postMessage: vi.fn(),
            },
        } as unknown as vscode.WebviewPanel;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should handle deleteFile instruction', async () => {
        const instruction = {
            action: 'deleteFile',
            filePath: '/test/file-to-delete.js',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(expect.any(vscode.Uri));
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `File ${instruction.filePath} deleted successfully.`
        );
    });

    it('should show error if deleteFile instruction is missing filePath', async () => {
        const instruction = {
            action: 'deleteFile',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Delete file instruction missing filePath.'
        );
    });

    it('should handle renameFile instruction', async () => {
        const instruction = {
            action: 'renameFile',
            oldPath: '/test/old-name.js',
            newPath: '/test/new-name.js',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.workspace.fs.rename).toHaveBeenCalledWith(
            expect.any(vscode.Uri),
            expect.any(vscode.Uri)
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `File ${instruction.oldPath} renamed to ${instruction.newPath} successfully.`
        );
    });

    it('should show error if renameFile instruction is missing paths', async () => {
        const instruction = {
            action: 'renameFile',
            oldPath: '/test/old-name.js',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Rename file instruction missing oldPath or newPath.'
        );
    });

    it('should handle createFile instruction', async () => {
        const instruction = {
            action: 'createFile',
            filePath: '/test/new-file.js',
            content: 'console.log(\"Hello\");',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
            expect.any(vscode.Uri),
            Buffer.from(instruction.content, 'utf8')
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `File ${instruction.filePath} created successfully.`
        );
    });

    it('should show error if createFile instruction is missing filePath or content', async () => {
        const instruction = {
            action: 'createFile',
            filePath: '/test/new-file.js',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Create file instruction missing filePath or content.'
        );
    });

    it('should handle modifyFile instruction', async () => {
        const instruction = {
            action: 'modifyFile',
            filePath: '/test/existing-file.js',
            oldString: 'old content',
            newString: 'new content',
        };
        (vscode.workspace.openTextDocument as vi.Mock).mockResolvedValueOnce({
            getText: vi.fn(() => 'old content'),
            positionAt: vi.fn((offset) => new vscode.Position(0, offset)),
        } as unknown as vscode.TextDocument);

        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showTextDocument).toHaveBeenCalled();
        expect(vscode.window.activeTextEditor?.edit).toHaveBeenCalledWith(expect.any(Function));
        const editBuilderCallback = (vscode.window.activeTextEditor?.edit as vi.Mock).mock.calls[0][0];
        const mockEditBuilder = { replace: vi.fn() };
        editBuilderCallback(mockEditBuilder);
        expect(mockEditBuilder.replace).toHaveBeenCalledWith(
            expect.any(vscode.Range),
            instruction.newString
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `File ${instruction.filePath} modified successfully.`
        );
    });

    it('should show error if modifyFile instruction is missing parameters', async () => {
        const instruction = {
            action: 'modifyFile',
            filePath: '/test/existing-file.js',
            oldString: 'old content',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Modify file instruction missing filePath, oldString, or newString.'
        );
    });

    it('should handle runShellCommand instruction', async () => {
        const instruction = {
            action: 'runShellCommand',
            command: 'npm install some-package',
        };
        const createTerminalSpy = vi.spyOn(vscode.window, 'createTerminal');
        const mockTerminal = vscode.window.createTerminal({ name: 'Gemini Command' });
        createTerminalSpy.mockReturnValue(mockTerminal);

        await processInstruction(instruction, mockPanel);

        expect(createTerminalSpy).toHaveBeenCalledWith({ name: 'Gemini Command' });
        expect(mockTerminal.show).toHaveBeenCalled();
        expect(mockTerminal.sendText).toHaveBeenCalledWith(instruction.command);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `Executing command: ${instruction.command}`
        );
    });

    it('should show error if runShellCommand instruction is missing command', async () => {
        const instruction = {
            action: 'runShellCommand',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Run shell command instruction missing command.'
        );
    });

    it('should show warning for unrecognized JSON action', async () => {
        const instruction = {
            action: 'unrecognizedAction',
            filePath: '/test/file.js',
        };
        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'AI provided an unrecognized or incomplete JSON instruction.'
        );
    });

    it('should handle errors during file creation', async () => {
        const instruction = {
            action: 'createFile',
            filePath: '/test/existing-file.js',
            content: 'some content',
        };
        (vscode.workspace.fs.writeFile as vi.Mock).mockRejectedValueOnce({ code: 'EEXIST' });

        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            `File creation failed: ${instruction.filePath} already exists.`
        );
    });

    it('should handle errors during file modification', async () => {
        const instruction = {
            action: 'modifyFile',
            filePath: '/test/non-existent-file.js',
            oldString: 'old',
            newString: 'new',
        };
        (vscode.workspace.openTextDocument as vi.Mock).mockRejectedValueOnce(new Error('File not found'));

        await processInstruction(instruction, mockPanel);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            `Error modifying file ${instruction.filePath}: File not found`
        );
    });
});