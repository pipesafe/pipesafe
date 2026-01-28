import { describe, expect, it } from "vitest";
import { Collection } from "@pipesafe/core";
import { Model } from "../model/Model";
import { Project } from "./Project";

type Doc = { _id: string; value: number };

const sourceCollection = new Collection<Doc>({
  collectionName: "source",
});

describe("Project", () => {
  describe("auto-discovery", () => {
    it("should automatically include upstream dependencies", () => {
      const model1 = new Model({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model2 = new Model({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      // Only specify model2 - model1 should be auto-discovered as dependency
      const project = new Project({
        name: "test",
        models: [model2],
      });

      // model1 should be automatically included
      expect(project.getModel("model1")).toBe(model1);
      expect(project.getModel("model2")).toBe(model2);
      expect(project.getModels()).toHaveLength(2);
    });

    it("should handle deep dependency chains", () => {
      const model1 = new Model({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model2 = new Model({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model3 = new Model({
        name: "model3",
        from: model2,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      // Only specify model3 - model1 and model2 should be auto-discovered
      const project = new Project({
        name: "test",
        models: [model3],
      });

      expect(project.getModels()).toHaveLength(3);
      expect(project.getModel("model1")).toBe(model1);
      expect(project.getModel("model2")).toBe(model2);
      expect(project.getModel("model3")).toBe(model3);
    });

    it("should deduplicate when model is specified multiple times via dependencies", () => {
      const model1 = new Model({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model2 = new Model({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      // Explicitly include model1 even though it's a dependency of model2
      const project = new Project({
        name: "test",
        models: [model1, model2],
      });

      // Should not have duplicates
      expect(project.getModels()).toHaveLength(2);
    });
  });

  describe("plan()", () => {
    it("should create valid execution plan", () => {
      const model1 = new Model({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model2 = new Model({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model3 = new Model({
        name: "model3",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const project = new Project({
        name: "test",
        models: [model1, model2, model3],
      });

      const plan = project.plan();
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0]).toContain("model1");
      expect(plan.stages[1]).toContain("model2");
      expect(plan.stages[1]).toContain("model3");
    });
  });

  describe("toMermaid()", () => {
    it("should generate valid Mermaid syntax", () => {
      const model1 = new Model({
        name: "model1",
        from: sourceCollection,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model2 = new Model({
        name: "model2",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const model3 = new Model({
        name: "model3",
        from: model1,
        pipeline: (p) => p,
        materialize: { type: "collection", mode: Model.Mode.Replace },
      });

      const project = new Project({
        name: "test",
        models: [model1, model2, model3],
      });

      const mermaid = project.toMermaid();
      expect(mermaid).toContain("graph TD");
      expect(mermaid).toContain("model1");
      expect(mermaid).toContain("model2");
      expect(mermaid).toContain("model3");
      expect(mermaid).toContain("model1 --> model2");
      expect(mermaid).toContain("model1 --> model3");
    });
  });

  describe("validate()", () => {
    describe("valid projects", () => {
      it("should pass for a simple linear DAG", () => {
        const model1 = new Model({
          name: "model1",
          from: sourceCollection,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const model2 = new Model({
          name: "model2",
          from: model1,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const project = new Project({
          name: "test",
          models: [model1, model2],
        });

        const result = project.validate();
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should pass for a fan-out DAG", () => {
        const model1 = new Model({
          name: "model1",
          from: sourceCollection,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const model2 = new Model({
          name: "model2",
          from: model1,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const model3 = new Model({
          name: "model3",
          from: model1,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const project = new Project({
          name: "test",
          models: [model1, model2, model3],
        });

        const result = project.validate();
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("warnings", () => {
      it("should warn about multiple leaf models", () => {
        const model1 = new Model({
          name: "model1",
          from: sourceCollection,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const model2 = new Model({
          name: "model2",
          from: sourceCollection,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const model3 = new Model({
          name: "model3",
          from: sourceCollection,
          pipeline: (p) => p,
          materialize: { type: "collection", mode: Model.Mode.Replace },
        });

        const project = new Project({
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
});
