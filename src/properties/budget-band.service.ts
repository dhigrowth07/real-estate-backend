import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyStatus, PropertyType } from '@prisma/client';

export interface BudgetBand {
  id: string;
  label: string; // Max 24 chars for WhatsApp list row title
  min: number;
  max: number;
  description?: string; // Max 72 chars
}

export const FALLBACK_BUDGET_BANDS: BudgetBand[] = [
  {
    id: 'budget_band_under_50l',
    label: 'Under ₹50 Lakhs',
    min: 0,
    max: 5000000,
    description: 'Affordable & entry-level options',
  },
  {
    id: 'budget_band_50l_1cr',
    label: '₹50L - ₹1 Crore',
    min: 5000000,
    max: 10000000,
    description: 'Mid-range residential properties',
  },
  {
    id: 'budget_band_1cr_2cr',
    label: '₹1 Cr - ₹2 Crores',
    min: 10000000,
    max: 20000000,
    description: 'Premium homes & apartments',
  },
  {
    id: 'budget_band_2cr_5cr',
    label: '₹2 Cr - ₹5 Crores',
    min: 20000000,
    max: 50000000,
    description: 'Luxury villas & penthouses',
  },
  {
    id: 'budget_band_above_5cr',
    label: 'Above ₹5 Crores',
    min: 50000000,
    max: 999999999,
    description: 'Ultra-luxury & commercial estates',
  },
];

@Injectable()
export class BudgetBandService {
  private readonly logger = new Logger(BudgetBandService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates 4-5 sensible price bands dynamically based on the real distribution
   * of active properties in the database.
   *
   * @param propertyType - Optional filter to narrow distribution to specific property category
   * @returns Array of 4 to 5 BudgetBand objects
   */
  async generateBudgetBands(propertyType?: PropertyType): Promise<BudgetBand[]> {
    const whereClause: any = {
      status: PropertyStatus.AVAILABLE,
      deletedAt: null,
      price: { gt: 0 },
    };

    if (propertyType) {
      whereClause.propertyType = propertyType;
    }

    const properties = await this.prisma.property.findMany({
      where: whereClause,
      select: { price: true },
      orderBy: { price: 'asc' },
    });

    const prices = properties.map((p) => p.price).filter((pr) => typeof pr === 'number' && pr > 0);

    // If too few properties to compute meaningful statistical distribution, use generic fallback
    if (prices.length < 4) {
      this.logger.warn(
        `[BudgetBandService] Too few active properties found (${prices.length}). Using generic fallback budget bands.`,
      );
      return FALLBACK_BUDGET_BANDS;
    }

    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];

    // If min and max price are identical or too close (ratio < 1.2), use fallback
    if (maxPrice <= minPrice || maxPrice / minPrice < 1.25) {
      this.logger.warn(
        `[BudgetBandService] Property prices range too narrow (Min: ${minPrice}, Max: ${maxPrice}). Using fallback budget bands.`,
      );
      return FALLBACK_BUDGET_BANDS;
    }

    // Compute quantile breakpoints at 25th, 50th, 75th percentiles
    const q1 = this.getQuantile(prices, 0.25);
    const q2 = this.getQuantile(prices, 0.50);
    const q3 = this.getQuantile(prices, 0.75);

    // Round breakpoints to clean round figures (multiples of 5L, 10L, 25L, 50L)
    const roundedQ1 = this.roundToCleanMilestone(q1);
    const roundedQ2 = this.roundToCleanMilestone(q2);
    const roundedQ3 = this.roundToCleanMilestone(q3);

    // Deduplicate and ensure strict ascending order
    const rawBreakpoints = [roundedQ1, roundedQ2, roundedQ3];
    const uniqueBreakpoints = Array.from(new Set(rawBreakpoints)).sort((a, b) => a - b);

    if (uniqueBreakpoints.length < 2) {
      // If rounding collapsed breakpoints, divide [minPrice, maxPrice] evenly into 4 clean steps
      return this.generateEvenlySpacedBands(minPrice, maxPrice);
    }

    // Build 4 or 5 bands from breakpoints
    const bands: BudgetBand[] = [];

    // Band 1: Under Breakpoint 1
    bands.push({
      id: `budget_under_${uniqueBreakpoints[0]}`,
      label: `Under ${this.formatPriceShort(uniqueBreakpoints[0])}`,
      min: 0,
      max: uniqueBreakpoints[0],
      description: `Entry-level options up to ${this.formatPriceShort(uniqueBreakpoints[0])}`,
    });

    // Intermediate Bands
    for (let i = 0; i < uniqueBreakpoints.length - 1; i++) {
      const lower = uniqueBreakpoints[i];
      const upper = uniqueBreakpoints[i + 1];
      bands.push({
        id: `budget_${lower}_${upper}`,
        label: `${this.formatPriceShort(lower)} - ${this.formatPriceShort(upper)}`,
        min: lower,
        max: upper,
        description: `Properties priced between ${this.formatPriceShort(lower)} and ${this.formatPriceShort(upper)}`,
      });
    }

    // Top Band: Above last Breakpoint
    const lastBreakpoint = uniqueBreakpoints[uniqueBreakpoints.length - 1];
    bands.push({
      id: `budget_above_${lastBreakpoint}`,
      label: `Above ${this.formatPriceShort(lastBreakpoint)}`,
      min: lastBreakpoint,
      max: 999999999,
      description: `Premium & luxury properties above ${this.formatPriceShort(lastBreakpoint)}`,
    });

    this.logger.log(
      `[BudgetBandService] Generated ${bands.length} dynamic budget bands from ${prices.length} properties: ${bands.map((b) => b.label).join(', ')}`,
    );

    return bands;
  }

