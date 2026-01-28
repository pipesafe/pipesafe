import { assertTypeEqual } from "../utils/tests";
import {
  FieldReference,
  InferFieldReference,
  FieldReferencesThatInferTo,
} from "./fieldReference";
import { ObjectId } from "mongodb";

// Test Schema Definitions
type SimpleSchema = {
  name: string;
  age: number;
  active: boolean;
  createdAt: Date;
  id: ObjectId;
};

type _SimpleFields = FieldReference<SimpleSchema>;
assertTypeEqual({} as _SimpleFields, {} as FieldReference<SimpleSchema>);

type NestedSchema = {
  user: {
    profile: {
      firstName: string;
      lastName: string;
      settings: {
        theme: "light" | "dark";
        notifications: boolean;
      };
    };
    age: number;
  };
  metadata: {
    version: number;
    tags: string[];
  };
};

type NestedFields = FieldReference<NestedSchema>;
assertTypeEqual(
  {} as NestedFields,
  {} as
    | "$user"
    | "$metadata"
    | "$user.age"
    | "$user.profile"
    | "$user.profile.firstName"
    | "$user.profile.lastName"
    | "$user.profile.settings"
    | "$user.profile.settings.theme"
    | "$user.profile.settings.notifications"
    | "$metadata.version"
    | "$metadata.tags"
);

assertTypeEqual(
  {} as FieldReferencesThatInferTo<NestedSchema, number>,
  {} as "$user.age" | "$metadata.version"
);

assertTypeEqual(
  {} as FieldReferencesThatInferTo<NestedSchema, string>,
  {} as
    | "$user.profile.firstName"
    | "$user.profile.lastName"
    | "$user.profile.settings.theme"
);

assertTypeEqual(
  {} as FieldReferencesThatInferTo<NestedSchema, boolean>,
  {} as "$user.profile.settings.notifications"
);

assertTypeEqual(
  {} as FieldReferencesThatInferTo<
    NestedSchema,
    { version: number; tags: string[] }
  >,
  {} as "$metadata"
);

assertTypeEqual(
  {} as FieldReferencesThatInferTo<
    NestedSchema,
    {
      profile: {
        firstName: string;
        lastName: string;
        settings: {
          theme: "light" | "dark";
          notifications: boolean;
        };
      };
      age: number;
    }
  >,
  {} as "$user"
);

assertTypeEqual(
  {} as FieldReferencesThatInferTo<NestedSchema, "light" | "dark">,
  {} as "$user.profile.settings.theme"
);

type ArraySchema = {
  items: {
    id: number;
    name: string;
    price: number;
  }[];
  users: {
    email: string;
    roles: string[];
    addresses: {
      street: string;
      city: string;
      country: string;
    }[];
  }[];
  simpleArray: string[];
  numberArray: number[];
};

type ArrayFields = FieldReference<ArraySchema>;
assertTypeEqual(
  {} as ArrayFields,
  {} as
    | "$items"
    | "$items.name"
    | "$items.id"
    | "$items.price"
    | "$users"
    | "$users.email"
    | "$users.roles"
    | "$users.addresses"
    | "$users.addresses.street"
    | "$users.addresses.city"
    | "$users.addresses.country"
    | "$simpleArray"
    | "$numberArray"
);

// Test field type inference
type NameType = InferFieldReference<SimpleSchema, "$name">;
assertTypeEqual({} as NameType, {} as string);

type AgeType = InferFieldReference<SimpleSchema, "$age">;
assertTypeEqual({} as AgeType, {} as number);

type ActiveType = InferFieldReference<SimpleSchema, "$active">;
assertTypeEqual({} as ActiveType, {} as boolean);

type DateType = InferFieldReference<SimpleSchema, "$createdAt">;
assertTypeEqual({} as DateType, {} as Date);

type IdType = InferFieldReference<SimpleSchema, "$id">;
assertTypeEqual({} as IdType, {} as ObjectId);

// Test nested field type inference
type FirstNameType = InferFieldReference<
  NestedSchema,
  "$user.profile.firstName"
>;
assertTypeEqual({} as FirstNameType, {} as string);

type ThemeType = InferFieldReference<
  NestedSchema,
  "$user.profile.settings.theme"
>;
assertTypeEqual({} as ThemeType, {} as "light" | "dark");

