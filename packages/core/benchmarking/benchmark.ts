#!/usr/bin/env bun
/**
 * Shared Benchmark Utility for TypeScript Performance Testing
 *
 * This module provides reusable functions for benchmarking TypeScript compilation
 * performance. It handles common tasks like:
 * - Parsing TypeScript extended diagnostics
 * - Clearing TypeScript cache
 * - Measuring compilation time
 * - Comparing baseline vs benchmark results
 * - Saving results to JSON
 *
 * Usage:
 *   import { runBenchmarkSuite, BenchmarkConfig } from "./benchmark";
 *
 *   const config: BenchmarkConfig = {
 *     name: "My Benchmark",
 *     benchmarkFileName: "my-benchmark-test.ts",
 *     createBenchmarkFile: (ops, path) => { ... },
 *     operationCounts: [3, 5, 10],
 *     iterations: 1, // or 10 for averaging
 *   };
 *
 *   runBenchmarkSuite(config);
 */

import { execSync } from "child_process";
import { performance } from "perf_hooks";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

// Get package root directory (packages/core/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..");

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkResult {
  // Metadata
  timestamp: string;
  operations?: number; // Number of operations being tested
  hasDepthError?: boolean; // True if type instantiation depth limit was hit

  // Baseline metrics (project without benchmark file)
  baseline: {
    compilationTime: number; // Baseline compilation time
    typeInstantiations?: number; // Baseline type instantiations
    filesChecked?: number; // Baseline files checked
  };

  // Benchmark metrics (with benchmark file)
  benchmark: {
    compilationTime: number; // Benchmark compilation time
    typeInstantiations?: number; // Benchmark type instantiations
    filesChecked?: number; // Benchmark files checked
  };

  // Deltas (benchmark - baseline)
  delta: {
    compilationTime: number; // Difference in compilation time
    typeInstantiations?: number; // Difference in type instantiations
  };
}

export interface CompilationResult {
  time: number;
  success: boolean;
  typeInstantiations?: number;
  filesChecked?: number;
  hasDepthError?: boolean;
}

export interface FileInfo {
  lines: number;
  size: number;
}

export interface BenchmarkConfig {
  /** Function to create the benchmark file content */
  createBenchmarkFile: (operationCount: number, outputPath: string) => FileInfo;
  /** Array of operation counts to test */
  operationCounts: number[];
  /** Number of iterations to run and average (default: 3) */
  iterations?: number;
}

// ============================================================================
// Shared Utility Functions
// ============================================================================

/**
 * Parse extended diagnostics from TypeScript output
 * Extracts type instantiations, files checked, etc.
 */
export function parseExtendedDiagnostics(output: string): {
  typeInstantiations?: number;
  filesChecked?: number;
} {
  const result: { typeInstantiations?: number; filesChecked?: number } = {};

  // Extract type instantiations
  // TypeScript outputs: "Type instantiation count: 1234567" or "Instantiations: 1234567"
  const instantiationsMatch =
    output.match(/Type instantiation count[:\s]+(\d+)/i) ||
    output.match(/Instantiations[:\s]+(\d+)/i);
  if (instantiationsMatch && instantiationsMatch[1]) {
    const parsed = parseInt(instantiationsMatch[1], 10);
    if (!isNaN(parsed)) {
      result.typeInstantiations = parsed;
    }
  }

  // Extract files checked
  // TypeScript outputs: "Files: 204"
  const filesMatch = output.match(/Files[:\s]+(\d+)/i);
  if (filesMatch && filesMatch[1]) {
    const parsed = parseInt(filesMatch[1], 10);
    if (!isNaN(parsed)) {
      result.filesChecked = parsed;
    }
  }

  return result;
}

/**
 * Clear TypeScript incremental cache for consistent measurements
 */
export function clearTSCache(): void {
  const cacheFiles = [
    join(PACKAGE_ROOT, "tsconfig.tsbuildinfo"),
    join(PACKAGE_ROOT, ".tsbuildinfo"),
  ];
  cacheFiles.forEach((file) => {
    if (existsSync(file)) {
      try {
        execSync(`rm -f "${file}"`, { stdio: "ignore" });
      } catch {
        // Ignore errors
      }
    }
  });
}

