import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * IDE-autocomplete test harness.
 *
 * IDEs (VS Code, JetBrains, typescript-language-server clients) all get
 * their completion lists from the TypeScript language service —
 * `LanguageService.getCompletionsAtPosition` is the exact API tsserver
 * calls for a Ctrl+Space / typing trigger. Driving it directly in a test
 * therefore reproduces what a user sees in the editor, modulo client-side
 * fuzzy filtering and snippet decoration.
 *
 * Mechanics: one language service is created over this package's tsconfig,
 * plus a single VIRTUAL file inside `src/` that never exists on disk. The
 * virtual file imports `@pipesafe/core`, which the tsconfig `paths` entry
 * maps to core's source entry point. Each probe swaps the virtual file's
 * content (bumping its version so the service re-parses only that file)
 * and asks for completions at the `‸` cursor marker.
 */

const CURSOR = "‸";

/** packages/core-completions-tests — resolved relative to this file (src/). */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Virtual probe file: lives (virtually) in this package's src/. */
const virtualFileName = path.join(packageRoot, "src", "__completionProbe__.ts");

export interface CompletionProbe {
  /** Entry names in the order the language service returns them. */
  names: string[];
  /**
   * True when the list is a contextual member list (object-literal keys /
   * property access) rather than a generic identifier list. When this is
   * false inside an object literal, the editor has no contextual
   * suggestions and falls back to global identifiers — i.e. autocomplete
   * is effectively broken at that position.
   */
  isMemberCompletion: boolean;
  /** Raw entries for kind/sortText assertions. */
  entries: ts.CompletionEntry[];
}

function createHost(
  parsed: ts.ParsedCommandLine,
  getVirtual: () => string,
  getVersion: () => number
): ts.LanguageServiceHost {
  return {
    getScriptFileNames: () => [...parsed.fileNames, virtualFileName],
    getScriptVersion: (fileName) =>
      fileName === virtualFileName ? String(getVersion()) : "0",
    getScriptSnapshot: (fileName) => {
      if (fileName === virtualFileName) {
        return ts.ScriptSnapshot.fromString(getVirtual());
      }
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : (
          ts.ScriptSnapshot.fromString(text)
        );
    },
    getCurrentDirectory: () => packageRoot,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) =>
      fileName === virtualFileName || ts.sys.fileExists(fileName),
    readFile: (fileName) =>
      fileName === virtualFileName ? getVirtual() : ts.sys.readFile(fileName),
    readDirectory: (...args) => ts.sys.readDirectory(...args),
    directoryExists: (dir) => ts.sys.directoryExists(dir),
    getDirectories: (dir) => ts.sys.getDirectories(dir),
  };
}

export interface CompletionTester {
  /**
   * `source` is the full content of the virtual file with exactly one `‸`
   * marking the cursor. Returns the completion list the IDE would show.
   */
  completionsAt(source: string): CompletionProbe;
}

export function createCompletionTester(): CompletionTester {
  const configPath = path.join(packageRoot, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      );
    },
  });
  if (!parsed) throw new Error(`Failed to parse ${configPath}`);

  let virtualText = "";
  let virtualVersion = 0;

  const service = ts.createLanguageService(
    createHost(
      parsed,
      () => virtualText,
      () => virtualVersion
    ),
    ts.createDocumentRegistry()
  );

  return {
    completionsAt(source: string): CompletionProbe {
      const offset = source.indexOf(CURSOR);
      if (offset < 0) {
        throw new Error(`Snippet is missing the ${CURSOR} cursor marker`);
      }
      if (source.includes(CURSOR, offset + 1)) {
        throw new Error(`Snippet has more than one ${CURSOR} cursor marker`);
      }
      virtualText = source.replace(CURSOR, "");
      virtualVersion++;

      const info = service.getCompletionsAtPosition(virtualFileName, offset, {
        includeCompletionsWithInsertText: true,
      });
      return {
        names: info?.entries.map((entry) => entry.name) ?? [],
        isMemberCompletion: info?.isMemberCompletion ?? false,
        entries: info?.entries ?? [],
      };
    },
  };
}
