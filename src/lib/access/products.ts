// src/lib/access/products.ts

export type PassType = "24h" | "72h" | "1w" | "48h_pausable";

export interface Product {
  id: PassType;
  name: string;
  price: string; // USD string for PayPal (e.g. "5.00")
  priceDisplay: string; // For UI (e.g. "$5")
  durationSeconds: number;
  durationLabel: string;
  isPausable: boolean;
  description: string;
  features: string[];
}

export const PRODUCTS: Record<PassType, Product> = {
  "24h": {
    id: "24h",
    name: "Sprint",
    price: "5.00",
    priceDisplay: "$5",
    durationSeconds: 24 * 60 * 60, // 86400
    durationLabel: "24 hours",
    isPausable: false,
    description: "The Fixer — 24 Hour Sprint Pass",
    features: ["Quick access for short tasks", "Starts immediately"],
  },
  "48h_pausable": {
    id: "48h_pausable",
    name: "Pausable",
    price: "11.99",
    priceDisplay: "$11.99",
    durationSeconds: 48 * 60 * 60, // 172800
    durationLabel: "48 hours",
    isPausable: true,
    description: "The Fixer — 48 Hour Pausable Pass",
    features: [
      "Pause & resume on your schedule",
      "Use time when YOU need it",
      "Best value per hour",
    ],
  },
  "72h": {
    id: "72h",
    name: "Extended",
    price: "13.99",
    priceDisplay: "$13.99",
    durationSeconds: 72 * 60 * 60, // 259200
    durationLabel: "72 hours",
    isPausable: false,
    description: "The Fixer — 72 Hour Extended Pass",
    features: ["3 days of uninterrupted access", "Great for larger projects"],
  },
  "1w": {
    id: "1w",
    name: "Weekly",
    price: "24.99",
    priceDisplay: "$24.99",
    durationSeconds: 7 * 24 * 60 * 60, // 604800
    durationLabel: "7 days",
    isPausable: false,
    description: "The Fixer — Weekly Pass",
    features: ["Full week of unlimited AI", "Best for ongoing work"],
  },
};

/** The order products appear on the pricing page */
export const PRODUCT_DISPLAY_ORDER: PassType[] = [
  "24h",
  "48h_pausable",
  "72h",
  "1w",
];

export function getProduct(passType: string): Product | undefined {
  return PRODUCTS[passType as PassType];
}

export function isValidPassType(passType: string): passType is PassType {
  return passType in PRODUCTS;
}
