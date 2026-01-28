import { assertTypeEqual } from "../utils/tests";
import {
  FieldSelector,
  InferFieldSelector,
  FieldSelectorsThatInferTo,
} from "./fieldSelector";
import { ObjectId } from "mongodb";

// Test Schema Definitions
type SimpleSchema = {
  name: string;
  age: number;
  active: boolean;
  createdAt: Date;
  id: ObjectId;
};

type SimpleFields = FieldSelector<SimpleSchema>;
assertTypeEqual(
  {} as SimpleFields,
  {} as "name" | "age" | "active" | "createdAt" | "id"
);

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

type NestedFields = FieldSelector<NestedSchema>;
assertTypeEqual(
  {} as NestedFields,
  {} as
    | "user"
    | "metadata"
    | "user.age"
    | "user.profile"
    | "user.profile.firstName"
    | "user.profile.lastName"
    | "user.profile.settings"
    | "user.profile.settings.theme"
    | "user.profile.settings.notifications"
    | "metadata.version"
    | "metadata.tags"
    | `metadata.tags.${number}`
);

assertTypeEqual(
  {} as FieldSelectorsThatInferTo<NestedSchema, string>,
  {} as
    | "user.profile.firstName"
    | "user.profile.lastName"
    | "user.profile.settings.theme"
    | `metadata.tags.${number}`
);
assertTypeEqual(
  {} as FieldSelectorsThatInferTo<NestedSchema, "light">,
  {} as "user.profile.settings.theme"
);
assertTypeEqual(
  {} as FieldSelectorsThatInferTo<NestedSchema, "light" | "dark">,
  {} as "user.profile.settings.theme"
);
assertTypeEqual(
  {} as FieldSelectorsThatInferTo<NestedSchema, boolean>,
  {} as "user.profile.settings.notifications"
);
assertTypeEqual(
  {} as FieldSelectorsThatInferTo<NestedSchema, number>,
  {} as "user.age" | "metadata.version"
);
assertTypeEqual(
  {} as FieldSelectorsThatInferTo<
    NestedSchema,
    { version: number; tags: string[] }
  >,
  {} as "metadata"
);
assertTypeEqual(
  {} as FieldSelectorsThatInferTo<NestedSchema, string[]>,
  {} as `metadata.tags`
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

assertTypeEqual(
  {} as FieldSelectorsThatInferTo<
    ArraySchema,
    {
      email: string;
      roles: string[];
      addresses: {
        street: string;
        city: string;
        country: string;
      }[];
    }[]
  >,
  {} as `users`
);

type ArrayFields = FieldSelector<ArraySchema>;
assertTypeEqual(
  {} as ArrayFields,
  {} as
    | "items"
    | "users"
    | "simpleArray"
    | "numberArray"
    | `items.${number}`
    | "items.name"
    | "items.id"
    | "items.price"
    | `items.${number}.name`
    | `items.${number}.id`
    | `items.${number}.price`
    | `users.${number}`
    | "users.email"
    | "users.roles"
    | "users.addresses"
    | `users.roles.${number}`
    | `users.addresses.${number}`
    | "users.addresses.street"
    | "users.addresses.city"
    | "users.addresses.country"
    | `users.addresses.${number}.street`
    | `users.addresses.${number}.city`
    | `users.addresses.${number}.country`
    | `users.${number}.email`
    | `users.${number}.roles`
    | `users.${number}.addresses`
    | `users.${number}.roles.${number}`
    | `users.${number}.addresses.${number}`
    | `users.${number}.addresses.street`
    | `users.${number}.addresses.city`
    | `users.${number}.addresses.country`
    | `users.${number}.addresses.${number}.street`
    | `users.${number}.addresses.${number}.city`
    | `users.${number}.addresses.${number}.country`
    | `simpleArray.${number}`
    | `numberArray.${number}`
);

// Test field type inference
type NameType = InferFieldSelector<SimpleSchema, "name">;
assertTypeEqual({} as NameType, {} as string);

type AgeType = InferFieldSelector<SimpleSchema, "age">;
assertTypeEqual({} as AgeType, {} as number);

type ActiveType = InferFieldSelector<SimpleSchema, "active">;
assertTypeEqual({} as ActiveType, {} as boolean);

type DateType = InferFieldSelector<SimpleSchema, "createdAt">;
assertTypeEqual({} as DateType, {} as Date);

type IdType = InferFieldSelector<SimpleSchema, "id">;
assertTypeEqual({} as IdType, {} as ObjectId);

// Test nested field type inference
type FirstNameType = InferFieldSelector<NestedSchema, "user.profile.firstName">;
assertTypeEqual({} as FirstNameType, {} as string);

type ThemeType = InferFieldSelector<
  NestedSchema,
  "user.profile.settings.theme"
>;
assertTypeEqual({} as ThemeType, {} as "light" | "dark");

type NotificationsType = InferFieldSelector<
  NestedSchema,
  "user.profile.settings.notifications"
>;
assertTypeEqual({} as NotificationsType, {} as boolean);

type UserAgeType = InferFieldSelector<NestedSchema, "user.age">;
assertTypeEqual({} as UserAgeType, {} as number);

type VersionType = InferFieldSelector<NestedSchema, "metadata.version">;
assertTypeEqual({} as VersionType, {} as number);

type TagsType = InferFieldSelector<NestedSchema, "metadata.tags">;
assertTypeEqual({} as TagsType, {} as string[]);

// Array index type inference
type Items0Type = InferFieldSelector<ArraySchema, "items.0">;
assertTypeEqual(
  {} as Items0Type,
  {} as { id: number; name: string; price: number }
);

type Items0NameType = InferFieldSelector<ArraySchema, "items.0.name">;
assertTypeEqual({} as Items0NameType, {} as string);

type Users0EmailType = InferFieldSelector<ArraySchema, "users.0.email">;
assertTypeEqual({} as Users0EmailType, {} as string);

type SimpleArray0Type = InferFieldSelector<ArraySchema, "simpleArray.0">;
assertTypeEqual({} as SimpleArray0Type, {} as string);

// Array paths WITHOUT indices (MongoDB array field access)
// This is the key feature we just implemented!
type ItemsNameType = InferFieldSelector<ArraySchema, "items.name">;
assertTypeEqual({} as ItemsNameType, {} as string[]);

type ItemsPriceType = InferFieldSelector<ArraySchema, "items.price">;
assertTypeEqual({} as ItemsPriceType, {} as number[]);

type UsersEmailType = InferFieldSelector<ArraySchema, "users.email">;
assertTypeEqual({} as UsersEmailType, {} as string[]);

type UsersRolesType = InferFieldSelector<ArraySchema, "users.roles">;
assertTypeEqual({} as UsersRolesType, {} as string[][]);

type UsersAddressesCityType = InferFieldSelector<
  ArraySchema,
  "users.addresses.city"
>;
assertTypeEqual({} as UsersAddressesCityType, {} as string[][]);

// Complex nested arrays
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

// With index
type NestedArray0FieldType = InferFieldSelector<
  ComplexSchema,
  "nested.array.0.field"
>;
assertTypeEqual({} as NestedArray0FieldType, {} as string);

// Without index
type NestedArrayFieldType = InferFieldSelector<
  ComplexSchema,
  "nested.array.field"
>;
assertTypeEqual({} as NestedArrayFieldType, {} as string[]);

type NestedArrayNumType = InferFieldSelector<ComplexSchema, "nested.array.num">;
assertTypeEqual({} as NestedArrayNumType, {} as number[]);

// Deep nesting
type MultiLevelValueType = InferFieldSelector<
  ComplexSchema,
  "multiLevel.level1.level2.level3.value"
>;
assertTypeEqual({} as MultiLevelValueType, {} as number);

// Edge cases
type EdgeCaseSchema = {
  empty: {};
  nullField: null;
  undefinedField: undefined;
  optionalField?: string;
  unionField: string | number;
  tupleField: [string, number, boolean];
};

// Empty object
type EmptyType = InferFieldSelector<EdgeCaseSchema, "empty">;
assertTypeEqual({} as EmptyType, {} as {});

// Null field
type NullType = InferFieldSelector<EdgeCaseSchema, "nullField">;
assertTypeEqual(null as NullType, null as null);

// Undefined field
type UndefinedType = InferFieldSelector<EdgeCaseSchema, "undefinedField">;
assertTypeEqual(undefined as UndefinedType, undefined as undefined);

// Optional field
type OptionalType = InferFieldSelector<EdgeCaseSchema, "optionalField">;
assertTypeEqual({} as OptionalType, {} as string | undefined);

// Union field
type UnionType = InferFieldSelector<EdgeCaseSchema, "unionField">;
assertTypeEqual({} as UnionType, {} as string | number);

// Tuple field (tuples don't support indexed access in current implementation)
type TupleType = InferFieldSelector<EdgeCaseSchema, "tupleField">;
assertTypeEqual({} as TupleType, {} as [string, number, boolean]);

// MongoDB special case - mixing indexed and non-indexed array access
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
type OrdersIdType = InferFieldSelector<MixedArraySchema, "orders.id">;
assertTypeEqual({} as OrdersIdType, {} as string[]);

type Orders0IdType = InferFieldSelector<MixedArraySchema, "orders.0.id">;
assertTypeEqual({} as Orders0IdType, {} as string);

type OrdersItemsPriceType = InferFieldSelector<
  MixedArraySchema,
  "orders.items.price"
>;
assertTypeEqual({} as OrdersItemsPriceType, {} as number[][]);

type Orders0ItemsPriceType = InferFieldSelector<
  MixedArraySchema,
  "orders.0.items.price"
>;
assertTypeEqual({} as Orders0ItemsPriceType, {} as number[]);

type Orders0Items0PriceType = InferFieldSelector<
  MixedArraySchema,
  "orders.0.items.0.price"
>;
assertTypeEqual({} as Orders0Items0PriceType, {} as number);

type ArrayOfArraysSomethingType = InferFieldSelector<
  MixedArraySchema,
  "arrayOfArrays.something"
>;
assertTypeEqual({} as ArrayOfArraysSomethingType, {} as number[][]);

type ArrayOfArrays0SomethingType = InferFieldSelector<
  MixedArraySchema,
  "arrayOfArrays.0.something"
>;
assertTypeEqual({} as ArrayOfArrays0SomethingType, {} as number[]);

type ArrayOfArrays00SomethingType = InferFieldSelector<
  MixedArraySchema,
  "arrayOfArrays.0.0.something"
>;
assertTypeEqual({} as ArrayOfArrays00SomethingType, {} as number);

type ArrayOfArrayPrimitive00Type = InferFieldSelector<
  MixedArraySchema,
  "arrayOfArrayPrimitive.0.0"
>;
assertTypeEqual({} as ArrayOfArrayPrimitive00Type, {} as string);

type ArrayOfArrayPrimitive0Type = InferFieldSelector<
  MixedArraySchema,
  "arrayOfArrayPrimitive.0"
>;
assertTypeEqual({} as ArrayOfArrayPrimitive0Type, {} as string[]);

type ArrayOfArrayPrimitive0Type3 = InferFieldSelector<
  MixedArraySchema,
  `arrayOfArrayPrimitive.${number}`
>;
assertTypeEqual({} as ArrayOfArrayPrimitive0Type3, {} as string[]);

type ArrayOfArrayPrimitiveType = InferFieldSelector<
  MixedArraySchema,
  "arrayOfArrayPrimitive"
>;
assertTypeEqual({} as ArrayOfArrayPrimitiveType, {} as string[][]);

// The original test case that prompted this work
type OriginalTestCase = InferFieldSelector<
  { k: string; j: { l: number; x: null }; n: { m: number }[] },
  "n.m"
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
type _InvalidField1 = InferFieldSelector<ErrorSchema, "nonexistent">;

// @ts-expect-error - nonexistent nested field
type _InvalidField2 = InferFieldSelector<ErrorSchema, "nested.nonexistent">;

// @ts-expect-error - invalid deep path
type _InvalidField3 = InferFieldSelector<ErrorSchema, "field1.something">;

// @ts-expect-error - trying to access nested path on primitive
type _InvalidField4 = InferFieldSelector<ErrorSchema, "field1.nested.deep">;

// @ts-expect-error - invalid array field
type _InvalidField5 = InferFieldSelector<ErrorSchema, "array.nonexistent">;

// @ts-expect-error - completely invalid path
type _InvalidField6 = InferFieldSelector<ErrorSchema, "a.b.c.d.e.f">;
