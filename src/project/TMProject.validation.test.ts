import { describe, expect, it } from "vitest";
import { TMCollection } from "../collection/TMCollection";
import { TMModel } from "../model/TMModel";
import { TMProject } from "./TMProject";

type Doc = { _id: string; value: number };

const sourceCollection = new TMCollection<Doc>({
  collectionName: "source",
});

describe("TMProject.validate()", () => {
  describe("valid projects", () => {
    it("should pass for a simple linear DAG", () => {
      const model1 = new TMModel({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const model2 = new TMModel({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const project = new TMProject({
        name: "test",
        models: [model1, model2],
      });

      const result = project.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass for a fan-out DAG", () => {
      const model1 = new TMModel({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const model2 = new TMModel({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const model3 = new TMModel({
        name: "model3",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const project = new TMProject({
        name: "test",
        models: [model1, model2, model3],
      });

      const result = project.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("missing dependencies", () => {
    it("should throw on construction when upstream model is missing", () => {
      const orphanUpstream = new TMModel({
        name: "orphan_upstream",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const model = new TMModel({
        name: "model",
        from: orphanUpstream, // depends on model not in project
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      // Should throw because orphanUpstream is not in the project
      expect(() => {
        new TMProject({
          name: "test",
          models: [model], // Only add `model`, not `orphanUpstream`
        });
      }).toThrow(/orphan_upstream/);
    });
  });

  describe("warnings", () => {
    it("should warn about multiple leaf models", () => {
      const model1 = new TMModel({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const model2 = new TMModel({
        name: "model2",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const model3 = new TMModel({
        name: "model3",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: TMModel.Mode.Replace },
      });

      const project = new TMProject({
        name: "test",
        models: [model1, model2, model3],
      });

      const result = project.validate();
      expect(result.valid).toBe(true); // Still valid, just has warnings
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe("orphan");
      expect(result.warnings[0]?.models).toContain("model1");
      expect(result.warnings[0]?.models).toContain("model2");
      expect(result.warnings[0]?.models).toContain("model3");
    });
  });
});
