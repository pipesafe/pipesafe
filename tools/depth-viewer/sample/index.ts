// Minimal type-system fixture for the depth-viewer.
// A handful of named generics — recursive walks, distributive conditionals,
// mapped types — so the trace produces interesting events without the size
// of a real project. Used to verify the viewer's per-symbol panels.

// ---------------------------------------------------------------------------
// Schema shapes
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
  profile: {
    age: number;
    bio: string;
    address: {
      street: string;
      city: string;
      zip: string;
    };
  };
}

export interface Post {
  id: number;
  title: string;
  body: string;
  meta: {
    publishedAt: string;
    tags: ReadonlyArray<string>;
  };
}

export interface Order {
  id: string;
  customer: User;
  items: ReadonlyArray<{
    sku: string;
    quantity: number;
    price: number;
  }>;
  shipping: {
    address: User["profile"]["address"];
    method: "standard" | "express" | "overnight";
  };
}

// ---------------------------------------------------------------------------
// Recursive path walker (head-recursive, depth-prone)
// ---------------------------------------------------------------------------

/**
 * All dotted paths through an object type, ignoring array element shapes.
 * Each call constructs `${Prefix}${K}` template-literals plus the recursive
 * result for nested objects.
 */
export type Paths<T, Prefix extends string = ""> =
  T extends object ?
    T extends ReadonlyArray<unknown> ?
      `${Prefix}${number & keyof T}`
    : {
        [K in keyof T & string]: T[K] extends object ?
          Paths<T[K], `${Prefix}${K}.`> | `${Prefix}${K}`
        : `${Prefix}${K}`;
      }[keyof T & string]
  : never;

/**
 * Resolve a dotted path against a schema. Distributes over Path so unions of
 * paths produce a union of value types.
 */
export type Resolve<T, Path extends string> =
  Path extends `${infer Head}.${infer Tail}` ?
    Head extends keyof T ?
      Resolve<T[Head], Tail>
    : never
  : Path extends keyof T ? T[Path]
  : never;

/**
 * Build a deep partial of T. Recurses through nested objects.
 */
