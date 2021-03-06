import * as vscode from 'vscode';
import { ClientMapper } from './../clientMapper';
import { NotebookFile, parseNotebook, serializeNotebook, editorLanguages } from '../interactiveNotebook';
import { RawNotebookCell } from '../interfaces';
import { JupyterNotebook } from '../interfaces/jupyter';
import { convertFromJupyter } from '../interop/jupyter';
import { trimTrailingCarriageReturn } from '../utilities';

export class DotNetInteractiveNotebookContentProvider implements vscode.NotebookContentProvider {
    constructor(readonly clientMapper: ClientMapper) {
    }

    async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {
        let contents = '';
        try {
            contents = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        } catch {
        }

        let notebook: NotebookFile;
        let extension = getExtension(uri.path);
        switch (extension) {
            case '.ipynb':
                let json = JSON.parse(contents);
                let jupyter = <JupyterNotebook>json;
                notebook = convertFromJupyter(jupyter);
                break;
            case '.dotnet-interactive':
            default:
                notebook = parseNotebook(contents);
                break;
        }

        this.clientMapper.getOrAddClient(uri);
        let notebookData: vscode.NotebookData = {
            languages: editorLanguages,
            metadata: {
                hasExecutionOrder: false
            },
            cells: notebook.cells.map(toNotebookCellData)
        };
        return notebookData;
    }

    saveNotebook(document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        return this.save(document, document.uri);
    }

    saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        return this.save(document, targetResource);
    }

    onDidChangeNotebook: vscode.Event<void> = new vscode.EventEmitter<void>().event;

    executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken): Promise<void> {
        if (!cell) {
            // TODO: run everything
            return new Promise((resolve, reject) => resolve());
        }

        cell.outputs = [];
        let client = this.clientMapper.getOrAddClient(document.uri);
        let source = cell.source.toString();
        return client.execute(source, cell.language, outputs => {
            // to properly trigger the UI update, `cell.outputs` needs to be uniquely assigned; simply setting it to the local variable has no effect
            cell.outputs = [];
            cell.outputs = outputs;
        });
    }

    private async save(document: vscode.NotebookDocument, targetResource: vscode.Uri): Promise<void> {
        let notebook: NotebookFile = {
            cells: [],
        };
        for (let cell of document.cells) {
            notebook.cells.push({
                language: cell.language,
                contents: cell.document.getText().split('\n').map(trimTrailingCarriageReturn),
            });
        }

        await vscode.workspace.fs.writeFile(targetResource, Buffer.from(serializeNotebook(notebook)));
    }
}

function toNotebookCellData(cell: RawNotebookCell): vscode.NotebookCellData {
    return {
        cellKind: languageToCellKind(cell.language),
        source: cell.contents.join('\n'),
        language: cell.language,
        outputs: [],
        metadata: {}
    };
}

function getExtension(filename: string): string {
    let dot = filename.indexOf('.');
    if (dot < 0) {
        return '';
    }

    return filename.substr(dot);
}

function languageToCellKind(language: string): vscode.CellKind {
    switch (language) {
        case 'md':
        case 'markdown':
            return vscode.CellKind.Markdown;
        default:
            return vscode.CellKind.Code;
    }
}
