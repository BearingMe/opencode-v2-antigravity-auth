import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript"

interface BoundaryException {
  source: string
  target: string
  reason: string
  removeAfter: string
}

interface BoundaryCycleException {
  edges: RuntimeCycleEdge[]
  reason: string
  removeAfter: string
}

interface RuntimeCycleEdge {
  source: string
  target: string
}

interface RuntimeCycle {
  members: string[]
  edges: RuntimeCycleEdge[]
}

interface ImportReference {
  specifier: string
  line: number
  runtime: boolean
}

interface ResolvedImport extends ImportReference {
  target: string
}

interface BoundaryDiagnostic {
  source: string
  line: number
  message: string
}

interface SourceLayer {
  kind: "module" | "platform" | "other"
  moduleName?: string
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const PUBLIC_MODULE_FILES = new Set(["index.ts", "ports.ts"])
const PUBLIC_SESSION_RECOVERY_FILES = new Set([...PUBLIC_MODULE_FILES, "storage.ts"])
const APPROVED_ARCHITECTURE_PACKAGES = new Set(["zod"])

/** Converts an absolute path to the slash-separated form used in diagnostics and policy. */
function relativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/")
}

/** Extracts a package name from a bare specifier, leaving relative imports unclassified. */
function packageName(specifier: string): string | undefined {
  if (specifier.startsWith(".")) return undefined
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]
}

/** Narrows parsed JSON values before reading manifest fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Narrows a manifest edge to its exact source and target paths. */
function isRuntimeCycleEdge(value: unknown): value is RuntimeCycleEdge {
  return isRecord(value) && typeof value.source === "string" && typeof value.target === "string"
}

/** Walks production source files, excluding declarations and test-only code. */
function collectProductionSources(root: string): string[] {
  const sourceRoot = join(root, "src")
  if (!existsSync(sourceRoot)) throw new Error(`Missing source directory: ${sourceRoot}`)

  const sources: string[] = []
  /** Recursively collects source files below the architecture root. */
  const visitDirectory = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        visitDirectory(entryPath)
        continue
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue
      if (entry.name.endsWith(".d.ts") || /(?:\.test|\.spec)\.[^.]+$/.test(entry.name)) continue
      sources.push(resolve(entryPath))
    }
  }

  visitDirectory(sourceRoot)
  return sources.sort()
}

/** Loads compiler options from the project's config or a bundler-mode fixture default. */
function loadCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = join(root, "tsconfig.json")
  if (!existsSync(configPath)) {
    return {
      allowImportingTsExtensions: true,
      allowJs: true,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
    }
  }

  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"))

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    throw new Error(messages.join("\n"))
  }
  return parsed.options
}

