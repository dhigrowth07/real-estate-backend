import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parsePhoneNumberFromString,
  findPhoneNumbersInText,
  CountryCode,
  PhoneNumber,
} from 'libphonenumber-js';

export interface PhoneExtractionResult {
  found: boolean;
  e164?: string;
  nationalNumber?: string;
  country?: CountryCode;
  countryCallingCode?: string;
  formattedInternational?: string;
  formattedNational?: string;
  confidence: 'HIGH' | 'LOW' | 'NONE';
  rawMatch?: string;
}

@Injectable()
export class PhoneExtractionService {
  private readonly logger = new Logger(PhoneExtractionService.name);
  private readonly defaultCountry: CountryCode;

  constructor(private readonly configService: ConfigService) {
    this.defaultCountry = (this.configService.get<string>('DEFAULT_COUNTRY_CODE') || 'IN') as CountryCode;
  }

  /**
   * Extracts and normalizes the first valid phone number found in a raw text string
   *
   * @param text Raw user message (e.g. "my number is 98765 43210", "call +91-9876543210", "+1 555-123-4567")
   * @param customDefaultCountry Optional override for the default country code (e.g. 'IN', 'US', 'AE')
   * @returns Structured extraction result with normalized E.164 phone number if valid
   */
  extractPhoneNumber(text?: string | null, customDefaultCountry?: CountryCode): PhoneExtractionResult {
    if (!text || typeof text !== 'string') {
      return { found: false, confidence: 'NONE' };
    }

    const country = customDefaultCountry || this.defaultCountry;
    const trimmed = text.trim();

    if (!trimmed) {
      return { found: false, confidence: 'NONE' };
    }

    // Pass 1: Use libphonenumber's built-in text scanner
    try {
      const results = findPhoneNumbersInText(trimmed, { defaultCountry: country });

      for (const item of results) {
        const phone = item.number;
        if (phone && phone.isValid()) {
          return this.formatSuccessResult(phone, item.startsAt !== undefined ? trimmed.slice(item.startsAt, item.endsAt) : phone.number);
        }
      }
    } catch (err: any) {
      this.logger.debug(`findPhoneNumbersInText error: ${err.message}`);
    }

    // Pass 2: Direct whole-string or token parse for messy unspaced formats
    // Handles formats like: "my whatsapp is 9876543210" or "919876543210" or "+919876543210"
    const directParse = parsePhoneNumberFromString(trimmed, country);
    if (directParse && directParse.isValid()) {
      return this.formatSuccessResult(directParse, trimmed);
    }

    // Pass 3: Extract number-like digit blocks (with optional +, spaces, brackets, dashes)
    // Matches candidate blocks of 8 to 15 digits while avoiding simple short numbers/pincodes
    const phoneCandidateRegex = /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/g;
    const matches = trimmed.match(phoneCandidateRegex);

    if (matches && matches.length > 0) {
      for (const candidate of matches) {
        const cleanedDigits = candidate.replace(/[^\d+]/g, '');
        // Ignore obvious short numbers like 6-digit pincodes or prices without international code
        if (cleanedDigits.length < 9) {
          continue;
        }

        const candidateParsed = parsePhoneNumberFromString(candidate, country);
        if (candidateParsed && candidateParsed.isValid()) {
          return this.formatSuccessResult(candidateParsed, candidate);
        }
      }
    }

    return { found: false, confidence: 'NONE' };
  }

  /**
   * Helper to format a valid PhoneNumber instance into PhoneExtractionResult
   */
  private formatSuccessResult(phone: PhoneNumber, rawMatch: string): PhoneExtractionResult {
    return {
      found: true,
      e164: phone.number, // E.164 format: e.g. "+919876543210"
      nationalNumber: phone.nationalNumber, // National number without prefix: e.g. "9876543210"
      country: phone.country,
      countryCallingCode: phone.countryCallingCode,
      formattedInternational: phone.formatInternational(), // e.g. "+91 98765 43210"
      formattedNational: phone.formatNational(), // e.g. "098765 43210"
      confidence: 'HIGH',
      rawMatch: rawMatch.trim(),
    };
  }
}
