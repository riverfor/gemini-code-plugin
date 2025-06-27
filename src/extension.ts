import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "gemini-code-plugin" is now active!');

	let disposable = vscode.commands.registerCommand('gemini-code-plugin.startChat', () => {
		const panel = vscode.window.createWebviewPanel(
			'geminiChat',
			'Gemini Chat',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
			}
		);

		const htmlPath = path.join(context.extensionPath, 'media', 'chat.html');
		panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

		// Get API Key from VS Code settings
		const config = vscode.workspace.getConfiguration('gemini-code-plugin');
		const apiKey = config.get<string>('apiKey');

		if (!apiKey) {
			vscode.window.showErrorMessage('Gemini API Key not configured. Please set it in VS Code settings.');
			return;
		}

		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'prompt':
						try {
							const userPrompt = message.text;
							// Add a system instruction to guide the AI's output format
							const fullPrompt = `You are an AI coding assistant for VS Code. Your primary goal is to help the user with coding tasks by generating code, modifying existing files, creating new files, deleting files, or renaming files. Always respond directly to the user's request.

When you need to perform a file operation, include a JSON object in your response. Only include ONE JSON object per response. The JSON should be enclosed in a markdown code block with 'json' language identifier.

1.  **To modify an existing file**: Use the following JSON structure. The 'oldString' MUST be an exact, literal match (including all whitespace, indentation, and newlines) of the text to be replaced in the file. The 'newString' will replace it.

    ```json
    {
      "action": "modifyFile",
      "filePath": "/absolute/path/to/your/file.js",
      "oldString": "function oldFunction() {\n    // old code\n}",
      "newString": "function newFunction() {\n    // new code\n}"
    }
    ```

2.  **To create a new file**: Use the following JSON structure. The 'filePath' MUST be an absolute path, including the new file name. The 'content' will be written to the new file.

    ```json
    {
      "action": "createFile",
      "filePath": "/absolute/path/to/new/file.ts",
      "content": "export function hello() {\n    console.log(\"Hello, World!\");\n}"
    }
    ```

3.  **To delete a file**: Use the following JSON structure. The 'filePath' MUST be an absolute path to the file to be deleted.

    ```json
    {
      "action": "deleteFile",
      "filePath": "/absolute/path/to/file/to/delete.js"
    }
    ```

4.  **To rename a file**: Use the following JSON structure. Both 'oldPath' and 'newPath' MUST be absolute paths.

    ```json
    {
      "action": "renameFile",
      "oldPath": "/absolute/path/to/old/file.js",
      "newPath": "/absolute/path/to/new/file.js"
    }
    ```

If you are providing new code to be inserted directly into the active editor (and not as part of a file operation), use a standard markdown code block (e.g., ```javascript\n// code here\n```). Do not include a JSON object if you are only inserting code.

User: ${userPrompt}`;
							const result = await model.generateContent(fullPrompt);
							const response = await result.response;
							const text = response.text();

							panel.webview.postMessage({ command: 'response', text: text }); // Always show full response in chat

							// Try to parse for file operation instruction first
							const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
							const jsonMatch = text.match(jsonBlockRegex);

							if (jsonMatch && jsonMatch[1]) {
								try {
									const instruction = JSON.parse(jsonMatch[1]);

									if (instruction.action === 'deleteFile' && instruction.filePath) {
										const uri = vscode.Uri.file(instruction.filePath);
										try {
											await vscode.workspace.fs.delete(uri);
											vscode.window.showInformationMessage(`File ${instruction.filePath} deleted successfully.`);
										} catch (e: any) {
											vscode.window.showErrorMessage(`Error deleting file ${instruction.filePath}: ${e.message}`);
										}
										return; // Stop processing if a file operation was attempted
									} else if (instruction.action === 'renameFile' && instruction.oldPath && instruction.newPath) {
										const oldUri = vscode.Uri.file(instruction.oldPath);
										const newUri = vscode.Uri.file(instruction.newPath);
										try {
											await vscode.workspace.fs.rename(oldUri, newUri);
											vscode.window.showInformationMessage(`File ${instruction.oldPath} renamed to ${instruction.newPath} successfully.`);
										} catch (e: any) {
											vscode.window.showErrorMessage(`Error renaming file from ${instruction.oldPath} to ${instruction.newPath}: ${e.message}`);
										}
										return; // Stop processing if a file operation was attempted
									} else if (instruction.action === 'createFile' && instruction.filePath && instruction.content !== undefined) {
										const uri = vscode.Uri.file(instruction.filePath);
										try {
											await vscode.workspace.fs.writeFile(uri, Buffer.from(instruction.content, 'utf8'));
											vscode.window.showInformationMessage(`File ${instruction.filePath} created successfully.`);
										} catch (e: any) {
											if (e.code === 'EEXIST') {
												vscode.window.showErrorMessage(`File creation failed: ${instruction.filePath} already exists.`);
											} else if (e.code === 'ENOENT') {
												vscode.window.showErrorMessage(`File creation failed: Directory for ${instruction.filePath} does not exist.`);
											} else {
												vscode.window.showErrorMessage(`Error creating file ${instruction.filePath}: ${e.message}`);
											}
										}
										return; // Stop processing if a file operation was attempted
									} else if (instruction.action === 'modifyFile' && instruction.filePath && instruction.oldString !== undefined && instruction.newString !== undefined) {
										const uri = vscode.Uri.file(instruction.filePath);
										try {
											const document = await vscode.workspace.openTextDocument(uri);
											const editor = await vscode.window.showTextDocument(document);

											const fullText = document.getText();
											const startIndex = fullText.indexOf(instruction.oldString);

											if (startIndex !== -1) {
												const startPos = document.positionAt(startIndex);
												const endPos = document.positionAt(startIndex + instruction.oldString.length);
												const range = new vscode.Range(startPos, endPos);

												await editor.edit(editBuilder => {
													editBuilder.replace(range, instruction.newString);
												});
												vscode.window.showInformationMessage(`File ${instruction.filePath} modified successfully.`);
											} else {
												vscode.window.showWarningMessage(`File modification failed: Could not find the specified oldString in ${instruction.filePath}.`);
											}
										} catch (e: any) {
											vscode.window.showErrorMessage(`Error modifying file ${instruction.filePath}: ${e.message}`);
										}
										return; // Stop processing if a file operation was attempted
									} else {
										vscode.window.showWarningMessage('AI provided an unrecognized or incomplete JSON instruction.');
									}
								} catch (jsonError) {
									console.error('Error parsing AI JSON instruction:', jsonError);
									vscode.window.showErrorMessage('AI provided malformed JSON instruction.');
								}
							}

							// Also check for code block to insert (if no file operation was done or if it was done)
							const codeBlockRegex = /```(?:\w+\n)?[\s\S]*?```/;
							const codeMatch = text.match(codeBlockRegex);

							if (codeMatch && codeMatch[1]) {
								const codeToInsert = codeMatch[1].trim();
								const editor = vscode.window.activeTextEditor;
								if (editor) {
									await editor.edit(editBuilder => {
										editBuilder.insert(editor.selection.active, codeToInsert);
									});
									vscode.window.showInformationMessage('Code inserted into active editor.');
								} else {

									vscode.window.showWarningMessage('No active text editor found to insert code.');
								}
							}

							const result = await model.generateContent(fullPrompt);
							const response = await result.response;
							const text = response.text();

							panel.webview.postMessage({ command: 'response', text: text }); // Always show full response in chat

							// Try to parse for file operation instruction first
							const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
							const jsonMatch = text.match(jsonBlockRegex);

							if (jsonMatch && jsonMatch[1]) {
								try {
									const instruction = JSON.parse(jsonMatch[1]);

									if (instruction.action === 'createFile' && instruction.filePath && instruction.content !== undefined) {
										const uri = vscode.Uri.file(instruction.filePath);
										try {
											await vscode.workspace.fs.writeFile(uri, Buffer.from(instruction.content, 'utf8'));
											vscode.window.showInformationMessage(`File ${instruction.filePath} created successfully.`);
										} catch (e: any) {
											if (e.code === 'EEXIST') {
												vscode.window.showErrorMessage(`File creation failed: ${instruction.filePath} already exists.`);
											} else if (e.code === 'ENOENT') {
												vscode.window.showErrorMessage(`File creation failed: Directory for ${instruction.filePath} does not exist.`);
											} else {
												vscode.window.showErrorMessage(`Error creating file ${instruction.filePath}: ${e.message}`);
											}
										}
										return; // Stop processing if a file operation was attempted
									} else if (instruction.action === 'modifyFile' && instruction.filePath && instruction.oldString !== undefined && instruction.newString !== undefined) {
										const uri = vscode.Uri.file(instruction.filePath);
										try {
											const document = await vscode.workspace.openTextDocument(uri);
											const editor = await vscode.window.showTextDocument(document);

											const fullText = document.getText();
											const startIndex = fullText.indexOf(instruction.oldString);

											if (startIndex !== -1) {
												const startPos = document.positionAt(startIndex);
												const endPos = document.positionAt(startIndex + instruction.oldString.length);
												const range = new vscode.Range(startPos, endPos);

												await editor.edit(editBuilder => {
													editBuilder.replace(range, instruction.newString);
												});
												vscode.window.showInformationMessage(`File ${instruction.filePath} modified successfully.`);
											} else {
												vscode.window.showWarningMessage(`File modification failed: Could not find the specified oldString in ${instruction.filePath}.`);
											}
										} catch (e: any) {
											vscode.window.showErrorMessage(`Error modifying file ${instruction.filePath}: ${e.message}`);
										}
										return; // Stop processing if a file operation was attempted
									} else {
										vscode.window.showWarningMessage('AI provided an unrecognized or incomplete JSON instruction.');
									}
								} catch (jsonError) {
									console.error('Error parsing AI JSON instruction:', jsonError);
									vscode.window.showErrorMessage('AI provided malformed JSON instruction.');
								}
							}

							// Also check for code block to insert (if no file operation was done or if it was done)
							const codeBlockRegex = /```(?:\w+\n)?[\s\S]*?```/;
							const codeMatch = text.match(codeBlockRegex);

							if (codeMatch && codeMatch[1]) {
								const codeToInsert = codeMatch[1].trim();
								const editor = vscode.window.activeTextEditor;
								if (editor) {
									await editor.edit(editBuilder => {
										editBuilder.insert(editor.selection.active, codeToInsert);
									});
									vscode.window.showInformationMessage('Code inserted into active editor.');
								} else {

									vscode.window.showWarningMessage('No active text editor found to insert code.');
								}
							}

						} catch (error) {
							console.error('Error generating content or processing response:', error);
							panel.webview.postMessage({ command: 'response', text: `Error: ${error.message}` });
						}
						return;
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
