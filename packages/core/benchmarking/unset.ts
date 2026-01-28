#!/usr/bin/env bun
/**
 * Performance Benchmark for $unset Stage Optimizations
 *
 * This script measures TypeScript compilation performance for chained $unset operations.
 * Uses the generic benchmark utility from benchmark.ts
 *
 * Run with: bun run benchmarking/unset.ts
 */

import { runBenchmarkSuite, BenchmarkConfig, FileInfo } from "./benchmark.js";
import process from "node:process";
import { writeFileSync } from "fs";
import { Buffer } from "node:buffer";

// Create a test file with chained unset operations
function createBenchmarkFile(
  unsetOperations: number,
  outputPath: string
): FileInfo {
  const imports = `import { Pipeline } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";
`;

  const schema = `
type TestSchema = {
  id: string;
  name: string;
  age: number;
  email?: string;
  phone?: string;
  active?: boolean;
  score?: number;
  address?: {
    street: string;
    city: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  tags: string[];
  categories?: string[];
  metadata?: {
    created: Date;
    updated?: Date;
    version: number;
    source?: string;
  };
  profile?: {
    bio?: string;
    avatar?: string;
    website?: string;
    settings?: {
      theme?: string;
      notifications?: boolean;
      language?: string;
      timezone?: string;
    };
  };
  preferences?: {
    emailNotifications?: boolean;
    smsNotifications?: boolean;
    marketing?: boolean;
  };
  stats?: {
    views?: number;
    likes?: number;
    shares?: number;
  };
};
`;

  let pipelineCode = `
const _benchmarkPipeline = new Pipeline<TestSchema>()`;

  // Track which fields have been removed to avoid invalid operations
  const removedFields = new Set<string>();

  // Available fields to unset (in order of preference)
  const topLevelFields = [
    "age",
    "email",
    "name",
    "id",
    "phone",
    "active",
    "score",
  ];
  const nestedFields = [
    "address.zip",
    "address.street",
    "address.city",
    "address.state",
    "address.country",
    "metadata.updated",
    "metadata.created",
    "metadata.source",
  ];
  const deepNestedFields = [
    "profile.settings.theme",
    "profile.bio",
    "profile.avatar",
    "profile.website",
    "profile.settings.notifications",
    "profile.settings.language",
    "profile.settings.timezone",
    "preferences.emailNotifications",
    "preferences.smsNotifications",
    "preferences.marketing",
    "stats.views",
    "stats.likes",
    "stats.shares",
  ];

  // Generate chained unset operations
  // Vary the structure to prevent TypeScript from deduplicating similar types
  for (let i = 0; i < unsetOperations; i++) {
    const operations: string[] = [];

    // Select top-level field based on index, skipping already removed ones
    const topLevelIndex = i % topLevelFields.length;
    const topLevelField = topLevelFields[topLevelIndex];
    if (topLevelField && !removedFields.has(topLevelField)) {
      operations.push(`"${topLevelField}"`);
      removedFields.add(topLevelField);
    }

    // Select nested field based on index, skipping already removed ones
    const nestedIndex = i % nestedFields.length;
    const nestedField = nestedFields[nestedIndex];
    if (nestedField && !removedFields.has(nestedField)) {
      operations.push(`"${nestedField}"`);
      removedFields.add(nestedField);
    }

    // Select deep nested field based on index, skipping already removed ones
    const deepIndex = i % deepNestedFields.length;
    const deepField = deepNestedFields[deepIndex];
    if (deepField && !removedFields.has(deepField)) {
      operations.push(`"${deepField}"`);
      removedFields.add(deepField);
    }

    // Only add the unset call if we have operations to perform
    if (operations.length > 0) {
      pipelineCode += `\n  .unset([${operations.join(", ")}])`;
    }
  }

  pipelineCode += `;\n\nexport type BenchmarkOutput = InferOutputType<typeof _benchmarkPipeline>;\n`;

  const fullContent = imports + schema + pipelineCode;
  writeFileSync(outputPath, fullContent, "utf-8");

  // Count lines and size
  const lines = fullContent.split("\n").length;
  const size = Buffer.byteLength(fullContent, "utf-8");

  return { lines, size };
}

// Benchmark configuration
const config: BenchmarkConfig = {
  createBenchmarkFile,
  operationCounts: [3, 5, 10],
  iterations: 3, // Single iteration for faster results
};

// Run the benchmark suite
if (
  typeof process !== "undefined" &&
  process.argv.length > 0 &&
  (process.argv[1]?.endsWith("benchmarking/unset.ts") ||
    process.argv[1]?.endsWith("benchmarking/unset.js"))
) {
  runBenchmarkSuite(config, "unset");
}

export { createBenchmarkFile, config };
