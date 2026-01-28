#!/usr/bin/env bun
/**
 * User Management Pipeline Examples
 *
 * Real-world examples for user data management:
 * - Active user filtering and projection
 * - User profile enrichment
 * - User activity analysis
 */

import { Pipeline } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";

// ============================================================================
// Schema Definitions
// ============================================================================

type UserSchema = {
  _id: string;
  userId: string;
  email: string;
  username: string;
  profile: {
    firstName: string;
    lastName: string;
    avatar?: string;
    bio?: string;
    location?: {
      city: string;
      country: string;
    };
  };
  settings: {
    emailNotifications: boolean;
    theme: "light" | "dark";
    language: string;
  };
  metadata: {
    createdAt: Date;
    lastLoginAt?: Date;
    isActive: boolean;
    isVerified: boolean;
  };
  tags: string[];
  internalNotes?: string; // Admin-only field
};

type ActivitySchema = {
  _id: string;
  userId: string;
  activityType: "login" | "post" | "comment" | "like" | "share";
  timestamp: Date;
  details?: Record<string, unknown>;
};

// ============================================================================
// Example 1: Public User Profile (API Response)
// ============================================================================

const publicUserProfilePipeline = new Pipeline<UserSchema>()
  // Filter active and verified users
  .match({
    "metadata.isActive": true,
    "metadata.isVerified": true,
  })
  // Project only public fields
  .project({
    _id: 0,
    userId: 1,
    username: 1,
    "profile.firstName": 1,
    "profile.lastName": 1,
    "profile.avatar": 1,
    "profile.bio": 1,
    "profile.location": 1,
    tags: 1,
  })
  // Rename fields for API response
  .project({
    id: "$userId",
    username: 1,
    firstName: "$profile.firstName",
    lastName: "$profile.lastName",
    avatar: "$profile.avatar",
    bio: "$profile.bio",
    location: "$profile.location",
    tags: 1,
  });

type PublicUserProfile = InferOutputType<typeof publicUserProfilePipeline>;

// ============================================================================
// Example 2: User List with Activity Summary
// ============================================================================

const userListWithActivityPipeline = new Pipeline<UserSchema>()
  // Filter active users
  .match({
    "metadata.isActive": true,
  })
  // Group to aggregate user data
  // Note: In real app, would use lookup to join activity data
  .group({
    _id: "$userId",
    username: { $first: "$username" },
    email: { $first: "$email" },
    profile: { $first: "$profile" },
    lastLoginAt: { $first: "$metadata.lastLoginAt" },
  })
  // Project clean output
  .project({
    _id: 0,
    userId: "$_id",
    username: 1,
    email: 1,
    profile: 1,
    lastLoginAt: 1,
    activityCount: 1,
  })
  // Flatten profile fields using dotted keys
  .project({
    userId: 1,
    username: 1,
    email: 1,
    "profile.firstName": 1,
    "profile.avatar": 1,
    lastLoginAt: 1,
  })
  // Rename fields
  .project({
    userId: 1,
    username: 1,
    email: 1,
    fullName: "$profile.firstName",
    avatar: "$profile.avatar",
    lastLoginAt: 1,
  });

type UserListWithActivity = InferOutputType<
  typeof userListWithActivityPipeline
>;

// ============================================================================
// Example 3: Admin User Management View
// ============================================================================

const adminUserManagementPipeline = new Pipeline<UserSchema>()
  // Match all users (no filter for admin view)
  .match({})
  // Project admin-visible fields
  .project({
    _id: 0,
    userId: 1,
    email: 1,
    username: 1,
    profile: 1,
    "metadata.createdAt": 1,
    "metadata.lastLoginAt": 1,
    "metadata.isActive": 1,
    "metadata.isVerified": 1,
    "settings.emailNotifications": 1,
    internalNotes: 1,
  })
  // Flatten structure for admin UI
  .project({
    userId: 1,
    email: 1,
    username: 1,
    firstName: "$profile.firstName",
    lastName: "$profile.lastName",
    createdAt: "$metadata.createdAt",
    lastLoginAt: "$metadata.lastLoginAt",
    isActive: "$metadata.isActive",
    isVerified: "$metadata.isVerified",
    emailNotifications: "$settings.emailNotifications",
    internalNotes: 1,
  });

type AdminUserView = InferOutputType<typeof adminUserManagementPipeline>;

// ============================================================================
// Example 4: User Activity Analysis
// ============================================================================

const userActivityAnalysisPipeline = new Pipeline<ActivitySchema>()
  // Filter activities from last 7 days
  .match({
    timestamp: {
      $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
  })
  // Group by user and activity type
  .group({
    _id: {
      userId: "$userId",
      activityType: "$activityType",
    },
    count: { $count: {} },
  })
  // Project clean output
  .project({
    _id: 0,
    userId: "$_id.userId",
    activityType: "$_id.activityType",
    count: 1,
  });

type UserActivityAnalysis = InferOutputType<
  typeof userActivityAnalysisPipeline
>;

// ============================================================================
// Example 5: Clean User Data (Remove Sensitive Fields)
// ============================================================================

const cleanUserDataPipeline = new Pipeline<UserSchema>()
  // Remove sensitive/internal fields
  .unset(["internalNotes", "settings"])
  // Project only necessary fields
  .project({
    _id: 0,
    userId: 1,
    username: 1,
    email: 1,
    profile: 1,
    "metadata.createdAt": 1,
    "metadata.isActive": 1,
    tags: 1,
  });

type CleanUserData = InferOutputType<typeof cleanUserDataPipeline>;

// ============================================================================
// Export types for use in application
// ============================================================================

export type {
  PublicUserProfile,
  UserListWithActivity,
  AdminUserView,
  UserActivityAnalysis,
  CleanUserData,
};

export {
  publicUserProfilePipeline,
  userListWithActivityPipeline,
  adminUserManagementPipeline,
  userActivityAnalysisPipeline,
  cleanUserDataPipeline,
};
