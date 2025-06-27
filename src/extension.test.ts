import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode'; // This will now use the mock
import { activate } from './extension';

describe('activate', () => {
    let mockContext: vscode.ExtensionContext;
    let registerCommandSpy: ReturnType<typeof vi.spyOn>;
    let createWebviewPanelSpy: ReturnType<typeof vi.spyOn>;
    let showErrorMessageSpy: ReturnType<typeof vi.spyOn>;
    let getConfigurationSpy: ReturnType<typeof vi.spyOn>;
    let getConfigurationGetSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();

        mockContext = {
            subscriptions: [],
            extensionPath: '/mock/extension/path',
            asAbsolutePath: vi.fn((relativePath) => `/mock/extension/path/${relativePath}`),
        } as unknown as vscode.ExtensionContext;

        registerCommandSpy = vi.spyOn(vscode.commands, 'registerCommand');
        createWebviewPanelSpy = vi.spyOn(vscode.window, 'createWebviewPanel');
        showErrorMessageSpy = vi.spyOn(vscode.window, 'showErrorMessage');
        getConfigurationSpy = vi.spyOn(vscode.workspace, 'getConfiguration');
        getConfigurationGetSpy = vi.fn(() => 'test-api-key');
        getConfigurationSpy.mockReturnValue({
            get: getConfigurationGetSpy,
        } as unknown as vscode.WorkspaceConfiguration);

        // Mock fs.readFileSync is now in test-setup.ts
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should register the startChat command', () => {
        activate(mockContext);
        expect(registerCommandSpy).toHaveBeenCalledWith(
            'gemini-code-plugin.startChat',
            expect.any(Function)
        );
    });

    it('should create and show a webview panel when startChat command is executed', async () => {
        activate(mockContext);
        const commandHandler = registerCommandSpy.mock.calls[0][1];
        await commandHandler();

        expect(createWebviewPanelSpy).toHaveBeenCalledWith(
            'geminiChat',
            'Gemini Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [expect.any(vscode.Uri)],
            }
        );
        expect(createWebviewPanelSpy.mock.results[0].value.webview.html).toBe('<html><body>Mock HTML</body></html>');
    });

    it('should show an error if API key is not configured', async () => {
        getConfigurationGetSpy.mockReturnValueOnce(undefined);

        activate(mockContext);
        const commandHandler = registerCommandSpy.mock.calls[0][1];
        await commandHandler();

        expect(showErrorMessageSpy).toHaveBeenCalledWith(
            'Gemini API Key not configured. Please set it in VS Code settings.'
        );
        expect(createWebviewPanelSpy).not.toHaveBeenCalled();
    });
});