export type DeepPartial<T> =
  T extends object ?
    T extends ReadonlyArray<infer U> ?
      ReadonlyArray<DeepPartial<U>>
    : { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/**
 * Deep readonly mirror of DeepPartial — every nested object becomes readonly.
 */
export type DeepReadonly<T> =
  T extends object ?
    T extends ReadonlyArray<infer U> ?
      ReadonlyArray<DeepReadonly<U>>
    : { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

// ---------------------------------------------------------------------------
// Mapped + conditional pair
// ---------------------------------------------------------------------------

/** Keep only properties whose value type extends V. */
export type PickByValue<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};

/** Drop properties whose value extends V — the inverse of PickByValue. */
export type OmitByValue<T, V> = {
  [K in keyof T as T[K] extends V ? never : K]: T[K];
};

/** Strip readonly modifiers (inline mapped type form preferred in PipeSafe). */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Make selected keys optional. */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Distributive conditional — naked T branches per union member. */
export type IsString<T> = T extends string ? true : false;

/** Non-distributive equivalent — wraps in a single-element tuple. */
export type IsStringStrict<T> = [T] extends [string] ? true : false;

/** Union → intersection (recursive distribution). */
export type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I
  : never;

// ---------------------------------------------------------------------------
// Compound — combines several of the above
// ---------------------------------------------------------------------------

/**
 * For a schema T, the union of all leaf-value types reachable via any path.
 */
export type LeafValues<T> =
  T extends object ?
    T extends ReadonlyArray<infer U> ?
      LeafValues<U>
    : { [K in keyof T]: LeafValues<T[K]> }[keyof T]
  : T;

/**
 * Build a flat record { dotted-path: value-type } from a schema.
 */
export type Flatten<T, Prefix extends string = ""> =
  T extends object ?
    T extends ReadonlyArray<unknown> ?
      { [K in `${Prefix}${number}`]?: T[number] }
    : UnionToIntersection<
        {
          [K in keyof T & string]: T[K] extends object ?
            Flatten<T[K], `${Prefix}${K}.`>
          : { [P in `${Prefix}${K}`]: T[K] };
        }[keyof T & string]
      >
  : never;

// ---------------------------------------------------------------------------
// Sample values that force the checker to instantiate the above
// ---------------------------------------------------------------------------

export const userPath: Paths<User> = "profile.address.city";
export const postPath: Paths<Post> = "meta.publishedAt";
export const orderPath: Paths<Order> = "shipping.method";

export const userName: Resolve<User, "name"> = "alice";
export const profileAge: Resolve<User, "profile.age"> = 30;
export const addressCity: Resolve<User, "profile.address.city"> = "Berlin";
export const shippingMethod: Resolve<Order, "shipping.method"> = "express";

export const stringFields: PickByValue<User, string> = {
  name: "alice",
  email: "alice@example.com",
};

export const nonStringFields: OmitByValue<User, string> = {
  id: 1,
  active: true,
  profile: {
    age: 30,
    bio: "hi",
    address: { street: "1 main", city: "Berlin", zip: "10115" },
  },
};

export const userPatch: DeepPartial<User> = {
  profile: { age: 31, address: { city: "Hamburg" } },
};

export const userFrozen: DeepReadonly<User> = {
  id: 1,
  name: "alice",
  email: "alice@example.com",
  active: true,
  profile: {
    age: 30,
    bio: "hi",
    address: { street: "1 main", city: "Berlin", zip: "10115" },
  },
};

export const mutableUser: Mutable<Readonly<User>> = {
  id: 1,
  name: "alice",
  email: "alice@example.com",
  active: true,
  profile: {
    age: 30,
    bio: "hi",
    address: { street: "1 main", city: "Berlin", zip: "10115" },
  },
};

export const orderPatch: PartialBy<Order, "shipping"> = {
  id: "o-1",
  customer: mutableUser,
  items: [{ sku: "abc", quantity: 1, price: 9.99 }],
};

export const isStringNumber: IsString<string | number> = true;
export const isStringNumberStrict: IsStringStrict<string | number> = false;

export const orderLeaf: LeafValues<Order> = "express";

export const userFlat: Flatten<User> = {
  id: 1,
  name: "alice",
  email: "alice@example.com",
  active: true,
  "profile.age": 30,
  "profile.bio": "hi",
  "profile.address.street": "1 main",
  "profile.address.city": "Berlin",
  "profile.address.zip": "10115",
};

// ---------------------------------------------------------------------------
// Deliberately heavy combinations
//
// Crossing a wide schema (union of 5+ shapes) with a recursive walker forces
// the checker to do measurable work — visible in the viewer's per-symbol
// panels even on a tiny project. Without this, every consts checks in
// microseconds and the trace barely registers it.
// ---------------------------------------------------------------------------

export interface BigSchema {
  user: User;
  post: Post;
  order: Order;
  audit: {
    actor: User;
    action: "create" | "update" | "delete";
    target: { kind: "user" | "post" | "order"; id: string };
  };
  preferences: {
    theme: "light" | "dark" | "auto";
    notifications: {
      email: boolean;
      push: boolean;
      digest: {
        frequency: "daily" | "weekly";
        sections: ReadonlyArray<string>;
      };
    };
  };
}

/** All paths across the big schema — distributes over every nested object. */
export type AllPaths = Paths<BigSchema>;

/** Pull values from BigSchema by path; distributes over the path union. */
export type ValueAtPath<P extends AllPaths> = Resolve<BigSchema, P>;

export const heavyAudit: ValueAtPath<"audit.actor.profile.address.city"> =
  "Berlin";
export const heavyDigest: ValueAtPath<"preferences.notifications.digest.frequency"> =
  "daily";

// Note: only fully-typed if you supply every leaf key. Use Partial<...> as the
// authored shape to keep the demo concise — the heavy Flatten<BigSchema>
// instantiation still runs (that's the part the viewer should surface).
export const heavyFlat: Partial<Flatten<BigSchema>> = {
  "user.id": 1,
  "user.name": "alice",
  "user.profile.address.city": "Berlin",
  "order.id": "o-1",
  "order.shipping.method": "standard",
  "audit.action": "create",
  "preferences.theme": "dark",
  "preferences.notifications.digest.frequency": "weekly",
};
