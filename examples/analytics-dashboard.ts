#!/usr/bin/env bun
/**
 * Analytics Dashboard Pipeline Examples
 *
 * Real-world examples for analytics dashboards:
 * - Time-series data aggregation
 * - Multi-dimensional analysis
 * - Performance metrics calculation
 */

import { TMPipeline, InferOutputType } from "../src/pipeline/TMPipeline";

// ============================================================================
// Schema Definitions
// ============================================================================

type EventSchema = {
  _id: string;
  eventId: string;
  eventType: "page_view" | "click" | "purchase" | "signup" | "download";
  userId?: string;
  sessionId: string;
  timestamp: Date;
  properties: {
    page?: string;
    productId?: string;
    category?: string;
    value?: number;
    referrer?: string;
    device?: "desktop" | "mobile" | "tablet";
    browser?: string;
    country?: string;
  };
};

type SessionSchema = {
  _id: string;
  sessionId: string;
  userId?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number; // in seconds
  pageViews: number;
  events: number;
  country?: string;
  device?: "desktop" | "mobile" | "tablet";
};

// ============================================================================
// Example 1: Daily Event Summary
// ============================================================================

const dailyEventSummaryPipeline = new TMPipeline<EventSchema>()
  // Filter events from last 30 days
  .match({
    timestamp: {
      $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  })
  // Group by date and event type
  .group({
    _id: {
      date: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: "$timestamp",
        },
      },
      eventType: "$eventType",
    },
    count: { $count: {} },
    uniqueUsers: { $addToSet: "$userId" },
  })
  // Calculate unique user count
  .set({
    uniqueUserCount: { $size: "$uniqueUsers" },
  })
  // Project clean output
  .project({
    _id: 0,
    date: "$_id.date",
    eventType: "$_id.eventType",
    count: 1,
    uniqueUserCount: 1,
  });

type DailyEventSummary = InferOutputType<typeof dailyEventSummaryPipeline>;

// ============================================================================
// Example 2: Conversion Funnel Analysis
// ============================================================================

const conversionFunnelPipeline = new TMPipeline<EventSchema>()
  // Filter conversion-related events
  .match({
    eventType: "page_view",
  })
  // Group by event type
  .group({
    _id: "$eventType",
    count: { $count: {} },
    uniqueUsers: { $addToSet: "$userId" },
  })
  // Project clean output
  .project({
    _id: 0,
    eventType: "$_id",
    count: 1,
    uniqueUsers: { $size: "$uniqueUsers" },
  });

type ConversionFunnel = InferOutputType<typeof conversionFunnelPipeline>;

// ============================================================================
// Example 3: Geographic Analysis
// ============================================================================

const geographicAnalysisPipeline = new TMPipeline<EventSchema>()
  // Filter events with country data
  .match({
    "properties.country": { $exists: true },
  })
  // Group by country
  .group({
    _id: null,
    totalEvents: { $count: {} },
    uniqueUsers: { $addToSet: "$userId" },
    uniqueSessions: { $addToSet: "$sessionId" },
  })
  // Project clean output
  .project({
    _id: 0,
    totalEvents: 1,
    uniqueUsers: { $size: "$uniqueUsers" },
    uniqueSessions: { $size: "$uniqueSessions" },
  });

type GeographicAnalysis = InferOutputType<typeof geographicAnalysisPipeline>;

// ============================================================================
// Example 4: Device Performance Analysis
// ============================================================================

const devicePerformancePipeline = new TMPipeline<SessionSchema>()
  // Filter sessions with device data
  .match({
    device: { $exists: true },
  })
  // Group by device type
  .group({
    _id: null, // Group all sessions
    totalSessions: { $count: {} },
    totalPageViews: { $sum: "$pageViews" },
    totalEvents: { $sum: "$events" },
  })
  // Note: Device grouping and duration averaging would use custom stage
  // or additional group stages for complex aggregations
  // Project clean output
  .project({
    _id: 0,
    device: "$_id",
    totalSessions: 1,
    totalPageViews: 1,
    totalEvents: 1,
    averageDuration: 1,
    averagePageViews: 1,
  });

type DevicePerformance = InferOutputType<typeof devicePerformancePipeline>;

// ============================================================================
// Example 5: Product Performance Analysis
// ============================================================================

const productPerformancePipeline = new TMPipeline<EventSchema>()
  // Filter product-related events
  .match({
    "properties.productId": { $exists: true },
    eventType: "click",
  })
  // Group events
  .group({
    _id: null,
    totalEvents: { $count: {} },
  })
  // Project clean output
  .project({
    _id: 0,
    totalEvents: 1,
  });

type ProductPerformance = InferOutputType<typeof productPerformancePipeline>;

// ============================================================================
// Export types for use in application
// ============================================================================

export type {
  DailyEventSummary,
  ConversionFunnel,
  GeographicAnalysis,
  DevicePerformance,
  ProductPerformance,
};

export {
  dailyEventSummaryPipeline,
  conversionFunnelPipeline,
  geographicAnalysisPipeline,
  devicePerformancePipeline,
  productPerformancePipeline,
};
