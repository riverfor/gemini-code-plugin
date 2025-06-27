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

							// --- Gather Context --- //
							let openFilesContent = '';
							for (const doc of vscode.workspace.textDocuments) {
								openFilesContent += `--- File: ${doc.fileName} ---\n${doc.getText()}\n\n`;
							}

							let selectedCode = '';
							const editor = vscode.window.activeTextEditor;
							if (editor && !editor.selection.isEmpty) {
								selectedCode = editor.document.getText(editor.selection);
							}

							let projectStructure = '';
							if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
								const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
								const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,dist,.git,out}/**', 20); // Limit to 20 files for brevity
								projectStructure = files.map(file => path.relative(workspaceRoot, file.fsPath)).join('\n');
							}

							// --- Construct Full Prompt with Context --- //
							const contextString = `\nCurrently Open Files:\n\`\`\`\n${openFilesContent || 'None'}\n\`\`\`\n\nSelected Code:\n\`\`\`\n${selectedCode || 'None'}\n\`\`\`\n\nProject Structure (limited to 20 files):\n\`\`\`\n${projectStructure || 'None'}\n\`\`\`\n`;

							const fullPrompt = `You are an AI coding assistant for VS Code. Your primary goal is to help the user with coding tasks by generating code, modifying existing files, creating new files, deleting files, or renaming files. Always respond directly to the user's request.\n\n${contextString}\n\nWhen you need to perform file operations or run shell commands, include a JSON array of objects in your response. Each object represents a single operation. The JSON array should be enclosed in a markdown code block with 'json' language identifier.\n\nSupported actions:\n\n1.  **To modify an existing file**: Use the following JSON structure. The 'oldString' MUST be an exact, literal match (including all whitespace, indentation, and newlines) of the text to be replaced in the file. The 'newString' will replace it.\n\n    \`\`\`json\n    {\n      "action": "modifyFile",\n      "filePath": "/absolute/path/to/your/file.js",\n      "oldString": "function oldFunction() {\n    // old code\n}",\n      "newString": "function newFunction() {\n    // new code\n}"\n    }\n    \`\`\`\n\n2.  **To create a new file**: Use the following JSON structure. The 'filePath' MUST be an absolute path, including the new file name. The 'content' will be written to the new file.\n\n    \`\`\`json\n    {\n      "action": "createFile",\n      "filePath": "/absolute/path/to/new/file.ts",\n      "content": "export function hello() {\n    console.log(\"Hello, World!\");\n}"\n    }\n    \`\`\`\n\n3.  **To delete a file**: Use the following JSON structure. The 'filePath' MUST be an absolute path to the file to be deleted.\n\n    \`\`\`json\n    {\n      "action": "deleteFile",\n      "filePath": "/absolute/path/to/file/to/delete.js"\n    }\n    \`\`\`\n\n4.  **To rename a file**: Use the following JSON structure. Both 'oldPath' and 'newPath' MUST be absolute paths.\n\n    \`\`\`json\n    {\n      "action": "renameFile",\n      "oldPath": "/absolute/path/to/old/file.js",\n      "newPath": "/absolute/path/to/new/file.js"\n    }\n    \`\`\`\n\n5.  **To run a shell command**: Use the following JSON structure. The 'command' will be executed in the integrated terminal.\n\n    \`\`\`json\n    {\n      "action": "runShellCommand",\n      "command": "npm install some-package"\n    }\n    \`\`\`\n\nIf you are providing new code to be inserted directly into the active editor (and not as part of a file operation), use a standard markdown code block (e.g., \`\`\`javascript\n// code here\n\`\`\`). Do not include a JSON object if you are only inserting code.\n\nUser: ${userPrompt}`;

							const result = await model.generateContent(fullPrompt);
							const response = await result.response;
							const text = response.text();

							panel.webview.postMessage({ command: 'response', text: text }); // Always show full response in chat

							// Try to parse for file operation instruction(s) first
							const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
							const jsonMatch = text.match(jsonBlockRegex);

							if (jsonMatch && jsonMatch[1]) {
								try {
									const instructions: any[] = JSON.parse(jsonMatch[1]);

									// Ensure instructions is an array
									if (!Array.isArray(instructions)) {
										vscode.window.showWarningMessage('AI provided a single JSON object instead of an array for operations. Attempting to process as a single operation.');
										processInstruction(instructions, panel);
									} else {
										for (const instruction of instructions) {
											await processInstruction(instruction, panel);
										}
									}
								} catch (jsonError) {
									console.error('Error parsing AI JSON instruction(s):', jsonError);
									vscode.window.showErrorMessage('AI provided malformed JSON instruction(s).');
								}
								return; // Stop processing if file operations were attempted
							}

							// If no JSON instruction, check for code block to insert
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

export async function processInstruction(instruction: any, panel: vscode.WebviewPanel) {
	switch (instruction.action) {
		case 'deleteFile':
			if (instruction.filePath) {
				const uri = vscode.Uri.file(instruction.filePath);
				try {
					await vscode.workspace.fs.delete(uri);
					vscode.window.showInformationMessage(`File ${instruction.filePath} deleted successfully.`);
				} catch (e: any) {
					vscode.window.showErrorMessage(`Error deleting file ${instruction.filePath}: ${e.message}`);
				}
			} else {
				vscode.window.showWarningMessage('Delete file instruction missing filePath.');
			}
			break;
		case 'renameFile':
			if (instruction.oldPath && instruction.newPath) {
				const oldUri = vscode.Uri.file(instruction.oldPath);
				const newUri = vscode.Uri.file(instruction.newPath);
				try {
					await vscode.workspace.fs.rename(oldUri, newUri);
					vscode.window.showInformationMessage(`File ${instruction.oldPath} renamed to ${instruction.newPath} successfully.`);
				} catch (e: any) {
					vscode.window.showErrorMessage(`Error renaming file from ${instruction.oldPath} to ${instruction.newPath}: ${e.message}`);
				}
			} else {
				vscode.window.showWarningMessage('Rename file instruction missing oldPath or newPath.');
			}
			break;
		case 'createFile':
			if (instruction.filePath && instruction.content !== undefined) {
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
			}
			break;
		case 'modifyFile':
			if (instruction.filePath && instruction.oldString !== undefined && instruction.newString !== undefined) {
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
			}
			break;
		case 'runShellCommand':
			if (instruction.command) {
				const terminal = vscode.window.createTerminal({ name: 'Gemini Command' });
				terminal.show();
				terminal.sendText(instruction.command);
				vscode.window.showInformationMessage(`Executing command: ${instruction.command}`);
			} else {
				vscode.window.showWarningMessage('Run shell command instruction missing command.');
			}
			break;
		default:
			vscode.window.showWarningMessage('AI provided an unrecognized or incomplete JSON instruction.');
			break;
	}
}