#!/usr/bin/env bun
/**
 * Benchmark Definition: $set Stage - Non-Dotted Keys Only
 *
 * This benchmark measures TypeScript compilation performance for chained $set operations
 * WITHOUT dotted keys (e.g., "address.city"). This tests the early exit optimization.
 *
 * Run with: bun run benchmarking/without-dotted-keys.ts
 */

import { runBenchmarkSuite, BenchmarkConfig } from "./benchmark";
import { writeFileSync } from "fs";
import { Buffer } from "node:buffer";

// Create a test file with chained set operations (NO dotted keys)
function createBenchmarkFile(
  setOperations: number,
  outputPath: string
): { lines: number; size: number } {
  const imports = `import { Pipeline } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";`;

  const schema = `
type TestSchema = {
  id: string;
  name: string;
  age: number;
  email?: string;
  active: boolean;
  score: number;
  tags: string[];
  metadata?: {
    created: Date;
    version: number;
  };
};
`;

  let pipelineCode = `
const _benchmarkPipeline = new Pipeline<TestSchema>()`;

  // Generate chained set operations - ONLY non-dotted keys
  for (let i = 0; i < setOperations; i++) {
    const operations: string[] = [];

    // Vary which fields are set to create different type instantiations
    operations.push(`name: "User ${i}"`);
    operations.push(`age: ${20 + i}`);
    operations.push(`active: ${i % 2 === 0}`);
    operations.push(`score: ${100 + i}`);

    // Vary array structures
    if (i % 3 === 0) {
      operations.push(`tags: ["tag${i}1", "tag${i}2"]`);
    } else if (i % 3 === 1) {
      operations.push(`tags: ["tag${i}a", "tag${i}b", "tag${i}c"]`);
    } else {
      operations.push(`tags: ["single${i}"]`);
    }

    // Vary optional field setting
    if (i % 2 === 0) {
      operations.push(`email: "user${i}@example.com"`);
    }

    // Vary nested object structures (but NOT using dotted keys)
    if (i % 4 === 0) {
      operations.push(`metadata: { version: ${i} }`);
    } else if (i % 4 === 1) {
      operations.push(`metadata: { version: ${i}, created: new Date() }`);
    }

    pipelineCode += `\n  .set({\n    ${operations.join(",\n    ")}\n  })`;
  }

  pipelineCode += `;\n\ntype _Output = InferOutputType<typeof _benchmarkPipeline>;\n`;

  const content = imports + schema + pipelineCode;
  writeFileSync(outputPath, content, "utf-8");

  const lines = content.split("\n").length;
  const size = Buffer.byteLength(content, "utf-8");

  return { lines, size };
}

const config: BenchmarkConfig = {
  createBenchmarkFile,
  operationCounts: [3],
};

if (import.meta.main) {
  runBenchmarkSuite(config);
}
