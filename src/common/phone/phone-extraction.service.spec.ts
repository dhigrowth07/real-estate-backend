import { Test, TestingModule } from '@nestjs/testing';
import { PhoneExtractionService } from './phone-extraction.service';
import { ConfigService } from '@nestjs/config';

describe('PhoneExtractionService', () => {
  let service: PhoneExtractionService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'DEFAULT_COUNTRY_CODE') return 'IN';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhoneExtractionService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PhoneExtractionService>(PhoneExtractionService);
  });

  describe('Clean Phone Numbers', () => {
    it('should parse a clean international E.164 number', () => {
      const result = service.extractPhoneNumber('+919876543210');
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+919876543210');
      expect(result.nationalNumber).toBe('9876543210');
      expect(result.country).toBe('IN');
      expect(result.confidence).toBe('HIGH');
    });

    it('should parse clean 10-digit number with standard prefix', () => {
      const result = service.extractPhoneNumber('+91 9876543210');
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+919876543210');
    });
  });

  describe('Spaced, Dashed, and Messy Real-world Input', () => {
    it('should extract spaced phone number embedded in a sentence', () => {
      const text = 'Hello, my number is 98765 43210 please share details';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+919876543210');
      expect(result.nationalNumber).toBe('9876543210');
    });

    it('should extract dashed number with country code', () => {
      const text = 'Reach me at +91-9876-543-210 on WhatsApp';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+919876543210');
    });

    it('should extract dashed national number without country code', () => {
      const text = 'Call 9876-543-210 tomorrow morning';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+919876543210');
    });
  });

  describe('Missing Country Code (Default Country = IN)', () => {
    it('should default to India (+91) for 10-digit Indian mobile number', () => {
      const text = 'My contact is 9876543210';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+919876543210');
      expect(result.country).toBe('IN');
    });

    it('should parse 10-digit number starting with 8, 7, or 6', () => {
      const text = 'WhatsApp: 8765432109';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+918765432109');
    });
  });

  describe('No Number Present', () => {
    it('should return found: false when text has no numbers', () => {
      const text = 'Hello, I am looking for a 3 BHK apartment in Whitefield.';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(false);
      expect(result.confidence).toBe('NONE');
      expect(result.e164).toBeUndefined();
    });

    it('should handle empty or null text safely', () => {
      expect(service.extractPhoneNumber('')).toEqual({ found: false, confidence: 'NONE' });
      expect(service.extractPhoneNumber(null)).toEqual({ found: false, confidence: 'NONE' });
      expect(service.extractPhoneNumber('   ')).toEqual({ found: false, confidence: 'NONE' });
    });
  });

  describe('False Positives (Prices, Pincodes, Dates, Codes)', () => {
    it('should not extract 6-digit Indian postal pincodes as phone numbers', () => {
      const text = 'I am looking for properties in Bangalore near pincode 560034';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(false);
    });

    it('should not extract real estate prices as phone numbers', () => {
      const text = 'My budget is 80 lakhs or around 8000000 rupees for a villa.';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(false);
    });

    it('should not extract dates or short OTP codes', () => {
      const text = 'Inspection date is 2026-09-05 and verification code is 482910';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(false);
    });
  });

  describe('International Numbers and Overrides', () => {
    it('should parse US international numbers accurately', () => {
      const text = 'Here is my US number +1 415 234 5678';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+14152345678');
      expect(result.country).toBe('US');
    });

    it('should parse UAE international number accurately', () => {
      const text = 'Contact +971 50 123 4567';
      const result = service.extractPhoneNumber(text);
      expect(result.found).toBe(true);
      expect(result.e164).toBe('+971501234567');
      expect(result.country).toBe('AE');
    });
  });
});
