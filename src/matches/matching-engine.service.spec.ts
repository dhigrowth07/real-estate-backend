import { MatchingEngineService } from './matching-engine.service';
import { Lead, Property, PropertyType, PossessionStatus, LeadUrgency } from '@prisma/client';

describe('MatchingEngineService', () => {
  let service: MatchingEngineService;

  beforeEach(() => {
    service = new MatchingEngineService();
  });

  const baseLead: Partial<Lead> = {
    budgetMin: 5000000,
    budgetMax: 8000000,
    preferredLocations: ['Whitefield', 'Indiranagar'],
    propertyType: PropertyType.APARTMENT,
    bhk: '3BHK',
    urgency: LeadUrgency.IMMEDIATE,
  };

  const baseProperty: Partial<Property> = {
    price: 6500000,
    location: 'Whitefield, Bangalore',
    propertyType: PropertyType.APARTMENT,
    bhk: '3BHK',
    possessionStatus: PossessionStatus.READY_TO_MOVE,
  };

  describe('Fully-Qualified Lead (Existing Behavior Unchanged)', () => {
    it('should return 100% score for a perfect match across all dimensions', () => {
      const result = service.calculateScore(baseLead, baseProperty);

      expect(result.score).toBe(100);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.earnedScore).toBe(100);
      expect(result.breakdown.budgetScore).toBe(35);
      expect(result.breakdown.locationScore).toBe(25);
      expect(result.breakdown.propertyTypeScore).toBe(20);
      expect(result.breakdown.bhkScore).toBe(10);
      expect(result.breakdown.possessionScore).toBe(10);
    });

    it('should award partial budget match (+20) when price is within 10% tolerance', () => {
      // Lead budget max: 8,000,000. 10% tolerance = 800,000. Price: 8,500,000
      const partialBudgetProperty = { ...baseProperty, price: 8500000 };
      const result = service.calculateScore(baseLead, partialBudgetProperty);

      expect(result.score).toBe(85);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.budgetScore).toBe(20);
    });

    it('should award 0 for budget when price is far outside budget range', () => {
      // Lead budget: 5M-8M. Price: 12,000,000 (> 8.8M)
      const expensiveProperty = { ...baseProperty, price: 12000000 };
      const result = service.calculateScore(baseLead, expensiveProperty);

      expect(result.score).toBe(65);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.budgetScore).toBe(0);
    });

    it('should award 0 for location when property is in an unrelated location', () => {
      const otherLocationProperty = {
        ...baseProperty,
        location: 'Hebbal North, Bangalore',
      };
      const result = service.calculateScore(baseLead, otherLocationProperty);

      expect(result.score).toBe(75);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.locationScore).toBe(0);
    });

    it('should award 0 for property type mismatch', () => {
      const villaProperty = {
        ...baseProperty,
        propertyType: PropertyType.VILLA,
      };
      const result = service.calculateScore(baseLead, villaProperty);

      expect(result.score).toBe(80);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.propertyTypeScore).toBe(0);
    });

    it('should award 0 for BHK mismatch', () => {
      const oneBhkProperty = { ...baseProperty, bhk: '1BHK' };
      const result = service.calculateScore(baseLead, oneBhkProperty);

      expect(result.score).toBe(90);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.bhkScore).toBe(0);
    });

    it('should award 0 for possession mismatch when lead is IMMEDIATE but property is UNDER_CONSTRUCTION', () => {
      const ucProperty = {
        ...baseProperty,
        possessionStatus: PossessionStatus.UNDER_CONSTRUCTION,
      };
      const result = service.calculateScore(baseLead, ucProperty);

      expect(result.score).toBe(90);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.possessionScore).toBe(0);
    });

    it('should support dynamic custom weights', () => {
      const customWeights = {
        budgetFullMatch: 50,
        locationMatch: 30,
        propertyTypeMatch: 10,
        bhkMatch: 5,
        possessionMatch: 5,
      };

      const result = service.calculateScore(baseLead, baseProperty, customWeights);
      expect(result.score).toBe(100);
      expect(result.maxPossibleScore).toBe(100);
      expect(result.breakdown.budgetScore).toBe(50);
      expect(result.breakdown.locationScore).toBe(30);
      expect(result.breakdown.propertyTypeScore).toBe(10);
    });
  });

  describe('Null-Tolerant Scoring for Partially-Qualified Leads', () => {
    it('should normalize score correctly for a lead missing budget only', () => {
      const leadMissingBudget: Partial<Lead> = {
        budgetMin: null,
        budgetMax: null,
        preferredLocations: ['Whitefield'],
        propertyType: PropertyType.APARTMENT,
        bhk: '3BHK',
        urgency: LeadUrgency.IMMEDIATE,
      };

      // 4 applicable criteria: location (25) + propertyType (20) + bhk (10) + possession (10) = 65 total possible weight
      const result = service.calculateScore(leadMissingBudget, baseProperty);

      expect(result.maxPossibleScore).toBe(65);
      expect(result.earnedScore).toBe(65);
      expect(result.score).toBe(100);
      expect(result.breakdown.budgetScore).toBe(0);
      expect(result.breakdown.locationScore).toBe(25);
      expect(result.breakdown.propertyTypeScore).toBe(20);
      expect(result.breakdown.bhkScore).toBe(10);
      expect(result.breakdown.possessionScore).toBe(10);
    });

    it('should calculate proportional score when lead missing budget has a mismatch on BHK', () => {
      const leadMissingBudget: Partial<Lead> = {
        budgetMin: null,
        budgetMax: null,
        preferredLocations: ['Whitefield'],
        propertyType: PropertyType.APARTMENT,
        bhk: '3BHK',
        urgency: LeadUrgency.IMMEDIATE,
      };

      const oneBhkProperty = { ...baseProperty, bhk: '1BHK' };
      // Earned: 25 (loc) + 20 (type) + 0 (bhk) + 10 (possession) = 55 out of 65 -> 85%
      const result = service.calculateScore(leadMissingBudget, oneBhkProperty);

      expect(result.maxPossibleScore).toBe(65);
      expect(result.earnedScore).toBe(55);
      expect(result.score).toBe(85);
    });

    it('should normalize score correctly for a lead missing everything except property type', () => {
      const leadPropertyTypeOnly: Partial<Lead> = {
        budgetMin: null,
        budgetMax: null,
        preferredLocations: [],
        propertyType: PropertyType.APARTMENT,
        bhk: null,
        urgency: null,
      };

      // Matching PropertyType (APARTMENT === APARTMENT)
      // Only 1 applicable criterion: propertyType (weight 20). 20 / 20 = 100%
      const matchResult = service.calculateScore(leadPropertyTypeOnly, baseProperty);

      expect(matchResult.maxPossibleScore).toBe(20);
      expect(matchResult.earnedScore).toBe(20);
      expect(matchResult.score).toBe(100);
      expect(matchResult.breakdown.propertyTypeScore).toBe(20);
      expect(matchResult.breakdown.budgetScore).toBe(0);
      expect(matchResult.breakdown.locationScore).toBe(0);
      expect(matchResult.breakdown.bhkScore).toBe(0);
      expect(matchResult.breakdown.possessionScore).toBe(0);

      // Mismatched PropertyType (APARTMENT vs VILLA)
      // 0 / 20 = 0%
      const villaProperty = { ...baseProperty, propertyType: PropertyType.VILLA };
      const mismatchResult = service.calculateScore(leadPropertyTypeOnly, villaProperty);

      expect(mismatchResult.maxPossibleScore).toBe(20);
      expect(mismatchResult.earnedScore).toBe(0);
      expect(mismatchResult.score).toBe(0);
    });

    it('should return 0 score when lead has no criteria specified at all', () => {
      const emptyLead: Partial<Lead> = {
        budgetMin: null,
        budgetMax: null,
        preferredLocations: [],
        propertyType: null,
        bhk: null,
        urgency: null,
      };

      const result = service.calculateScore(emptyLead, baseProperty);
      expect(result.maxPossibleScore).toBe(0);
      expect(result.earnedScore).toBe(0);
      expect(result.score).toBe(0);
    });
  });
});