type NotificationsType = InferFieldReference<
  NestedSchema,
  "$user.profile.settings.notifications"
>;
assertTypeEqual({} as NotificationsType, {} as boolean);

type UserAgeType = InferFieldReference<NestedSchema, "$user.age">;
assertTypeEqual({} as UserAgeType, {} as number);

type VersionType = InferFieldReference<NestedSchema, "$metadata.version">;
assertTypeEqual({} as VersionType, {} as number);

type TagsType = InferFieldReference<NestedSchema, "$metadata.tags">;
assertTypeEqual({} as TagsType, {} as string[]);

// This is the key feature we just implemented!
type ItemsNameType = InferFieldReference<ArraySchema, "$items.name">;
assertTypeEqual({} as ItemsNameType, {} as string[]);

type ItemsPriceType = InferFieldReference<ArraySchema, "$items.price">;
assertTypeEqual({} as ItemsPriceType, {} as number[]);

type UsersEmailType = InferFieldReference<ArraySchema, "$users.email">;
assertTypeEqual({} as UsersEmailType, {} as string[]);

type UsersRolesType = InferFieldReference<ArraySchema, "$users.roles">;
assertTypeEqual({} as UsersRolesType, {} as string[][]);

type UsersAddressesCityType = InferFieldReference<
  ArraySchema,
  "$users.addresses.city"
>;
assertTypeEqual({} as UsersAddressesCityType, {} as string[][]);

// Test 5: Complex nested arrays
type ComplexSchema = {
  id: ObjectId;
  nested: {
    array: {
      field: string;
      num: number;
    }[];
    simple: string;
  };
  multiLevel: {
    level1: {
      level2: {
        level3: {
          value: number;
        };
      };
    };
  };
};

// Without index
type NestedArrayFieldType = InferFieldReference<
  ComplexSchema,
  "$nested.array.field"
>;
assertTypeEqual({} as NestedArrayFieldType, {} as string[]);

type NestedArrayNumType = InferFieldReference<
  ComplexSchema,
  "$nested.array.num"
>;
assertTypeEqual({} as NestedArrayNumType, {} as number[]);

// Deep nesting
type MultiLevelValueType = InferFieldReference<
  ComplexSchema,
  "$multiLevel.level1.level2.level3.value"
>;
assertTypeEqual({} as MultiLevelValueType, {} as number);

// Test 6: Edge cases
type EdgeCaseSchema = {
  empty: {};
  nullField: null;
  undefinedField: undefined;
  optionalField?: string;
  unionField: string | number;
  tupleField: [string, number, boolean];
};

// Empty object
type EmptyType = InferFieldReference<EdgeCaseSchema, "$empty">;
assertTypeEqual({} as EmptyType, {} as {});

// Null field
type NullType = InferFieldReference<EdgeCaseSchema, "$nullField">;
assertTypeEqual(null as NullType, null as null);

// Undefined field
type UndefinedType = InferFieldReference<EdgeCaseSchema, "$undefinedField">;
assertTypeEqual(undefined as UndefinedType, undefined as undefined);

// Optional field
type OptionalType = InferFieldReference<EdgeCaseSchema, "$optionalField">;
assertTypeEqual({} as OptionalType, {} as string | undefined);

// Union field
type UnionType = InferFieldReference<EdgeCaseSchema, "$unionField">;
assertTypeEqual({} as UnionType, {} as string | number);

// Tuple field (tuples don't support indexed access in current implementation)
type TupleType = InferFieldReference<EdgeCaseSchema, "$tupleField">;
assertTypeEqual({} as TupleType, {} as [string, number, boolean]);

// Test 7: MongoDB special case - mixing indexed and non-indexed array access
type MixedArraySchema = {
  orders: {
    id: string;
    items: {
      productId: string;
      quantity: number;
      price: number;
    }[];
    customer: {
      name: string;
      email: string;
    };
  }[];
  arrayOfArrays: {
    something: number;
  }[][];
  arrayOfArrayPrimitive: string[][];
};

// Type inference for mixed access
type OrdersIdType = InferFieldReference<MixedArraySchema, "$orders.id">;
assertTypeEqual({} as OrdersIdType, {} as string[]);

