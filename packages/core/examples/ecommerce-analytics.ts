#!/usr/bin/env bun
/**
 * E-commerce Analytics Pipeline Examples
 *
 * Real-world examples for analyzing e-commerce data:
 * - Sales reporting by category
 * - Customer purchase analysis
 * - Product performance metrics
 */

import { Pipeline } from "@pipesafe/core";
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
// Export types for use in application
// ============================================================================

export type {
  SalesByCategoryResult,
  CustomerPurchaseResult,
  ProductPerformanceResult,
  GeographicSalesResult,
};

export {
  salesByCategoryPipeline,
  customerPurchaseAnalysisPipeline,
  productPerformancePipeline,
  geographicSalesPipeline,
};
