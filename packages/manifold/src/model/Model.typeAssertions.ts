/**
 * Model database assertions
 *
 * Models read from the run's database, so a model's source and join targets
 * must have no database: a db-less Collection or a model without
 * `materialize.db`. A model with `materialize.db` writes there and cannot
 * be read by other models.
 */

import { Collection, pipesafe, type Assert, type Equal } from "@pipesafe/core";
import { Model, type ModelOutputDb } from "./Model";

type Event = { _id: string; userId: string };
type User = { _id: string; name: string };

const events = new Collection<Event>({ collection: { name: "events" } });
const users = new Collection<User>({ collection: { name: "users" } });

const staged = new Model({
  name: "stg_events",
  from: events,
  pipeline: (p) => p,
  materialize: { type: "collection", mode: Model.Mode.Replace },
});

const exported = new Model({
  name: "exp_events",
  from: events,
  pipeline: (p) => p,
  materialize: { type: "collection", db: "exports", mode: Model.Mode.Replace },
});

type _StagedDb = Assert<
  Equal<ModelOutputDb<typeof staged.materialize>, undefined>
>;
type _ExportedDb = Assert<
  Equal<ModelOutputDb<typeof exported.materialize>, "exports">
>;

const _fromModel = new Model({
  name: "from_model",
  from: staged,
  pipeline: (p) =>
    p.lookup({
      from: users,
      localField: "userId",
      foreignField: "_id",
      as: "u",
    }),
  materialize: { type: "view" },
});

new Model({
  name: "from_exported",
  // @ts-expect-error  a model's source cannot have a database
  from: exported,
  pipeline: (p) => p,
  materialize: { type: "view" },
});

new Model({
  name: "from_bound_collection",
  // @ts-expect-error  a model's source cannot have a database
  from: pipesafe.db("app").collection<Event>("events"),
  pipeline: (p) => p,
  materialize: { type: "view" },
});

new Model({
  name: "joins_exported",
  from: events,
  pipeline: (p) =>
    // @ts-expect-error  join targets must be in the run's database
    p.unionWith({ coll: exported }),
  materialize: { type: "view" },
});

new Model({
  name: "view_with_db",
  from: events,
  pipeline: (p) => p,
  // @ts-expect-error  views live in the run's database
  materialize: { type: "view", db: "exports" },
});

export type { _StagedDb, _ExportedDb };
export { _fromModel };
