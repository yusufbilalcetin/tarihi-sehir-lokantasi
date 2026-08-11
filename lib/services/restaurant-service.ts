import { categories, orders, products, restaurantTables, staffUsers, waiterCalls } from "@/lib/mock-data";
import type { Category, Order, Product, RestaurantTable, StaffUser, WaiterCall } from "@/types";

export interface RestaurantService {
  getCategories(): Promise<Category[]>;
  getProducts(): Promise<Product[]>;
  getTables(): Promise<RestaurantTable[]>;
  getOrders(): Promise<Order[]>;
  getStaff(): Promise<StaffUser[]>;
  getWaiterCalls(): Promise<WaiterCall[]>;
}

export const mockRestaurantService: RestaurantService = {
  async getCategories() { return categories; },
  async getProducts() { return products; },
  async getTables() { return restaurantTables; },
  async getOrders() { return orders; },
  async getStaff() { return staffUsers; },
  async getWaiterCalls() { return waiterCalls; },
};

// Future backend adapters should implement RestaurantService without leaking
// Firebase, Firestore, or other provider-specific code into UI components.
