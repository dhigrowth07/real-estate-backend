import { Injectable } from '@nestjs/common';
import { Lead, Property } from '@prisma/client';

export interface MatchingWeights {
  budgetFullMatch: number; // 35
  budgetPartialMatch: number; // 20
  locationMatch: number; // 25
  propertyTypeMatch: number; // 20
  bhkMatch: number; // 10
  possessionMatch: number; // 10
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
  private weights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS;

  /**
   * Allows runtime or configuration overrides of scoring weights
   */
  public setWeights(customWeights: Partial<MatchingWeights>) {
    this.weights = { ...this.weights, ...customWeights };
  }

  public getWeights(): MatchingWeights {
    return { ...this.weights };
  }

  /**
   * Calculates compatibility score between a Lead and a Property (0 - 100)
   */
  public calculateScore(lead: Lead, property: Property): MatchEvaluation {
    let budgetScore = 0;
    let locationScore = 0;
    let propertyTypeScore = 0;
    let bhkScore = 0;
    let possessionScore = 0;

    // 1. Budget scoring (+35 full match, +20 within 10% tolerance)
    if (property.price >= lead.budgetMin && property.price <= lead.budgetMax) {
      budgetScore = this.weights.budgetFullMatch;
    } else {
      const tolerance = lead.budgetMax * 0.1;
      if (
        property.price >= lead.budgetMin - tolerance &&
        property.price <= lead.budgetMax + tolerance
      ) {
        budgetScore = this.weights.budgetPartialMatch;
      }
    }

    // 2. Location scoring (+25)
    if (lead.preferredLocations && lead.preferredLocations.length > 0) {
      const propertyLoc = property.location.toLowerCase();
      const matched = lead.preferredLocations.some(
        (loc) => propertyLoc.includes(loc.toLowerCase()) || loc.toLowerCase().includes(propertyLoc),
      );
      if (matched) {
        locationScore = this.weights.locationMatch;
      }
    } else {
      // If lead specified no location preference, award partial or full
      locationScore = this.weights.locationMatch * 0.5;
    }

    // 3. Property Type scoring (+20)
    if (lead.propertyType === property.propertyType) {
      propertyTypeScore = this.weights.propertyTypeMatch;
    }

    // 4. BHK / Configuration scoring (+10)
    if (lead.bhk && property.bhk) {
      if (lead.bhk.toLowerCase().trim() === property.bhk.toLowerCase().trim()) {
        bhkScore = this.weights.bhkMatch;
      }
    } else if (!lead.bhk) {
      bhkScore = this.weights.bhkMatch;
    }

    // 5. Possession timeline scoring (+10)
    if (lead.urgency === 'IMMEDIATE' && property.possessionStatus === 'READY_TO_MOVE') {
      possessionScore = this.weights.possessionMatch;
    } else if (
      lead.urgency === 'WITHIN_1_MONTH' &&
      ['READY_TO_MOVE', 'WITHIN_3_MONTHS'].includes(property.possessionStatus)
    ) {
      possessionScore = this.weights.possessionMatch;
    } else if (
      lead.urgency === 'WITHIN_3_MONTHS' &&
      ['READY_TO_MOVE', 'WITHIN_3_MONTHS'].includes(property.possessionStatus)
    ) {
      possessionScore = this.weights.possessionMatch;
    } else if (lead.urgency === 'EXPLORING') {
      possessionScore = this.weights.possessionMatch;
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