  /**
   * Helper: Generates evenly spaced rounded bands when quantiles collapse
   */
  private generateEvenlySpacedBands(min: number, max: number): BudgetBand[] {
    const step = (max - min) / 4;
    const b1 = this.roundToCleanMilestone(min + step);
    const b2 = this.roundToCleanMilestone(min + step * 2);
    const b3 = this.roundToCleanMilestone(min + step * 3);

    const breakpoints = Array.from(new Set([b1, b2, b3])).sort((a, b) => a - b);
    if (breakpoints.length < 2) {
      return FALLBACK_BUDGET_BANDS;
    }

    const bands: BudgetBand[] = [
      {
        id: `budget_under_${breakpoints[0]}`,
        label: `Under ${this.formatPriceShort(breakpoints[0])}`,
        min: 0,
        max: breakpoints[0],
      },
    ];

    for (let i = 0; i < breakpoints.length - 1; i++) {
      bands.push({
        id: `budget_${breakpoints[i]}_${breakpoints[i + 1]}`,
        label: `${this.formatPriceShort(breakpoints[i])} - ${this.formatPriceShort(breakpoints[i + 1])}`,
        min: breakpoints[i],
        max: breakpoints[i + 1],
      });
    }

    const last = breakpoints[breakpoints.length - 1];
    bands.push({
      id: `budget_above_${last}`,
      label: `Above ${this.formatPriceShort(last)}`,
      min: last,
      max: 999999999,
    });

    return bands;
  }

  /**
   * Helper: Computes p-th quantile value from sorted numbers
   */
  private getQuantile(sorted: number[], p: number): number {
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sorted[lower];
    }
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Helper: Rounds a number to a clean Indian real estate milestone:
   * - < 50 Lakhs: round to nearest 5L
   * - 50L to 1 Crore: round to nearest 10L
   * - 1 Cr to 5 Crores: round to nearest 25L
   * - > 5 Crores: round to nearest 50L or 1Cr
   */
  private roundToCleanMilestone(amount: number): number {
    if (amount <= 5000000) {
      // Nearest 5 Lakhs (500,000)
      return Math.max(2500000, Math.round(amount / 500000) * 500000);
    }
    if (amount <= 10000000) {
      // Nearest 10 Lakhs (1,000,000)
      return Math.round(amount / 1000000) * 1000000;
    }
    if (amount <= 50000000) {
      // Nearest 25 Lakhs (2,500,000)
      return Math.round(amount / 2500000) * 2500000;
    }
    // Nearest 50 Lakhs (5,000,000)
    return Math.round(amount / 5000000) * 5000000;
  }

  /**
   * Helper: Formats price to short Indian currency label (e.g. ₹50L, ₹1.5 Cr)
   */
  public formatPriceShort(val: number): string {
    if (val <= 0) return '₹0';
    if (val >= 10000000) {
      const cr = val / 10000000;
      return Number.isInteger(cr) ? `₹${cr} Cr` : `₹${cr.toFixed(2).replace(/\.?0+$/, '')} Cr`;
    }
    const lakhs = val / 100000;
    return Number.isInteger(lakhs) ? `₹${lakhs}L` : `₹${lakhs.toFixed(1).replace(/\.?0+$/, '')}L`;
  }
}
