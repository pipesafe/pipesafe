#!/usr/bin/env bun
/**
 * Performance Benchmark for $project Stage
 *
 * This script measures TypeScript compilation performance for chained $project operations.
 * Tests various projection scenarios including:
 * - Basic field inclusion/exclusion
 * - Field renaming with field references
 * - Dotted key projections (nested field access)
 * - Nested object replacements
 * - Mixed projection modes
 *
 * Run with: bun run benchmarking/project.ts
 */

import { runBenchmarkSuite, BenchmarkConfig, FileInfo } from "./benchmark.js";
import process from "node:process";
import { writeFileSync } from "fs";
import { Buffer } from "node:buffer";

// Create a test file with chained project operations
function createBenchmarkFile(
  projectOperations: number,
  outputPath: string
): FileInfo {
  const imports = `import { Pipeline } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";
`;

  const schema = `
type TestSchema = {
  _id: string;
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

  // Throw if more than 10 operations requested (we only have 10 hardcoded stages)
  if (projectOperations > 10) {
    throw new Error(
      `Maximum 10 projection operations supported. Requested: ${projectOperations}`
    );
  }

  let pipelineCode = `
const _benchmarkPipeline = new Pipeline<TestSchema>()`;

  // Hardcoded 10 projection stages that work together correctly
  const stages = [
    // Stage 1: Basic inclusion with dotted keys
    {
      _id: 1,
      name: 1,
      age: 1,
      "address.city": 1,
      "address.street": 1,
      "metadata.version": 1,
    },
    // Stage 2: Field renaming
    {
      firstName: "$name",
      userAge: "$age",
      location: "$address.city",
      version: "$metadata.version",
    },
    // Stage 3: Include only specific fields (from renamed fields)
    {
      _id: 1,
      firstName: 1,
      userAge: 1,
      location: 1,
    },
    // Stage 4: More field renaming
    {
      fullName: "$firstName",
      ageInYears: "$userAge",
      city: "$location",
    },
    // Stage 5: Inclusion with nested object
    {
      _id: 1,
      fullName: 1,
      ageInYears: 1,
      address: {
        city: "$city",
      },
    },
    // Stage 6: Basic inclusion
    {
      _id: 1,
      fullName: 1,
      ageInYears: 1,
      "address.city": 1,
    },
    // Stage 7: Field renaming again
    {
      id: "$_id",
      name: "$fullName",
      age: "$ageInYears",
      location: "$address.city",
    },
    // Stage 8: Inclusion
    {
      _id: 1,
      id: 1,
      name: 1,
      age: 1,
      location: 1,
    },
    // Stage 9: More renaming
    {
      userId: "$id",
      userName: "$name",
      userAge: "$age",
      userLocation: "$location",
    },
    // Stage 10: Final inclusion
    {
      _id: 1,
      userId: 1,
      userName: 1,
      userAge: 1,
      userLocation: 1,
    },
  ];

  // Apply only the requested number of stages
  for (let i = 0; i < projectOperations; i++) {
    const stage = stages[i] as Record<
      string,
      string | number | Record<string, unknown>
    >;
    const fields = Object.entries(stage).map(([key, value]) => {
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        // Nested object
        const nestedFields = Object.entries(value as Record<string, unknown>)
          .map(([nk, nv]) => `      ${nk}: ${JSON.stringify(nv)}`)
          .join(",\n");
        return `${key}: {\n${nestedFields}\n    }`;
      }
      return `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    });
    pipelineCode += `\n  .project({\n    ${fields.join(",\n    ")}\n  })`;
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
  operationCounts: [3, 5, 10], // All supported (max 10)
  iterations: 3, // Multiple iterations for averaging
};

// Run the benchmark suite
if (
  typeof process !== "undefined" &&
  process.argv.length > 0 &&
  (process.argv[1]?.endsWith("benchmarking/project.ts") ||
    process.argv[1]?.endsWith("benchmarking/project.js"))
) {
  runBenchmarkSuite(config, "project");
}

export { createBenchmarkFile, config };
