/**
 * MongoDB.Local London 2026 — PipeSafe live demo
 *
 * Run in Cursor / VS Code with `@pipesafe/core` installed:
 *   bun add @pipesafe/core
 *
 * Each commented `// BUG ...` block below is the *intentional* error
 * we'll uncomment on stage. The TypeScript LSP catches every one before
 * the pipeline ever hits Mongo.
 */

import { Pipeline, Collection } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";

// ============================================================================
// Domain — same conference data we used in the slide deck
// ============================================================================

type Attendee = {
  _id: string;
  name: string;
  email: string;
  conferenceId: string;
  talks: string[];
  ticketTier: "standard" | "vip";
};

type Talk = {
  _id: string;
  title: string;
  speakerId: string;
  durationMin: number;
  schedule: {
    track: "main" | "workshop" | "lightning";
    room: string;
    startsAt: Date;
  };
};

type Speaker = {
  _id: string;
  name: string;
  bio: string;
  company: string;
};

// ============================================================================
// Collections — the only place a string name is allowed
// ============================================================================

const attendees = new Collection<Attendee>({ collectionName: "attendees" });
const talks = new Collection<Talk>({ collectionName: "talks" });
const speakers = new Collection<Speaker>({ collectionName: "speakers" });

// ============================================================================
// The pipeline from slide 3 — fixed, typed end-to-end
// ============================================================================

const vipReport = attendees
  .aggregate()
  // BUG 1 (uncomment): { tier: "vip" }
  //   ↳ Property 'tier' does not exist on type Attendee.
  //     Did you mean 'ticketTier'?
  .match({ ticketTier: "vip" })
  // BUG 2 (uncomment): replace `talks` with `talk`
  //   ↳ Argument of type 'Collection<...>' missing.
  //     The `from` arg is the collection, not a string — typo impossible.
  .lookup({
    from: talks,
    localField: "talks",
    foreignField: "speakerId",
    as: "talkDocs",
  })
  .project({
    _id: 1,
    name: 1,
    conferenceId: 1,
    talkCount: { $size: "$talkDocs" },
    // BUG 3 (uncomment): change `track` to `tracks`
    //   ↳ Property 'tracks' does not exist on '$talkDocs[number].schedule'.
    mainStageTalks: {
      $size: {
        $filter: {
          input: "$talkDocs",
          cond: { $eq: ["$$this.schedule.track", "main"] },
        },
      },
    },
  })
  // BUG 4 (uncomment): the $project above doesn't expose `conferenceId` →
  //   { conferenceId: 1 } so $group can use it. If we drop it, this
  //   $group _id reference becomes a compile error.
  .group({
    _id: "$conferenceId",
    totalTalks: { $sum: "$talkCount" },
    mainStageTotal: { $sum: "$mainStageTalks" },
  })
  .sort({ totalTalks: -1 });

// Hover this on stage — full structural type, no `any`.
type VipReport = InferOutputType<typeof vipReport>;
//   ^? { _id: string; totalTalks: number; mainStageTotal: number }[]

// ============================================================================
// Bonus: cross-collection join with `speakers` to show $lookup typing
// ============================================================================

const talksWithSpeakers = new Pipeline<Talk>()
  .match({ "schedule.track": "main" })
  .lookup({
    from: speakers,
    localField: "speakerId",
    foreignField: "_id",
    as: "speaker",
  })
  .project({
    title: 1,
    "schedule.room": 1,
    "schedule.startsAt": 1,
    speaker: { $arrayElemAt: ["$speaker", 0] },
  });

type TalksWithSpeakers = InferOutputType<typeof talksWithSpeakers>;
//   ^? hover and watch the speaker shape resolve to Speaker

// ============================================================================
// Run it (driver-agnostic — same call site as raw mongo)
// ============================================================================

// import { MongoClient } from "mongodb";
// const client = new MongoClient(process.env.MONGO_URL!);
// const db = client.db("conference");
//
// const result: VipReport = await db
//   .collection("attendees")
//   .aggregate(vipReport.toArray())
//   .toArray();
//
// result[0].mainStageTotal; // number — IDE knows.

export { vipReport, talksWithSpeakers };
export type { VipReport, TalksWithSpeakers };
