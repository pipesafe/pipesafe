/**
 * Same-database join assertions
 *
 * A pipeline from `CollectionInDatabase<Docs, Db>.aggregate()` may join a
 * db-less `Collection`, a collection in the same literal database, or one
 * whose database is an unchecked `string`. A different literal database is
 * a compile error.
 */

import { pipesafe } from "../singleton/pipesafe";
import { Collection } from "./Collection";
import { CollectionInDatabase } from "./CollectionInDatabase";
import { Pipeline } from "../pipeline/Pipeline";
import { Assert, Equal } from "../utils/tests";

type User = { _id: string; name: string; orgId: string };
type Org = { _id: string; title: string };

const app = pipesafe.db("app");
const other = pipesafe.db("other");
declare const dynamicName: string;
const dynamic = pipesafe.db(dynamicName);

const users = app.collection<User>("users");
const appOrgs = app.collection<Org>("orgs");
const otherOrgs = other.collection<Org>("orgs");
const dynamicOrgs = dynamic.collection<Org>("orgs");
const dblessOrgs = new Collection<Org>({ collection: { name: "orgs" } });

type _UsersDb = Assert<Equal<typeof users, CollectionInDatabase<User, "app">>>;
type _DynamicDb = Assert<
  Equal<typeof dynamicOrgs, CollectionInDatabase<Org, string>>
>;

const _sameDb = users.aggregate().lookup({
  from: appOrgs,
  localField: "orgId",
  foreignField: "_id",
  as: "org",
});
const _dbless = users.aggregate().unionWith({ coll: dblessOrgs });
const _dynamicSource = users.aggregate().unionWith({ coll: dynamicOrgs });
const _dynamicPipeline = dynamic
  .collection<User>("users")
  .aggregate()
  .unionWith({ coll: otherOrgs });

users.aggregate().lookup({
  // @ts-expect-error  'other' is not the pipeline's database 'app'
  from: otherOrgs,
  as: "org",
  pipeline: (p) => p,
});

users.aggregate().lookup({
  from: appOrgs,
  as: "orgs",
  pipeline: (p) =>
    // @ts-expect-error  sub-pipelines inherit the database check
    p.unionWith({ coll: otherOrgs }),
});

// @ts-expect-error  'other' is not the pipeline's database 'app'
users.aggregate().unionWith({ coll: otherOrgs });

users.aggregate().graphLookup({
  // @ts-expect-error  'other' is not the pipeline's database 'app'
  from: otherOrgs,
  startWith: "$orgId",
  connectFromField: "_id",
  connectToField: "_id",
  as: "chain",
});

// db-less pipelines only join db-less collections
// @ts-expect-error  CollectionInDatabase is not a db-less source
new Pipeline<User>().unionWith({ coll: appOrgs });

// A bound pipeline cannot be re-targeted to another database
// @ts-expect-error  `db` is fixed by the collection's database
void users.aggregate().execute({ db: { name: "other" } });

export type { _UsersDb, _DynamicDb };
export { _sameDb, _dbless, _dynamicSource, _dynamicPipeline };
