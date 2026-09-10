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
  maxPossibleScore?: number;
  earnedScore?: number;
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
   * Calculates compatibility score between a Lead and a Property (0 - 100).
   *
   * Null-Tolerant Scoring:
   * Any criterion whose required Lead field (or Property field) is null/unspecified is
   * EXCLUDED from both earned score and total possible score.
   * The final score is normalized against the sum of applicable weights with real data.
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

    let maxPossibleScore = 0;
    let earnedScore = 0;

    let budgetScore = 0;
    let locationScore = 0;
    let propertyTypeScore = 0;
    let bhkScore = 0;
    let possessionScore = 0;

    // 1. Budget scoring (+35 full match, +20 within 10% tolerance)
    const hasLeadBudget = lead.budgetMin != null || lead.budgetMax != null;
    const hasPropertyPrice = property.price != null;

    if (hasLeadBudget && hasPropertyPrice) {
      maxPossibleScore += weights.budgetFullMatch;

      const min = lead.budgetMin != null ? lead.budgetMin : 0;
      const max = lead.budgetMax != null ? lead.budgetMax : Number.MAX_SAFE_INTEGER;

      if (property.price! >= min && property.price! <= max) {
        budgetScore = weights.budgetFullMatch;
      } else {
        // Tolerance calculation
        const toleranceBase = lead.budgetMax != null ? lead.budgetMax : (lead.budgetMin || 0);
        const tolerance = toleranceBase * 0.1;
        const lowerBound = min > 0 ? min - tolerance : 0;
        const upperBound = max < Number.MAX_SAFE_INTEGER ? max + tolerance : Number.MAX_SAFE_INTEGER;

        if (property.price! >= lowerBound && property.price! <= upperBound) {
          budgetScore = weights.budgetPartialMatch;
        }
      }
      earnedScore += budgetScore;
    }

    // 2. Location scoring (+25)
    const hasLeadLocation = lead.preferredLocations && lead.preferredLocations.length > 0;
    const hasPropertyLocation = property.location != null && property.location.trim().length > 0;

    if (hasLeadLocation && hasPropertyLocation) {
      maxPossibleScore += weights.locationMatch;

      const propertyLoc = property.location!.toLowerCase();
      const matched = lead.preferredLocations!.some((loc) => {
        if (!loc || !loc.trim()) return false;
        const normalizedLoc = loc.toLowerCase().trim();
        return propertyLoc.includes(normalizedLoc) || normalizedLoc.includes(propertyLoc);
      });

      if (matched) {
        locationScore = weights.locationMatch;
      }
      earnedScore += locationScore;
    }

    // 3. Property Type scoring (+20)
    const hasLeadPropertyType = lead.propertyType != null;
    const hasPropertyType = property.propertyType != null;

    if (hasLeadPropertyType && hasPropertyType) {
      maxPossibleScore += weights.propertyTypeMatch;

      if (lead.propertyType === property.propertyType) {
        propertyTypeScore = weights.propertyTypeMatch;
      }
      earnedScore += propertyTypeScore;
    }

    // 4. BHK / Configuration scoring (+10)
    const hasLeadBhk = lead.bhk != null && lead.bhk.trim().length > 0;
    const hasPropertyBhk = property.bhk != null && property.bhk.trim().length > 0;

    if (hasLeadBhk && hasPropertyBhk) {
      maxPossibleScore += weights.bhkMatch;

      if (lead.bhk!.toLowerCase().trim() === property.bhk!.toLowerCase().trim()) {
        bhkScore = weights.bhkMatch;
      }
      earnedScore += bhkScore;
    }

    // 5. Possession timeline scoring (+10)
    const hasLeadUrgency = lead.urgency != null;
    const hasPropertyPossession = property.possessionStatus != null;

    if (hasLeadUrgency && hasPropertyPossession) {
      maxPossibleScore += weights.possessionMatch;

      if (lead.urgency === 'IMMEDIATE' && property.possessionStatus === 'READY_TO_MOVE') {
        possessionScore = weights.possessionMatch;
      } else if (
        lead.urgency === 'WITHIN_1_MONTH' &&
        ['READY_TO_MOVE', 'WITHIN_3_MONTHS'].includes(property.possessionStatus!)
      ) {
        possessionScore = weights.possessionMatch;
      } else if (
        lead.urgency === 'WITHIN_3_MONTHS' &&
        ['READY_TO_MOVE', 'WITHIN_3_MONTHS', 'WITHIN_6_MONTHS'].includes(property.possessionStatus!)
      ) {
        possessionScore = weights.possessionMatch;
      } else if (lead.urgency === 'EXPLORING') {
        possessionScore = weights.possessionMatch;
      }
      earnedScore += possessionScore;
    }

    // Normalize final score against applicable criteria
    let finalScore = 0;
    if (maxPossibleScore > 0) {
      finalScore = Math.min(100, Math.max(0, Math.round((earnedScore / maxPossibleScore) * 100)));
    }

    return {
      score: finalScore,
      maxPossibleScore,
      earnedScore,
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