/**
 * Measure TypeScript compilation time and diagnostics
 */
export function measureCompilation(
  _filePath: string,
  clearCache = false
): CompilationResult {
  if (clearCache) {
    clearTSCache();
  }

  const startTime = performance.now();
  try {
    const output = execSync(
      `npx tsc --noEmit --project tsconfig.benchmark.json --extendedDiagnostics 2>&1`,
      {
        encoding: "utf-8",
        cwd: PACKAGE_ROOT,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }
    );

    const endTime = performance.now();
    const time = endTime - startTime;

    const diagnostics = parseExtendedDiagnostics(output);
    const hasDepthError = output.includes(
      "Type instantiation is excessively deep"
    );

    const result: CompilationResult = {
      time,
      success: !hasDepthError,
      hasDepthError,
    };
    if (diagnostics.typeInstantiations !== undefined) {
      result.typeInstantiations = diagnostics.typeInstantiations;
    }
    if (diagnostics.filesChecked !== undefined) {
      result.filesChecked = diagnostics.filesChecked;
    }
    return result;
  } catch (error: any) {
    const endTime = performance.now();
    const time = endTime - startTime;

    const output = error.stdout?.toString() || error.message || "";
    const diagnostics = parseExtendedDiagnostics(output);
    const hasDepthError =
      output.includes("Type instantiation is excessively deep") ||
      output.includes("ts(2589)") ||
      output.includes("possibly infinite");

    const result: CompilationResult = {
      time,
      success: false,
      hasDepthError,
    };
    if (diagnostics.typeInstantiations !== undefined) {
      result.typeInstantiations = diagnostics.typeInstantiations;
    }
    if (diagnostics.filesChecked !== undefined) {
      result.filesChecked = diagnostics.filesChecked;
    }
    return result;
  }
}

/**
 * Measure baseline (project without benchmark file)
 */