/** Classifies a source path for the dependency rules enforced by this checker. */
function classifySource(root: string, sourcePath: string): SourceLayer {
  const pathname = relativePath(root, sourcePath)
  const moduleMatch = pathname.match(/^src\/modules\/([^/]+)\//)
  if (moduleMatch?.[1]) return { kind: "module", moduleName: moduleMatch[1] }
  if (pathname.startsWith("src/platform/")) return { kind: "platform" }
  return { kind: "other" }
}

/** Extracts import-like references and records whether each creates a runtime edge. */
function extractImports(sourceFile: ts.SourceFile): ImportReference[] {
  const references: ImportReference[] = []

  /** Adds a literal module reference with its source position and runtime status. */
  const addReference = (node: ts.Node, specifier: ts.StringLiteral, runtime: boolean): void => {
    references.push({
      specifier: specifier.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      runtime,
    })
  }

  /** Determines whether an import declaration retains a runtime dependency. */
  const importDeclarationIsRuntime = (declaration: ts.ImportDeclaration): boolean => {
    const clause = declaration.importClause
    if (!clause) return true
    if (clause.isTypeOnly) return false
    if (clause.name) return true
    if (!clause.namedBindings) return false
    if (ts.isNamespaceImport(clause.namedBindings)) return true
    return (
      clause.namedBindings.elements.length === 0 || clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    )
  }

  /** Determines whether an export declaration retains a runtime dependency. */
  const exportDeclarationIsRuntime = (declaration: ts.ExportDeclaration): boolean => {
    if (declaration.isTypeOnly) return false
    if (!declaration.exportClause || ts.isNamespaceExport(declaration.exportClause)) return true
    return (
      declaration.exportClause.elements.length === 0 ||
      declaration.exportClause.elements.some((element) => !element.isTypeOnly)
    )
  }

  /** Visits syntax nodes and records only literal module references. */
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addReference(node, node.moduleSpecifier, importDeclarationIsRuntime(node))
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      addReference(node, node.moduleReference.expression, !node.isTypeOnly)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addReference(node, node.moduleSpecifier, exportDeclarationIsRuntime(node))
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addReference(node, node.arguments[0], true)
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addReference(node, node.arguments[0], true)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      addReference(node, node.argument.literal, false)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return references
}

/** Resolves one import using the repository's TypeScript module-resolution settings. */
function resolveImportTarget(
  specifier: string,
  sourcePath: string,
  compilerOptions: ts.CompilerOptions,
): string | undefined {
  const resolution = ts.resolveModuleName(specifier, sourcePath, compilerOptions, ts.sys).resolvedModule
  return resolution ? resolve(resolution.resolvedFileName) : undefined
}

/** Checks whether a target file is part of the public surface of its module. */
function isPublicModuleFile(root: string, targetPath: string, moduleName: string): boolean {
  const targetRelative = relativePath(root, targetPath)
  const moduleRoot = `src/modules/${moduleName}/`
  if (!targetRelative.startsWith(moduleRoot)) return false
  const moduleFile = targetRelative.slice(moduleRoot.length)
  if (moduleFile.includes("/")) return false
  return moduleName === "session-recovery"
    ? PUBLIC_SESSION_RECOVERY_FILES.has(moduleFile)
    : PUBLIC_MODULE_FILES.has(moduleFile)
}

/** Returns the legacy exceptions declared for the current migration checkpoint. */
function readExceptions(root: string): BoundaryException[] {
  const exceptionsPath = join(root, "scripts/boundary-exceptions.json")
  if (!existsSync(exceptionsPath)) return []

  const parsed: unknown = JSON.parse(readFileSync(exceptionsPath, "utf8"))
  if (!Array.isArray(parsed)) throw new Error("Boundary exception manifest must be a JSON array")

  return parsed.map((entry: unknown, index: number) => {
    if (
      !isRecord(entry) ||
      typeof entry.source !== "string" ||
      typeof entry.target !== "string" ||
      typeof entry.reason !== "string" ||
      typeof entry.removeAfter !== "string" ||
      entry.reason.trim() === "" ||
      entry.removeAfter.trim() === ""
    ) {
      throw new Error(`Invalid boundary exception at manifest entry ${index + 1}`)
    }
    return {
      source: entry.source,
      target: entry.target,
      reason: entry.reason,
      removeAfter: entry.removeAfter,
    }
  })
}

/** Reads exact, temporary runtime-cycle exceptions from the migration manifest. */
function readCycleExceptions(root: string): BoundaryCycleException[] {
  const exceptionsPath = join(root, "scripts/boundary-cycle-exceptions.json")
  if (!existsSync(exceptionsPath)) return []

  const parsed: unknown = JSON.parse(readFileSync(exceptionsPath, "utf8"))
  if (!Array.isArray(parsed)) throw new Error("Boundary cycle exception manifest must be a JSON array")

  return parsed.map((entry: unknown, index: number) => {
    if (
      !isRecord(entry) ||
      !Array.isArray(entry.edges) ||
      !entry.edges.every(isRuntimeCycleEdge) ||
      typeof entry.reason !== "string" ||
      typeof entry.removeAfter !== "string" ||
      entry.reason.trim() === "" ||
      entry.removeAfter.trim() === ""
    ) {
      throw new Error(`Invalid boundary cycle exception at manifest entry ${index + 1}`)
    }
    return {
      edges: entry.edges
        .filter(isRuntimeCycleEdge)
        .map((edge) => ({ source: edge.source, target: edge.target }))
        .sort((left, right) => `${left.source}\0${left.target}`.localeCompare(`${right.source}\0${right.target}`)),
      reason: entry.reason,
      removeAfter: entry.removeAfter,
    }
  })
}

/** Reports strongly connected components in the runtime-only local import graph. */
function findRuntimeCycles(
  sourcePaths: readonly string[],
  sourceSet: ReadonlySet<string>,
  imports: ReadonlyMap<string, readonly ResolvedImport[]>,
): RuntimeCycle[] {
  let nextIndex = 0
  const indexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: RuntimeCycle[] = []

  /** Visits one file in Tarjan's algorithm and records cyclic components. */
  const visit = (sourcePath: string): void => {
    indexes.set(sourcePath, nextIndex)
    lowLinks.set(sourcePath, nextIndex)
    nextIndex += 1
    stack.push(sourcePath)
    onStack.add(sourcePath)

    for (const reference of imports.get(sourcePath) ?? []) {
      if (!reference.runtime || !sourceSet.has(reference.target)) continue
      if (!indexes.has(reference.target)) {
        visit(reference.target)
        lowLinks.set(sourcePath, Math.min(lowLinks.get(sourcePath)!, lowLinks.get(reference.target)!))
      } else if (onStack.has(reference.target)) {
        lowLinks.set(sourcePath, Math.min(lowLinks.get(sourcePath)!, indexes.get(reference.target)!))
      }
    }

    if (lowLinks.get(sourcePath) !== indexes.get(sourcePath)) return
    const component: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      component.push(member)
    } while (member !== sourcePath)

    const hasSelfImport = (imports.get(sourcePath) ?? []).some(
      (reference) => reference.runtime && reference.target === sourcePath,
    )
    if (component.length > 1 || hasSelfImport) {
      const componentSet = new Set(component)
      const edgeKeys = new Set<string>()
      const edges: RuntimeCycleEdge[] = []
      for (const memberPath of component) {
        for (const reference of imports.get(memberPath) ?? []) {
          if (!reference.runtime || !componentSet.has(reference.target)) continue
          const edgeKey = `${memberPath}\0${reference.target}`
          if (edgeKeys.has(edgeKey)) continue
          edgeKeys.add(edgeKey)
          edges.push({ source: memberPath, target: reference.target })
        }
      }
      cycles.push({
        members: component.sort(),
        edges: edges.sort((left, right) =>
          `${left.source}\0${left.target}`.localeCompare(`${right.source}\0${right.target}`),
        ),
      })
    }
  }

  for (const sourcePath of sourcePaths) {
    if (!indexes.has(sourcePath)) visit(sourcePath)
  }
  return cycles
}

