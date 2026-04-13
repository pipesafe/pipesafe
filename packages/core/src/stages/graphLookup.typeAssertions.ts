import { Assert, Equal } from "../utils/tests";
import { ResolveGraphLookupOutput } from "./graphLookup";

/**
 * Type Resolution Behaviors for $graphLookup Stage:
 *
 * FEATURES:
 * 1. ARRAY FIELD ADDITION:
 *    Like $lookup, $graphLookup adds a new array field containing the traversed documents.
 *
 * 2. DEPTH FIELD AUGMENTATION:
 *    When depthField is provided, each element in the result array gains
 *    a `{ [depthField]: number }` property tracking recursion depth.
 *
 * 3. UNION TYPE PRESERVATION:
 *    When starting docs are a union type, the graph lookup result is applied
 *    to each union member independently.
 *
 * 4. FIELD REPLACEMENT:
 *    If the "as" key already exists in the schema, it is replaced.
 */

// ============================================================================
// Test 1: Basic graph lookup (employee hierarchy, no depthField)
// ============================================================================

type Employee = {
  _id: string;
  name: string;
  managerId: string | null;
};

type BasicResult = ResolveGraphLookupOutput<
  Employee,
  "reportingHierarchy",
  Employee
>;

type BasicExpected = {
  _id: string;
  name: string;
  managerId: string | null;
  reportingHierarchy: Employee[];
};

type BasicTest = Assert<Equal<BasicResult, BasicExpected>>;

// ============================================================================
// Test 2: With depthField — adds depth: number to each result element
// ============================================================================

type WithDepthResult = ResolveGraphLookupOutput<
  Employee,
  "reportingHierarchy",
  Employee,
  "depth"
>;

type WithDepthExpected = {
  _id: string;
  name: string;
  managerId: string | null;
  reportingHierarchy: {
    _id: string;
    name: string;
    managerId: string | null;
    depth: number;
  }[];
};

type WithDepthTest = Assert<Equal<WithDepthResult, WithDepthExpected>>;

// ============================================================================
// Test 3: Union type input distribution
// ============================================================================

type Person =
  | { type: "employee"; employeeId: string; managerId: string }
  | { type: "contractor"; contractId: string; agency: string };

type UnionResult = ResolveGraphLookupOutput<Person, "hierarchy", Employee>;

type UnionExpected =
  | {
      type: "employee";
      employeeId: string;
      managerId: string;
      hierarchy: Employee[];
    }
  | {
      type: "contractor";
      contractId: string;
      agency: string;
      hierarchy: Employee[];
    };

type UnionTest = Assert<Equal<UnionResult, UnionExpected>>;

// ============================================================================
// Test 4: Union type input + depthField
// ============================================================================

type UnionWithDepthResult = ResolveGraphLookupOutput<
  Person,
  "hierarchy",
  Employee,
  "level"
>;

type UnionWithDepthExpected =
  | {
      type: "employee";
      employeeId: string;
      managerId: string;
      hierarchy: {
        _id: string;
        name: string;
        managerId: string | null;
        level: number;
      }[];
    }
  | {
      type: "contractor";
      contractId: string;
      agency: string;
      hierarchy: {
        _id: string;
        name: string;
        managerId: string | null;
        level: number;
      }[];
    };

type UnionWithDepthTest = Assert<
  Equal<UnionWithDepthResult, UnionWithDepthExpected>
>;

// ============================================================================
// Test 5: Field replacement (as matches existing field name)
// ============================================================================

type EmployeeWithExistingField = {
  _id: string;
  name: string;
  managerId: string | null;
  reports: string; // Will be replaced by graph lookup result
};

type ReplacementResult = ResolveGraphLookupOutput<
  EmployeeWithExistingField,
  "reports",
  Employee
>;

type ReplacementExpected = {
  _id: string;
  name: string;
  managerId: string | null;
  reports: Employee[];
};

type ReplacementTest = Assert<Equal<ReplacementResult, ReplacementExpected>>;

// ============================================================================
// Test 6: Different foreign doc type (airport route finding)
// ============================================================================

type Airport = {
  _id: string;
  code: string;
  connects: string[];
};

type FlightDoc = {
  _id: string;
  origin: string;
  destination: string;
};

type AirportResult = ResolveGraphLookupOutput<FlightDoc, "routes", Airport>;

type AirportExpected = {
  _id: string;
  origin: string;
  destination: string;
  routes: Airport[];
};

type AirportTest = Assert<Equal<AirportResult, AirportExpected>>;

// ============================================================================
// Test 7: Self-referential lookup (category tree with parentId)
// ============================================================================

type Category = {
  _id: string;
  name: string;
  parentId: string | null;
};

type CategoryResult = ResolveGraphLookupOutput<
  Category,
  "ancestors",
  Category,
  "depth"
>;

type CategoryExpected = {
  _id: string;
  name: string;
  parentId: string | null;
  ancestors: {
    _id: string;
    name: string;
    parentId: string | null;
    depth: number;
  }[];
};

