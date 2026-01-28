#!/usr/bin/env bun
/**
 * Content Management Pipeline Examples
 *
 * Real-world examples for content management:
 * - Blog post filtering and formatting
 * - Content analytics
 * - Content search and categorization
 */

import { Pipeline } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";

// ============================================================================
// Schema Definitions
// ============================================================================

type BlogPostSchema = {
  _id: string;
  postId: string;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  author: {
    userId: string;
    name: string;
    avatar?: string;
  };
  category: string;
  tags: string[];
  status: "draft" | "published" | "archived";
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    views: number;
    likes: number;
    comments: number;
    readingTime?: number;
  };
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
    keywords?: string[];
  };
};

// ============================================================================
// Example 1: Published Blog Posts List (Public API)
// ============================================================================

const publishedPostsListPipeline = new Pipeline<BlogPostSchema>()
  // Filter only published posts
  .match({
    status: "published",
    publishedAt: { $exists: true },
  })
  // Project only public fields
  .project({
    _id: 0,
    postId: 1,
    title: 1,
    slug: 1,
    excerpt: 1,
    author: 1,
    category: 1,
    tags: 1,
    publishedAt: 1,
    "metadata.views": 1,
    "metadata.likes": 1,
    "metadata.comments": 1,
    "metadata.readingTime": 1,
  })
  // Rename and flatten for API response
  .project({
    id: "$postId",
    title: 1,
    slug: 1,
    excerpt: 1,
    authorName: "$author.name",
    authorAvatar: "$author.avatar",
    category: 1,
    tags: 1,
    publishedAt: 1,
    views: "$metadata.views",
    likes: "$metadata.likes",
    comments: "$metadata.comments",
    readingTime: "$metadata.readingTime",
  });

type PublishedPostsList = InferOutputType<typeof publishedPostsListPipeline>;

// ============================================================================
// Example 2: Blog Post with Comments (Full Post View)
// ============================================================================

const postWithCommentsPipeline = new Pipeline<BlogPostSchema>()
  // Match specific post
  .match({
    status: "published",
    postId: "example-post-id", // Would be parameterized in real app
  })
  // Project post data
  // Note: In real app, would use lookup to join comments
  .project({
    _id: 0,
    postId: 1,
    title: 1,
    content: 1,
    author: 1,
    category: 1,
    tags: 1,
    publishedAt: 1,
    metadata: 1,
  });

type PostWithComments = InferOutputType<typeof postWithCommentsPipeline>;

// ============================================================================
// Example 3: Content Analytics by Category
// ============================================================================

const contentAnalyticsPipeline = new Pipeline<BlogPostSchema>()
  // Filter published posts
  .match({
    status: "published",
  })
  // Group by category
  .group({
    _id: "$category",
    totalPosts: { $count: {} },
    totalViews: { $sum: "$metadata.views" },
    totalLikes: { $sum: "$metadata.likes" },
    totalComments: { $sum: "$metadata.comments" },
    averageViews: { $avg: "$metadata.views" },
    averageLikes: { $avg: "$metadata.likes" },
  })
  // Calculate engagement rate
  .set({
    engagementRate: {
      $divide: [{ $add: ["$totalLikes", "$totalComments"] }, "$totalViews"],
    },
  })
  // Project clean output
  .project({
    _id: 0,
    category: "$_id",
    totalPosts: 1,
    totalViews: 1,
    totalLikes: 1,
    totalComments: 1,
    averageViews: 1,
    averageLikes: 1,
    engagementRate: 1,
  });

type ContentAnalytics = InferOutputType<typeof contentAnalyticsPipeline>;

// ============================================================================
// Example 4: Author Performance Analysis
// ============================================================================

const authorPerformancePipeline = new Pipeline<BlogPostSchema>()
  // Filter published posts
  .match({
    status: "published",
  })
  // Group by author
  .group({
    _id: "$author.userId",
    authorName: { $first: "$author.name" },
    authorAvatar: { $first: "$author.avatar" },
    totalPosts: { $count: {} },
    totalViews: { $sum: "$metadata.views" },
    totalLikes: { $sum: "$metadata.likes" },
    totalComments: { $sum: "$metadata.comments" },
    averageViews: { $avg: "$metadata.views" },
    latestPostDate: { $max: "$publishedAt" },
  })
  // Project clean output
  .project({
    _id: 0,
    authorId: "$_id",
    authorName: 1,
    authorAvatar: 1,
    totalPosts: 1,
    totalViews: 1,
    totalLikes: 1,
    totalComments: 1,
    averageViews: 1,
    latestPostDate: 1,
  });

type AuthorPerformance = InferOutputType<typeof authorPerformancePipeline>;

// ============================================================================
// Example 5: Content Search Results
// ============================================================================

const contentSearchPipeline = new Pipeline<BlogPostSchema>()
  // Search published posts (would use $text search in real app)
  .match({
    status: "published",
    // In real app: { $text: { $search: "search term" } }
  })
  // Project search result fields
  .project({
    _id: 0,
    postId: 1,
    title: 1,
    slug: 1,
    excerpt: 1,
    author: {
      name: "$author.name",
      avatar: "$author.avatar",
    },
    category: 1,
    tags: 1,
    publishedAt: 1,
    "metadata.views": 1,
    "metadata.readingTime": 1,
  })
  // Rename for search results
  .project({
    id: "$postId",
    title: 1,
    slug: 1,
    excerpt: 1,
    authorName: "$author.name",
    authorAvatar: "$author.avatar",
    category: 1,
    tags: 1,
    publishedAt: 1,
    views: "$metadata.views",
    readingTime: "$metadata.readingTime",
  });

type ContentSearchResults = InferOutputType<typeof contentSearchPipeline>;

// ============================================================================
// Export types for use in application
// ============================================================================

export type {
  PublishedPostsList,
  PostWithComments,
  ContentAnalytics,
  AuthorPerformance,
  ContentSearchResults,
};

export {
  publishedPostsListPipeline,
  postWithCommentsPipeline,
  contentAnalyticsPipeline,
  authorPerformancePipeline,
  contentSearchPipeline,
};