/** Validates module dependencies, public imports, scoped exceptions, and runtime cycles. */
export function checkArchitecture(
  rootPath: string,
  exceptions = readExceptions(resolve(rootPath)),
  cycleExceptions = readCycleExceptions(resolve(rootPath)),
): BoundaryDiagnostic[] {
  const root = resolve(rootPath)
  const sourcePaths = collectProductionSources(root)
  const sourceSet = new Set(sourcePaths)
  const compilerOptions = loadCompilerOptions(root)
  const importMap = new Map<string, ResolvedImport[]>()
  const diagnostics: BoundaryDiagnostic[] = []
  const usedExceptions = new Set<string>()
  const exceptionMap = new Map(exceptions.map((exception) => [`${exception.source}\0${exception.target}`, exception]))

  for (const sourcePath of sourcePaths) {
    const sourceFile = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true)
    const references = extractImports(sourceFile)
    const resolvedReferences: ResolvedImport[] = []

    for (const reference of references) {
      const sourceRelative = relativePath(root, sourcePath)
      const sourceLayer = classifySource(root, sourcePath)
      const targetPath = resolveImportTarget(reference.specifier, sourcePath, compilerOptions)
      const targetIsSource = targetPath !== undefined && relativePath(root, targetPath).startsWith("src/")
      const importedPackage = packageName(reference.specifier)
      if (
        (sourceLayer.kind === "module" || sourceLayer.kind === "platform") &&
        !targetIsSource &&
        importedPackage &&
        !APPROVED_ARCHITECTURE_PACKAGES.has(importedPackage)
      ) {
        diagnostics.push({
          source: sourceRelative,
          line: reference.line,
          message: `${sourceLayer.kind} imports unapproved external package ${importedPackage}; use an explicit port and adapter`,
        })
      }

      if (!targetPath || !sourceSet.has(targetPath)) continue
      const resolvedReference = { ...reference, target: targetPath }
      resolvedReferences.push(resolvedReference)

      const targetRelative = relativePath(root, targetPath)
      const targetLayer = classifySource(root, targetPath)
      const exceptionKey = `${sourceRelative}\0${targetRelative}`

      if (targetRelative.startsWith("src/app/legacy-bridges/")) {
        if (exceptionMap.has(exceptionKey)) {
          usedExceptions.add(exceptionKey)
        } else {
          diagnostics.push({
            source: sourceRelative,
            line: reference.line,
            message: `legacy bridge import to ${targetRelative} has no exact, documented exception`,
          })
        }
      }

      if (sourceLayer.kind === "module") {
        if (targetLayer.kind === "module") {
          const sameModule = sourceLayer.moduleName === targetLayer.moduleName
          const permittedModuleDependency =
            sourceLayer.moduleName === "inference" && targetLayer.moduleName === "session-recovery"
          if (!sameModule && !permittedModuleDependency) {
            diagnostics.push({
              source: sourceRelative,
              line: reference.line,
              message: `module dependency ${sourceLayer.moduleName} -> ${targetLayer.moduleName} is not allowed`,
            })
          }
          if (!sameModule && !isPublicModuleFile(root, targetPath, targetLayer.moduleName ?? "")) {
            diagnostics.push({
              source: sourceRelative,
              line: reference.line,
              message: `cross-module import reaches private file ${targetRelative}; use that module's public API`,
            })
          }
        } else if (targetLayer.kind !== "platform") {
          diagnostics.push({
            source: sourceRelative,
            line: reference.line,
            message: `module dependency to ${targetRelative} leaves modules/platform boundaries`,
          })
        }
      } else if (sourceLayer.kind === "platform") {
        if (targetLayer.kind !== "platform") {
          diagnostics.push({
            source: sourceRelative,
            line: reference.line,
            message: `platform dependency to ${targetRelative} points into a higher or legacy layer`,
          })
        }
      } else if (targetLayer.kind === "module" && !isPublicModuleFile(root, targetPath, targetLayer.moduleName ?? "")) {
        diagnostics.push({
          source: sourceRelative,
          line: reference.line,
          message: `cross-boundary import reaches private module file ${targetRelative}; use that module's public API`,
        })
      }
    }
    importMap.set(sourcePath, resolvedReferences)
  }

  for (const [exceptionKey, exception] of exceptionMap) {
    if (!usedExceptions.has(exceptionKey)) {
      diagnostics.push({
        source: exception.source,
        line: 1,
        message: `stale legacy exception for ${exception.target}; remove it or update its source and checkpoint`,
      })
    }
  }

  const usedCycleExceptions = new Set<string>()
  const cycleExceptionMap = new Map(cycleExceptions.map((exception) => [JSON.stringify(exception.edges), exception]))
  for (const cycle of findRuntimeCycles(sourcePaths, sourceSet, importMap)) {
    const members = cycle.members.map((sourcePath) => relativePath(root, sourcePath))
    const edges = cycle.edges
      .map((edge) => ({ source: relativePath(root, edge.source), target: relativePath(root, edge.target) }))
      .sort((left, right) => `${left.source}\0${left.target}`.localeCompare(`${right.source}\0${right.target}`))
    const cycleKey = JSON.stringify(edges)
    if (cycleExceptionMap.has(cycleKey)) {
      usedCycleExceptions.add(cycleKey)
      continue
    }
    diagnostics.push({
      source: members[0] ?? "src",
      line: 1,
      message: `runtime dependency cycle includes ${members.join(" ↔ ")}`,
    })
  }

  for (const [cycleKey, exception] of cycleExceptionMap) {
    if (!usedCycleExceptions.has(cycleKey)) {
      diagnostics.push({
        source: exception.edges[0]?.source ?? "src",
        line: 1,
        message: `stale runtime-cycle exception for ${exception.edges.map((edge) => `${edge.source} -> ${edge.target}`).join(", ")}; remove it or update its checkpoint`,
      })
    }
  }

  return diagnostics.sort((left, right) => left.source.localeCompare(right.source) || left.line - right.line)
}

/** Parses the optional root argument and runs the boundary check for that tree. */
function main(arguments_: readonly string[]): number {
  let rootPath = process.cwd()
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument !== "--root" || !arguments_[index + 1]) {
      console.error(`Unknown or incomplete argument: ${argument ?? ""}`)
      return 2
    }
    rootPath = resolve(arguments_[index + 1]!)
    index += 1
  }

  try {
    const diagnostics = checkArchitecture(rootPath)
    if (diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
        console.error(`${diagnostic.source}:${diagnostic.line}: ${diagnostic.message}`)
      }
      return 1
    }
    console.log(`Architecture boundaries passed for ${rootPath}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  process.exitCode = main(process.argv.slice(2))
}
