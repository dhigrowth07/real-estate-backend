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

  it('should return 100% score for a perfect match across all dimensions', () => {
    const result = service.calculateScore(baseLead, baseProperty);

    expect(result.score).toBe(100);
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
    expect(result.breakdown.budgetScore).toBe(20);
  });

  it('should award 0 for budget when price is far outside budget range', () => {
    // Lead budget: 5M-8M. Price: 12,000,000 (> 8.8M)
    const expensiveProperty = { ...baseProperty, price: 12000000 };
    const result = service.calculateScore(baseLead, expensiveProperty);

    expect(result.score).toBe(65);
    expect(result.breakdown.budgetScore).toBe(0);
  });

  it('should award 0 for location when property is in an unrelated location', () => {
    const otherLocationProperty = {
      ...baseProperty,
      location: 'Hebbal North, Bangalore',
    };
    const result = service.calculateScore(baseLead, otherLocationProperty);

    expect(result.score).toBe(75);
    expect(result.breakdown.locationScore).toBe(0);
  });

  it('should award 0 for property type mismatch', () => {
    const villaProperty = {
      ...baseProperty,
      propertyType: PropertyType.VILLA,
    };
    const result = service.calculateScore(baseLead, villaProperty);

    expect(result.score).toBe(80);
    expect(result.breakdown.propertyTypeScore).toBe(0);
  });

  it('should award 0 for BHK mismatch', () => {
    const oneBhkProperty = { ...baseProperty, bhk: '1BHK' };
    const result = service.calculateScore(baseLead, oneBhkProperty);

    expect(result.score).toBe(90);
    expect(result.breakdown.bhkScore).toBe(0);
  });

  it('should award 0 for possession mismatch when lead is IMMEDIATE but property is UNDER_CONSTRUCTION', () => {
    const ucProperty = {
      ...baseProperty,
      possessionStatus: PossessionStatus.UNDER_CONSTRUCTION,
    };
    const result = service.calculateScore(baseLead, ucProperty);

    expect(result.score).toBe(90);
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
    expect(result.breakdown.budgetScore).toBe(50);
    expect(result.breakdown.locationScore).toBe(30);
    expect(result.breakdown.propertyTypeScore).toBe(10);
  });
});
