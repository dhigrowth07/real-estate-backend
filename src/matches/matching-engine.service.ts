import { Injectable } from '@nestjs/common';
import { Lead, Property } from '@prisma/client';

export interface MatchingWeights {
  budgetFullMatch: number; // default: 35
  budgetPartialMatch: number; // default: 20
  locationMatch: number; // default: 25
  propertyTypeMatch: number; // default: 20
  bhkMatch: number; // default: 10
  possessionMatch: number; // default: 10
}

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  budgetFullMatch: 35,
  budgetPartialMatch: 20,
  locationMatch: 25,
  propertyTypeMatch: 20,
  bhkMatch: 10,
  possessionMatch: 10,
};

export interface MatchEvaluation {
  score: number;
  breakdown: {
    budgetScore: number;
    locationScore: number;
    propertyTypeScore: number;
    bhkScore: number;
    possessionScore: number;
  };
}

@Injectable()
export class MatchingEngineService {
  private defaultWeights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS;

  /**
   * Calculates compatibility score between a Lead and a Property (0 - 100)
   */
  public calculateScore(
    lead: Partial<Lead>,
    property: Partial<Property>,
    customWeights?: Partial<MatchingWeights>,
  ): MatchEvaluation {
    const weights: MatchingWeights = {
      ...this.defaultWeights,
      ...(customWeights || {}),
    };

    let budgetScore = 0;
    let locationScore = 0;
    let propertyTypeScore = 0;
    let bhkScore = 0;
    let possessionScore = 0;

    // 1. Budget scoring (+35 full match, +20 within 10% tolerance)
    if (
      lead.budgetMin !== undefined &&
      lead.budgetMax !== undefined &&
      property.price !== undefined
    ) {
      if (property.price >= lead.budgetMin && property.price <= lead.budgetMax) {
        budgetScore = weights.budgetFullMatch;
      } else {
        const tolerance = lead.budgetMax * 0.1;
        if (
          property.price >= lead.budgetMin - tolerance &&
          property.price <= lead.budgetMax + tolerance
        ) {
          budgetScore = weights.budgetPartialMatch;
        }
      }
    }

    // 2. Location scoring (+25)
    if (lead.preferredLocations && lead.preferredLocations.length > 0 && property.location) {
      const propertyLoc = property.location.toLowerCase();
      const matched = lead.preferredLocations.some((loc) => {
        const normalizedLoc = loc.toLowerCase().trim();
        return propertyLoc.includes(normalizedLoc) || normalizedLoc.includes(propertyLoc);
      });
      if (matched) {
        locationScore = weights.locationMatch;
      }
    } else if (!lead.preferredLocations || lead.preferredLocations.length === 0) {
      // If lead specified no location preference, award partial
      locationScore = weights.locationMatch * 0.5;
    }

    // 3. Property Type scoring (+20)
    if (lead.propertyType && property.propertyType && lead.propertyType === property.propertyType) {
      propertyTypeScore = weights.propertyTypeMatch;
    }

    // 4. BHK / Configuration scoring (+10)
    if (lead.bhk && property.bhk) {
      if (lead.bhk.toLowerCase().trim() === property.bhk.toLowerCase().trim()) {
        bhkScore = weights.bhkMatch;
      }
    } else if (!lead.bhk) {
      bhkScore = weights.bhkMatch;
    }

    // 5. Possession timeline scoring (+10)
    if (lead.urgency && property.possessionStatus) {
      if (lead.urgency === 'IMMEDIATE' && property.possessionStatus === 'READY_TO_MOVE') {
        possessionScore = weights.possessionMatch;
      } else if (
        lead.urgency === 'WITHIN_1_MONTH' &&
        ['READY_TO_MOVE', 'WITHIN_3_MONTHS'].includes(property.possessionStatus)
      ) {
        possessionScore = weights.possessionMatch;
      } else if (
        lead.urgency === 'WITHIN_3_MONTHS' &&
        ['READY_TO_MOVE', 'WITHIN_3_MONTHS', 'WITHIN_6_MONTHS'].includes(property.possessionStatus)
      ) {
        possessionScore = weights.possessionMatch;
      } else if (lead.urgency === 'EXPLORING') {
        possessionScore = weights.possessionMatch;
      }
    }

    const rawScore = budgetScore + locationScore + propertyTypeScore + bhkScore + possessionScore;
    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    return {
      score: finalScore,
      breakdown: {
        budgetScore,
        locationScore,
        propertyTypeScore,
        bhkScore,
        possessionScore,
      },
    };
  }
}
