#!/usr/bin/env bun
/**
 * E-commerce Analytics Pipeline Examples
 *
 * Real-world examples for analyzing e-commerce data:
 * - Sales reporting by category
 * - Customer purchase analysis
 * - Product performance metrics
 */

import { Pipeline, Collection } from "@pipesafe/core";
import type { InferOutputType } from "@pipesafe/core";

// ============================================================================
// Schema Definitions
// ============================================================================

type OrderSchema = {
  _id: string;
  orderId: string;
  customerId: string;
  orderDate: Date;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  items: Array<{
    productId: string;
    productName: string;
    category: string;
    quantity: number;
    price: number;
    discount?: number;
  }>;
  shippingAddress: {
    city: string;
    state: string;
    country: string;
  };
  totalAmount: number;
  paymentMethod: string;
};

// ============================================================================
// Example 1: Sales Report by Category (Last 30 Days)
// ============================================================================

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const salesByCategoryPipeline = new Pipeline<OrderSchema>()
  // Filter completed orders from last 30 days
  .match({
    orderDate: { $gte: thirtyDaysAgo },
  })
  .match({
    status: "delivered",
  })
  // Note: In real app, would use $or or multiple match stages for multiple statuses
  // Group by category (simplified - in real app would unwind items first)
  .group({
    _id: null,
    totalOrders: { $count: {} },
    totalRevenue: { $sum: "$totalAmount" },
  })
  // Project clean output
  .project({
    _id: 0,
    totalOrders: 1,
    totalRevenue: 1,
  });

type SalesByCategoryResult = InferOutputType<typeof salesByCategoryPipeline>;

// ============================================================================
// Example 2: Customer Purchase Analysis with Lookup
// ============================================================================

const customerPurchaseAnalysisPipeline = new Pipeline<OrderSchema>()
  // Filter delivered orders
  .match({
    status: "delivered",
  })
  // Group by customer and calculate totals
  // Note: In real app, would use lookup to join customer data
  .group({
    _id: "$customerId",
    totalSpent: { $sum: "$totalAmount" },
    orderCount: { $count: {} },
    averageOrderValue: { $avg: "$totalAmount" },
  })
  // Project clean output
  .project({
    _id: 0,
    customerId: "$_id",
    totalSpent: 1,
    orderCount: 1,
    averageOrderValue: 1,
  });

type CustomerPurchaseResult = InferOutputType<
  typeof customerPurchaseAnalysisPipeline
>;

// ============================================================================
// Example 3: Product Performance Metrics
// ============================================================================

const productPerformancePipeline = new Pipeline<OrderSchema>()
  // Filter completed orders
  .match({
    status: "delivered",
  })
  // Note: In real app, would use $or for multiple statuses
  // Group by order (simplified - in real app would unwind items first)
  .group({
    _id: null,
    totalOrders: { $count: {} },
    totalRevenue: { $sum: "$totalAmount" },
  })
  // Project final output
  .project({
    _id: 0,
    totalOrders: 1,
    totalRevenue: 1,
  });

type ProductPerformanceResult = InferOutputType<
  typeof productPerformancePipeline
>;

// ============================================================================
// Example 4: Geographic Sales Analysis
// ============================================================================

const geographicSalesPipeline = new Pipeline<OrderSchema>()
  // Filter delivered orders
  .match({
    status: "delivered",
  })
  // Group by location
  .group({
    _id: {
      country: "$shippingAddress.country",
      state: "$shippingAddress.state",
      city: "$shippingAddress.city",
    },
    totalRevenue: { $sum: "$totalAmount" },
    orderCount: { $count: {} },
    averageOrderValue: { $avg: "$totalAmount" },
  })
  // Project clean output
  .project({
    _id: 0,
    country: "$_id.country",
    state: "$_id.state",
    city: "$_id.city",
    totalRevenue: 1,
    orderCount: 1,
    averageOrderValue: 1,
  });

type GeographicSalesResult = InferOutputType<typeof geographicSalesPipeline>;

// ============================================================================
// Example 5: Order with Product Category Hierarchy ($lookup + nested $graphLookup)
// ============================================================================

type CategorySchema = {
  _id: string;
  name: string;
  parentId: string | null;
};

type ProductSchema = {
  _id: string;
  name: string;
  categoryId: string;
  price: number;
};

const products = new Collection<ProductSchema>({
  collectionName: "products",
});
const categories = new Collection<CategorySchema>({
  collectionName: "categories",
});

// For each order, lookup all products and within each product
// use $graphLookup to find the full category ancestry chain.
// e.g. "iPhone 15" → category "Phones" → ["Phones", "Electronics", "All Products"]
const orderWithCategoryHierarchyPipeline = new Pipeline<OrderSchema>()
  .match({ status: "delivered" })
  .lookup({
    from: products,
    as: "productDetails",
    pipeline: (p) =>
      p.graphLookup({
        from: categories,
        startWith: "$categoryId",
        connectFromField: "parentId",
        connectToField: "_id",
        as: "categoryPath",
        depthField: "depth",
      }),
  })
  .project({
    _id: 0,
    orderId: 1,
    customerId: 1,
    totalAmount: 1,
    productDetails: 1,
  });

type OrderWithCategoryHierarchy = InferOutputType<
  typeof orderWithCategoryHierarchyPipeline
>;

// ============================================================================
// Example 6: Multi-Facet Product Analysis ($facet)
// ============================================================================

type ProductAnalyticsSchema = {
  _id: string;
  name: string;
  category: string;
  price: number;
  soldCount: number;
};

const productAnalysisPipeline = new Pipeline<ProductAnalyticsSchema>()
  // Run three independent analyses in parallel
  .facet({
    // Price distribution buckets
    priceBuckets: (p) =>
      p.group({
        _id: null,
        avgPrice: { $avg: "$price" },
        minPrice: { $min: "$price" },
        maxPrice: { $max: "$price" },
      }),
    // Top 5 best sellers
    topSellers: (p) => p.sort({ soldCount: -1 }).limit(5),
    // Category summary
    categorySummary: (p) =>
      p
        .group({
          _id: "$category",
          totalProducts: { $count: {} },
          totalRevenue: { $sum: "$price" },
        })
        .sort({ totalRevenue: -1 }),
  });

type ProductAnalysisResult = InferOutputType<typeof productAnalysisPipeline>;

// ============================================================================
// Export types for use in application
// ============================================================================

export type {
  SalesByCategoryResult,
  CustomerPurchaseResult,
  ProductPerformanceResult,
  GeographicSalesResult,
  OrderWithCategoryHierarchy,
  ProductAnalysisResult,
};

export {
  salesByCategoryPipeline,
  customerPurchaseAnalysisPipeline,
  productPerformancePipeline,
  geographicSalesPipeline,
  orderWithCategoryHierarchyPipeline,
  productAnalysisPipeline,
};