type OrdersItemsPriceType = InferFieldReference<
  MixedArraySchema,
  "$orders.items.price"
>;
assertTypeEqual({} as OrdersItemsPriceType, {} as number[][]);

type ArrayOfArraysSomethingType = InferFieldReference<
  MixedArraySchema,
  "$arrayOfArrays.something"
>;
assertTypeEqual({} as ArrayOfArraysSomethingType, {} as number[][]);

type ArrayOfArrayPrimitiveType = InferFieldReference<
  MixedArraySchema,
  "$arrayOfArrayPrimitive"
>;
assertTypeEqual({} as ArrayOfArrayPrimitiveType, {} as string[][]);

// Test 8: The original test case that prompted this work
type OriginalTestCase = InferFieldReference<
  { k: string; j: { l: number; x: null }; n: { m: number }[] },
  "$n.m"
>;
assertTypeEqual({} as OriginalTestCase, {} as number[]);

// Error cases - these should fail compilation
type ErrorSchema = {
  field1: string;
  nested: {
    field2: number;
  };
  array: { item: string }[];
};

// @ts-expect-error - nonexistent top-level field
type _InvalidField1 = InferFieldReference<ErrorSchema, "$nonexistent">;

// @ts-expect-error - nonexistent nested field
type _InvalidField2 = InferFieldReference<ErrorSchema, "$nested.nonexistent">;

// @ts-expect-error - invalid deep path
type _InvalidField3 = InferFieldReference<ErrorSchema, "$field1.something">;

// @ts-expect-error - trying to access nested path on primitive
type _InvalidField4 = InferFieldReference<ErrorSchema, "$field1.nested.deep">;

// @ts-expect-error - invalid array field
type _InvalidField5 = InferFieldReference<ErrorSchema, "$array.nonexistent">;

// @ts-expect-error - completely invalid path
type _InvalidField6 = InferFieldReference<ErrorSchema, "$a.b.c.d.e.f">;

// =============================================================================
// Test 9: Nullable and optional field references in FieldReferencesThatInferTo
// This tests the NonNullable fix - field references to nullable/optional fields
// should match their non-null base type for type filtering purposes
// =============================================================================

type NullableSchema = {
  id: string;
  customer: string | null; // Nullable string
  email?: string; // Optional string
  amount: number;
  refundAmount: number | null; // Nullable number
  discount?: number; // Optional number
  status: "active" | "inactive";
  category: "a" | "b" | null; // Nullable union
};

// Nullable string field should be included when looking for string field refs
type NullableStringRefs = FieldReferencesThatInferTo<NullableSchema, string>;
assertTypeEqual(
  {} as NullableStringRefs,
  {} as "$id" | "$customer" | "$email" | "$status" | "$category"
);

// Nullable number field should be included when looking for number field refs
type NullableNumberRefs = FieldReferencesThatInferTo<NullableSchema, number>;
assertTypeEqual(
  {} as NullableNumberRefs,
  {} as "$amount" | "$refundAmount" | "$discount"
);

// Test with nested nullable fields
type NestedNullableSchema = {
  user: {
    name: string;
    nickname: string | null;
    age?: number;
  };
  order: {
    total: number;
    discount: number | null;
  } | null;
};

type NestedNullableStringRefs = FieldReferencesThatInferTo<
  NestedNullableSchema,
  string
>;
assertTypeEqual(
  {} as NestedNullableStringRefs,
  {} as "$user.name" | "$user.nickname"
);

// When parent is nullable, nested fields are still accessible
// NonNullable strips the null from the parent, making nested fields available
type NestedNullableNumberRefs = FieldReferencesThatInferTo<
  NestedNullableSchema,
  number
>;
assertTypeEqual(
  {} as NestedNullableNumberRefs,
  {} as "$user.age" | "$order.total" | "$order.discount"
);

// Inference should still preserve the nullable type
type NullableCustomerType = InferFieldReference<NullableSchema, "$customer">;
assertTypeEqual({} as NullableCustomerType, {} as string | null);

type OptionalEmailType = InferFieldReference<NullableSchema, "$email">;
assertTypeEqual({} as OptionalEmailType, {} as string | undefined);

type NullableRefundType = InferFieldReference<NullableSchema, "$refundAmount">;
assertTypeEqual({} as NullableRefundType, {} as number | null);