type CategoryTest = Assert<Equal<CategoryResult, CategoryExpected>>;

// ============================================================================
// Test 8: Expression-based startWith via Pipeline.graphLookup
// ============================================================================

// Verifies that the StartWith generic constraint accepts expressions
// that evaluate to the connectToField type (string in this case).
import { Pipeline } from "../pipeline/Pipeline";
import { Collection } from "../collection/Collection";

const employees = new Collection<Employee>({
  collectionName: "employees",
});

type DocWithParts = {
  _id: string;
  firstName: string;
  lastName: string;
  managerId: string | null;
};

// Expression-based startWith: { $concat: ["$firstName", " ", "$lastName"] } => string
// This matches connectToField "_id" which is string
const _expressionStartWith = (
  p: Pipeline<DocWithParts, DocWithParts, "runtime", never>
) =>
  p.graphLookup({
    from: employees,
    startWith: { $concat: ["$firstName", " ", "$lastName"] },
    connectFromField: "managerId",
    connectToField: "_id",
    as: "hierarchy",
  });

const _invalidExpressionStartWith = (
  p: Pipeline<DocWithParts, DocWithParts, "runtime", never>
) =>
  p.graphLookup({
    from: employees,
    // @ts-expect-error - Expression evaluating to number should not match string connectToField
    startWith: { $add: [1, 2] },
    connectFromField: "managerId",
    connectToField: "_id",
    as: "hierarchy",
  });

// ============================================================================
// Test 9: restrictSearchWithMatch narrows union foreign doc type
// ============================================================================

type MixedNode =
  | { type: "employee"; _id: string; name: string; managerId: string | null }
  | { type: "contractor"; _id: string; contractId: string; agency: string };

type NarrowedResult = ResolveGraphLookupOutput<
  { _id: string; startNode: string },
  "chain",
  MixedNode,
  never,
  { type: "employee" }
>;

type NarrowedExpected = {
  _id: string;
  startNode: string;
  chain: {
    type: "employee";
    _id: string;
    name: string;
    managerId: string | null;
  }[];
};

type NarrowedTest = Assert<Equal<NarrowedResult, NarrowedExpected>>;

// ============================================================================
// Test 10: restrictSearchWithMatch with depthField + narrowing
// ============================================================================

type NarrowedWithDepthResult = ResolveGraphLookupOutput<
  { _id: string; startNode: string },
  "chain",
  MixedNode,
  "depth",
  { type: "employee" }
>;

type NarrowedWithDepthExpected = {
  _id: string;
  startNode: string;
  chain: {
    type: "employee";
    _id: string;
    name: string;
    managerId: string | null;
    depth: number;
  }[];
};

type NarrowedWithDepthTest = Assert<
  Equal<NarrowedWithDepthResult, NarrowedWithDepthExpected>
>;

// ============================================================================
// Test 11: no restrictSearchWithMatch preserves full union
// ============================================================================

type UnnarrowedResult = ResolveGraphLookupOutput<
  { _id: string; startNode: string },
  "chain",
  MixedNode
>;

type UnnarrowedExpected = {
  _id: string;
  startNode: string;
  chain: MixedNode[];
};

type UnnarrowedTest = Assert<Equal<UnnarrowedResult, UnnarrowedExpected>>;

// Satisfy linting by exporting all test types
export type {
  BasicTest,
  WithDepthTest,
  UnionTest,
  UnionWithDepthTest,
  ReplacementTest,
  AirportTest,
  CategoryTest,
  NarrowedTest,
  NarrowedWithDepthTest,
  UnnarrowedTest,
  NarrowedPipelineTest,
};

// ============================================================================
// Test 12: Pipeline.graphLookup with restrictSearchWithMatch narrows output
// ============================================================================

type MixedEmployee =
  | { _id: string; name: string; managerId: string | null; type: "full-time" }
  | { _id: string; name: string; managerId: string | null; type: "intern" };

const mixedEmployees = new Collection<MixedEmployee>({
  collectionName: "mixed_employees",
});

const _narrowedPipeline = new Pipeline<{
  _id: string;
  managerId: string | null;
}>().graphLookup({
  from: mixedEmployees,
  startWith: "$managerId",
  connectFromField: "managerId",
  connectToField: "_id",
  as: "chain",
  restrictSearchWithMatch: { type: "full-time" },
});

type NarrowedPipelineOutput = import("../pipeline/Pipeline").InferOutputType<
  typeof _narrowedPipeline
>;

type NarrowedPipelineExpected = {
  _id: string;
  managerId: string | null;
  chain: {
    _id: string;
    name: string;
    managerId: string | null;
    type: "full-time";
  }[];
};

type NarrowedPipelineTest = Assert<
  Equal<NarrowedPipelineOutput, NarrowedPipelineExpected>
>;

// Satisfy linting for runtime values
void _expressionStartWith;
void _invalidExpressionStartWith;
void _narrowedPipeline;