export function measureBaseline(benchmarkFile: string): {
  time: number;
  typeInstantiations?: number;
  filesChecked?: number;
} {
  if (existsSync(benchmarkFile)) {
    try {
      unlinkSync(benchmarkFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Clear cache before baseline measurement
  clearTSCache();

  const projectFile = join(PACKAGE_ROOT, "src/index.ts");

  // Warm-up run (with cache clear)
  measureCompilation(projectFile, true);

  // Run multiple times and take average
  const runs = 3;
  const times: number[] = [];
  const instantiationsValues: number[] = [];
  const filesCheckedValues: number[] = [];

  for (let i = 0; i < runs; i++) {
    // Ensure benchmark file is deleted before each measurement
    if (existsSync(benchmarkFile)) {
      try {
        unlinkSync(benchmarkFile);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clear cache before each measurement for consistency
    clearTSCache();
    const result = measureCompilation(projectFile, true);
    times.push(result.time);
    if (result.typeInstantiations !== undefined) {
      instantiationsValues.push(result.typeInstantiations);
    }
    if (result.filesChecked !== undefined) {
      filesCheckedValues.push(result.filesChecked);
    }
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const avgInstantiations =
    instantiationsValues.length > 0 ?
      instantiationsValues.reduce((a, b) => a + b, 0) /
      instantiationsValues.length
    : undefined;
  // Round filesChecked to integer (should be consistent across runs)
  const avgFilesChecked =
    filesCheckedValues.length > 0 ?
      Math.round(
        filesCheckedValues.reduce((a, b) => a + b, 0) /
          filesCheckedValues.length
      )
    : undefined;

  const result: {
    time: number;
    typeInstantiations?: number;
    filesChecked?: number;
  } = {
    time: avgTime,
  };

  if (avgInstantiations !== undefined) {
    result.typeInstantiations = avgInstantiations;
  }
  if (avgFilesChecked !== undefined) {
    result.filesChecked = avgFilesChecked;
  }

  return result;
}

/**
 * Extract benchmark name from file path
 * e.g., "/path/to/benchmarking/without-dotted-keys.ts" -> "without-dotted-keys"
 * Uses Error stack trace to find the calling file
 */
export function extractBenchmarkName(filePath?: string): string {
  if (filePath) {
    // If filePath is provided, use it directly
    const fileName = basename(filePath, ".ts");
    return fileName;
  }

  // Use Error stack trace to find the calling file (works in Bun and Node.js)
  try {
    const stack = new Error().stack;
    if (stack) {
      // Parse stack trace to find the caller
      // Stack format: "at functionName (file:///path/to/file.ts:line:col)"
      const stackLines = stack.split("\n");
      // Skip the first line (Error message) and find the first file that's not benchmark.ts
      for (let i = 1; i < stackLines.length; i++) {
        const line = stackLines[i];
        if (!line) continue;

        // Look for file paths in the stack - try multiple patterns
        const patterns = [
          /\(([^)]+\.ts):\d+:\d+\)/, // (file.ts:line:col)
          /at .+ \(([^)]+\.ts):\d+:\d+\)/, // at function (file.ts:line:col)
          /([^/\s]+\.ts):\d+:\d+/, // file.ts:line:col
        ];

        for (const pattern of patterns) {
          const fileMatch = line.match(pattern);
          if (fileMatch && fileMatch[1]) {
            const filePath = fileMatch[1];
            // Skip benchmark.ts itself and look for files in benchmarking/ directory
            if (
              !filePath.includes("benchmark.ts") &&
              filePath.includes("benchmarking/")
            ) {
              const fileName = basename(filePath, ".ts");
              // Make sure it's not an empty string
              if (fileName && fileName !== "benchmark") {
                return fileName;
              }
            }
          }
        }
      }
    }
  } catch {
    // Fall through to process.argv
  }

  // Fallback to process.argv (Node.js/Bun) - this gets the script that was run
  if (typeof process !== "undefined" && process.argv && process.argv[1]) {
    const scriptPath = process.argv[1];
    // Check if it's a benchmarking file
    if (scriptPath.includes("benchmarking/")) {
      const fileName = basename(scriptPath, ".ts");
      if (fileName && fileName !== "benchmark") {
        return fileName;
      }
    }
  }

  throw new Error(
    "Could not determine benchmark name. Please provide it explicitly or ensure the script is run directly."
  );
}

/**
 * Get benchmark directory paths
 */
export function getBenchmarkPaths(name: string): {
  benchmarkDir: string;
  benchmarkFile: string;
  runsDir: string;
} {
  const benchmarkDir = join(PACKAGE_ROOT, "benchmarks", name);
  const benchmarkFile = join(benchmarkDir, "index.ts");
  const runsDir = join(benchmarkDir, "runs");
  return { benchmarkDir, benchmarkFile, runsDir };
}

/**
 * Clean all TypeScript files from benchmarks directory
 * This ensures previous runs don't affect the current benchmark
 */
export function cleanBenchmarkFiles(): void {
  try {
    const benchmarksDir = join(PACKAGE_ROOT, "benchmarks");
    if (!existsSync(benchmarksDir)) {
      return; // Directory doesn't exist, nothing to clean
    }

    // Find and delete all .ts files recursively in benchmarks/
    execSync(
      `find "${benchmarksDir}" -name "*.ts" -type f -delete 2>/dev/null || true`,
      { stdio: "ignore" }
    );
  } catch {
    // Ignore errors - cleanup is best effort
  }
}

/**
 * Run a single benchmark iteration
 */
export function runBenchmarkIteration(
  config: BenchmarkConfig,
  name: string,
  operationCount: number
): BenchmarkResult {
  const { benchmarkFile, runsDir } = getBenchmarkPaths(name);

  // Ensure runs directory exists
  try {
    execSync(`mkdir -p "${runsDir}"`, { stdio: "ignore" });
  } catch {
    // Ignore errors
  }

  console.log(`\n📊 Benchmark: ${operationCount} operations (${name})`);

  // Ensure benchmark file is deleted before baseline measurement
  if (existsSync(benchmarkFile)) {
    try {
      unlinkSync(benchmarkFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Measure baseline (project without benchmark file)
  console.log("   📏 Measuring baseline (project without benchmark file)...");
  clearTSCache();
  const baseline = measureBaseline(benchmarkFile);

  // Create benchmark file
  const fileInfo = config.createBenchmarkFile(operationCount, benchmarkFile);
  console.log(
    `   File: ${fileInfo.lines} lines, ${(fileInfo.size / 1024).toFixed(2)} KB`
  );

  // Measure benchmark
  clearTSCache();
  const benchmark = measureCompilation(benchmarkFile, true);
  const benchmarkInstStr =
    benchmark.typeInstantiations?.toLocaleString() || "N/A";
  const baselineInstStr2 =
    baseline.typeInstantiations?.toLocaleString() || "N/A";

  // Calculate differences
  const timeDiff = benchmark.time - baseline.time;
  const instantiationsDiff =
    benchmark.typeInstantiations && baseline.typeInstantiations ?
      benchmark.typeInstantiations - baseline.typeInstantiations
    : undefined;

  // Don't cleanup files - keep them for inspection

  // Display results
  console.log(
    `   Baseline: ${baseline.time.toFixed(
      2
    )}ms, ${baselineInstStr2} instantiations`
  );
  console.log(
    `   Benchmark: ${benchmark.time.toFixed(
      2
    )}ms, ${benchmarkInstStr} instantiations`
  );

  if (benchmark.hasDepthError) {
    console.log(`   ⚠️  WARNING: Type instantiation depth limit hit!`);
  }

  if (timeDiff >= 0) {
    console.log(`   ✅ Delta: ${timeDiff.toFixed(2)}ms`);
  } else {
    console.log(
      `   ⚠️  Delta: ${timeDiff.toFixed(2)}ms (negative - possible cache issue)`
    );
  }

  if (instantiationsDiff !== undefined) {
    if (instantiationsDiff >= 0) {
      console.log(
        `   🔢 Delta Instantiations: +${instantiationsDiff.toLocaleString()}`
      );
    } else {
      console.log(
        `   ⚠️  Delta Instantiations: ${instantiationsDiff.toLocaleString()} (negative - possible cache issue)`
      );
    }
  }

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    operations: operationCount,
    baseline: {
      compilationTime: baseline.time,
    },
    benchmark: {
      compilationTime: benchmark.time,
    },
    delta: {
      compilationTime: timeDiff,
    },
  };

  if (benchmark.hasDepthError) {
    result.hasDepthError = true;
  }

  if (baseline.typeInstantiations !== undefined) {
    result.baseline.typeInstantiations = baseline.typeInstantiations;
  }
  if (baseline.filesChecked !== undefined) {
    result.baseline.filesChecked = baseline.filesChecked;
  }

  if (benchmark.typeInstantiations !== undefined) {
    result.benchmark.typeInstantiations = benchmark.typeInstantiations;
  }
  if (benchmark.filesChecked !== undefined) {
    result.benchmark.filesChecked = benchmark.filesChecked;
  }

  if (instantiationsDiff !== undefined) {
    result.delta.typeInstantiations = instantiationsDiff;
  }

  return result;
}

/**
 * Run benchmark multiple times and average results
 */
export function runBenchmarkMultipleTimes(
  config: BenchmarkConfig,
  name: string,
  operationCount: number,
  iterations: number
): BenchmarkResult {
  console.log(`\n🔄 Running ${iterations} iterations for averaging...`);
  const iterationResults: BenchmarkResult[] = [];

  for (let i = 0; i < iterations; i++) {
    console.log(`\n   Iteration ${i + 1}/${iterations}:`);
    const result = runBenchmarkIteration(config, name, operationCount);
    iterationResults.push(result);

    // If we hit depth limit, stop iterating early
    if (result.hasDepthError) {
      console.log(
        `\n   ⚠️  Depth limit hit in iteration ${i + 1} - stopping early`
      );
      break;
    }
  }

  // Calculate averages for delta
  const avgCompilationTime =
    iterationResults.reduce((sum, r) => sum + r.delta.compilationTime, 0) /
    iterationResults.length;

  // Calculate average baseline metrics
  const avgBaselineTime =
    iterationResults.reduce((sum, r) => sum + r.baseline.compilationTime, 0) /
    iterationResults.length;

  // Calculate average benchmark metrics
  const avgBenchmarkTime =
    iterationResults.reduce((sum, r) => sum + r.benchmark.compilationTime, 0) /
    iterationResults.length;

  // Calculate average instantiations (if available)
  const deltaInstantiationsResults = iterationResults.filter(
    (r) => r.delta.typeInstantiations !== undefined
  );
  const avgTypeInstantiations =
    deltaInstantiationsResults.length > 0 ?
      deltaInstantiationsResults.reduce(
        (sum, r) => sum + (r.delta.typeInstantiations || 0),
        0
      ) / deltaInstantiationsResults.length
    : undefined;

  const avgBaselineInstantiations =
    (
      iterationResults.filter(
        (r) => r.baseline.typeInstantiations !== undefined
      ).length > 0
    ) ?
      iterationResults
        .filter((r) => r.baseline.typeInstantiations !== undefined)
        .reduce((sum, r) => sum + (r.baseline.typeInstantiations || 0), 0) /
      iterationResults.filter(
        (r) => r.baseline.typeInstantiations !== undefined
      ).length
    : undefined;

  const avgBenchmarkInstantiations =
    (
      iterationResults.filter(
        (r) => r.benchmark.typeInstantiations !== undefined
      ).length > 0
    ) ?
      iterationResults
        .filter((r) => r.benchmark.typeInstantiations !== undefined)
        .reduce((sum, r) => sum + (r.benchmark.typeInstantiations || 0), 0) /
      iterationResults.filter(
        (r) => r.benchmark.typeInstantiations !== undefined
      ).length
    : undefined;

  const avgBaselineFilesChecked =
    (
      iterationResults.filter((r) => r.baseline.filesChecked !== undefined)
        .length > 0
    ) ?
      Math.round(
        iterationResults
          .filter((r) => r.baseline.filesChecked !== undefined)
          .reduce((sum, r) => sum + (r.baseline.filesChecked || 0), 0) /
          iterationResults.filter((r) => r.baseline.filesChecked !== undefined)
            .length
      )
    : undefined;

  const avgBenchmarkFilesChecked =
    (
      iterationResults.filter((r) => r.benchmark.filesChecked !== undefined)
        .length > 0
    ) ?
      Math.round(
        iterationResults
          .filter((r) => r.benchmark.filesChecked !== undefined)
          .reduce((sum, r) => sum + (r.benchmark.filesChecked || 0), 0) /
          iterationResults.filter((r) => r.benchmark.filesChecked !== undefined)
            .length
      )
    : undefined;

  // Calculate standard deviation
  const timeValues = iterationResults.map((r) => r.delta.compilationTime);
  const mean = avgCompilationTime;
  const variance =
    timeValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    timeValues.length;
  const stdDev = Math.sqrt(variance);

  console.log(`\n📊 Average Results (${iterations} iterations):`);
  console.log(`   Delta: ${avgCompilationTime.toFixed(2)}ms`);
  console.log(`   Std Dev: ${stdDev.toFixed(2)}ms`);
  if (avgTypeInstantiations !== undefined) {
    console.log(
      `   Delta Instantiations: +${Math.round(
        avgTypeInstantiations
      ).toLocaleString()}`
    );
  }

  // Check if any iteration hit depth limit
  const hasDepthError = iterationResults.some((r) => r.hasDepthError === true);

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    operations: operationCount,
    hasDepthError,
    baseline: {
      compilationTime: avgBaselineTime,
    },
    benchmark: {
      compilationTime: avgBenchmarkTime,
    },
    delta: {
      compilationTime: avgCompilationTime,
    },
  };

  if (avgBaselineInstantiations !== undefined) {
    result.baseline.typeInstantiations = avgBaselineInstantiations;
  }
  if (avgBaselineFilesChecked !== undefined) {
    result.baseline.filesChecked = avgBaselineFilesChecked;
  }

  if (avgBenchmarkInstantiations !== undefined) {
    result.benchmark.typeInstantiations = avgBenchmarkInstantiations;
  }
  if (avgBenchmarkFilesChecked !== undefined) {
    result.benchmark.filesChecked = avgBenchmarkFilesChecked;
  }

  if (avgTypeInstantiations !== undefined) {
    result.delta.typeInstantiations = avgTypeInstantiations;
  }

  return result;
}

/**
 * Run a complete benchmark suite
 * @param config Benchmark configuration
 * @param name Optional benchmark name. If not provided, will be extracted from the calling file.
 */
export function runBenchmarkSuite(
  config: BenchmarkConfig,
  name?: string
): BenchmarkResult[] {
  // Extract name from file if not provided
  const benchmarkName = name || extractBenchmarkName();

  const iterations = config.iterations || 3;
  const results: BenchmarkResult[] = [];

  // Clean all .ts files from benchmarks directory before running
  console.log(`\n🧹 Cleaning previous benchmark files...`);
  cleanBenchmarkFiles();

  // Ensure benchmark directory exists
  const { benchmarkDir, runsDir } = getBenchmarkPaths(benchmarkName);
  try {
    execSync(`mkdir -p "${runsDir}"`, { stdio: "ignore" });
  } catch {
    // Ignore errors
  }

  console.log(`\n🚀 ${benchmarkName}`);
  console.log(`📁 Generated files: ${benchmarkDir}`);
  console.log(`📊 Results: ${runsDir}`);
  console.log("=".repeat(70));
  if (iterations > 1) {
    console.log(
      `Running ${iterations} iterations per test for accurate averaging`
    );
  }
  console.log("");

  for (const operationCount of config.operationCounts) {
    const result =
      iterations > 1 ?
        runBenchmarkMultipleTimes(
          config,
          benchmarkName,
          operationCount,
          iterations
        )
      : runBenchmarkIteration(config, benchmarkName, operationCount);
    results.push(result);

    // Check if we hit depth limit - if so, stop here
    if (result.hasDepthError) {
      console.log(
        `\n⚠️  ${operationCount} operations: ${result.delta.compilationTime.toFixed(
          2
        )}ms delta (DEPTH LIMIT HIT - stopping benchmark suite)`
      );
      console.log(
        `\n⚠️  Benchmark suite stopped early due to type instantiation depth limit.`
      );
      console.log(`📁 Generated files preserved in: ${benchmarkDir}`);
      break; // Stop processing remaining operation counts
    }

    console.log(
      `\n✅ ${operationCount} operations${
        iterations > 1 ? " (averaged)" : ""
      }: ${result.delta.compilationTime.toFixed(2)}ms delta`
    );
  }

  // Generate summary report
  console.log("\n" + "=".repeat(70));
  console.log("📈 Summary Report");
  console.log("=".repeat(70));
  console.log("");
  console.log("Operations | Type Check (ms) | Per Op (ms)");
  console.log("-".repeat(35));

  results.forEach((r) => {
    const ops = r.operations || 1;
    const perOp = r.delta.compilationTime / ops;
    console.log(
      `${ops.toString().padStart(9)} | ${r.delta.compilationTime
        .toFixed(2)
        .padStart(15)} | ${perOp.toFixed(2).padStart(10)}`
    );
  });

  console.log("");
  console.log("📊 Averages:");
  const avgTime =
    results.reduce((sum, r) => sum + r.delta.compilationTime, 0) /
    results.length;
  console.log(`   Delta: ${avgTime.toFixed(2)}ms`);

  // Save results with ISO date filename
  const isoDate = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, -5); // Format: 2025-11-17_15-30-45
  const resultsFile = join(runsDir, `${isoDate}.json`);
  writeFileSync(resultsFile, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n💾 Full report saved to: ${resultsFile}`);

  return results;
}
