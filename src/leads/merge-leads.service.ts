import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import { Lead, LeadStage } from '@prisma/client';

export interface MergeResult {
  primaryLead: Lead;
  duplicateLead?: Lead;
  merged: boolean;
}

@Injectable()
export class MergeLeadsService {
  private readonly logger = new Logger(MergeLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MatchesService))
    private readonly matchesService: MatchesService,
  ) {}

  /**
   * Merges a lead with any existing duplicate lead sharing the same phone number.
   *
   * 1. Finds existing active leads with the matching phone number.
   * 2. Designates the older/more complete record as the primary lead.
   * 3. Moves Interactions, Conversations, and non-conflicting Matches to the primary lead.
   * 4. Merges `sources` arrays, retains interestedPropertyId, instagramUserId, and WhatsApp opt-in evidence.
   * 5. Soft-deletes the duplicate record.
   * 6. Refreshes matching engine scores for the merged primary lead.
   */
  async mergeLeadByPhone(leadId: string, phone: string): Promise<MergeResult> {
    if (!phone || !phone.trim()) {
      const current = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (!current) throw new Error(`Lead with ID ${leadId} not found`);
      return { primaryLead: current, merged: false };
    }

    const currentLead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!currentLead) {
      throw new Error(`Lead with ID ${leadId} not found`);
    }

    const normalizedPhone = phone.trim();
    const digitsOnly = normalizedPhone.replace(/\D/g, '');
    const e164 = normalizedPhone.startsWith('+') ? normalizedPhone : `+${digitsOnly}`;
    const rawDigits =
      digitsOnly.startsWith('91') && digitsOnly.length === 12
        ? digitsOnly.slice(2)
        : digitsOnly;

    // Search for other active leads with this phone number (excluding self)
    const existingDuplicates = await this.prisma.lead.findMany({
      where: {
        id: { not: leadId },
        deletedAt: null,
        OR: [
          { phone: e164 },
          { phone: normalizedPhone },
          { phone: digitsOnly },
          { phone: rawDigits },
          { phone: `+${digitsOnly}` },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existingDuplicates.length === 0) {
      this.logger.log(
        `[MergeLeadsService] No duplicate found for phone "${normalizedPhone}". Lead "${leadId}" remains single.`,
      );
      return { primaryLead: currentLead, merged: false };
    }

    // Select candidate duplicate
    const candidateLead = existingDuplicates[0];
    this.logger.log(
      `[MergeLeadsService] Found duplicate lead "${candidateLead.id}" with phone "${normalizedPhone}" for lead "${currentLead.id}". Merging...`,
    );

    // Determine primary vs secondary
    const currentScore = this.calculateCompletenessScore(currentLead);
    const candidateScore = this.calculateCompletenessScore(candidateLead);

    let primary: Lead;
    let secondary: Lead;

    if (candidateScore > currentScore) {
      primary = candidateLead;
      secondary = currentLead;
    } else if (currentScore > candidateScore) {
      primary = currentLead;
      secondary = candidateLead;
    } else {
      // If equal, older record (earliest createdAt) is primary
      if (candidateLead.createdAt <= currentLead.createdAt) {
        primary = candidateLead;
        secondary = currentLead;
      } else {
        primary = currentLead;
        secondary = candidateLead;
      }
    }

    this.logger.log(
      `[MergeLeadsService] Designated Lead "${primary.id}" (${primary.name}) as PRIMARY, Lead "${secondary.id}" (${secondary.name}) as SECONDARY.`,
    );

    // 1. Merge sources (union, deduplicated)
    const primarySources = Array.isArray(primary.sources) ? primary.sources : [];
    const secondarySources = Array.isArray(secondary.sources) ? secondary.sources : [];
    const combinedSourcesSet = new Set<string>([...primarySources, ...secondarySources]);

    // Format and include source enums if not present
    if (primary.source) {
      combinedSourcesSet.add(this.formatSourceLabel(primary.source));
    }
    if (secondary.source) {
      combinedSourcesSet.add(this.formatSourceLabel(secondary.source));
    }
    const mergedSources = Array.from(combinedSourcesSet).filter(Boolean);

    // 2. Attributes merging
    const isPlaceholder = (name?: string) =>
      !name || name.startsWith('Instagram User') || name.startsWith('WhatsApp User');

    const mergedName = !isPlaceholder(primary.name)
      ? primary.name
      : !isPlaceholder(secondary.name)
      ? secondary.name
      : primary.name;

    const mergedPhone = primary.phone && primary.phone.length > 5 ? primary.phone : secondary.phone || e164;
    const mergedEmail = primary.email || secondary.email || null;
    const mergedInterestedPropertyId =
      primary.interestedPropertyId || secondary.interestedPropertyId || null;
    const mergedInstagramUserId =
      primary.instagramUserId || secondary.instagramUserId || null;
    const mergedWhatsappOptIn = primary.whatsappOptIn || secondary.whatsappOptIn;
    const mergedWhatsappOptInEvidence =
      primary.whatsappOptInEvidence || secondary.whatsappOptInEvidence || null;

    const mergedStage =
      primary.stage === LeadStage.UNQUALIFIED && secondary.stage !== LeadStage.UNQUALIFIED
        ? secondary.stage
        : primary.stage;

    const mergedBudgetMin = primary.budgetMin > 0 ? primary.budgetMin : secondary.budgetMin;
    const mergedBudgetMax = primary.budgetMax > 0 ? primary.budgetMax : secondary.budgetMax;
    const mergedPreferredLocations =
      primary.preferredLocations && primary.preferredLocations.length > 0
        ? primary.preferredLocations
        : secondary.preferredLocations || [];
    const mergedBhk = primary.bhk || secondary.bhk || null;
    const mergedAssignedAgentId = primary.assignedAgentId || secondary.assignedAgentId || null;

    // 3. Execute DB reassignments and update
    return await this.prisma.$transaction(async (tx) => {
      // Step A: Reassign all Interactions from secondary to primary
      await tx.interaction.updateMany({
        where: { leadId: secondary.id },
        data: { leadId: primary.id },
      });

      // Step B: Reassign all Conversations from secondary to primary
      await tx.conversation.updateMany({
        where: { leadId: secondary.id },
        data: { leadId: primary.id },
      });

      // Step C: Reassign Matches from secondary to primary
      const existingPrimaryMatches = await tx.match.findMany({
        where: { leadId: primary.id },
        select: { propertyId: true },
      });
      const primaryPropertyIds = existingPrimaryMatches.map((m) => m.propertyId);

      // Delete any conflicting matches on secondary
      if (primaryPropertyIds.length > 0) {
        await tx.match.deleteMany({
          where: {
            leadId: secondary.id,
            propertyId: { in: primaryPropertyIds },
          },
        });
      }

      // Move remaining matches to primary
      await tx.match.updateMany({
        where: { leadId: secondary.id },
        data: { leadId: primary.id },
      });

      // Step D: Soft-delete secondary and release instagramUserId unique constraint
      await tx.lead.update({
        where: { id: secondary.id },
        data: {
          deletedAt: new Date(),
          instagramUserId: null, // Clear unique field to prevent collision
        },
      });

      // Step E: Update primary lead with merged attributes
      const updatedPrimary = await tx.lead.update({
        where: { id: primary.id },
        data: {
          name: mergedName,
          phone: mergedPhone,
          email: mergedEmail,
          sources: mergedSources,
          stage: mergedStage,
          budgetMin: mergedBudgetMin,
          budgetMax: mergedBudgetMax,
          preferredLocations: mergedPreferredLocations,
          bhk: mergedBhk,
          assignedAgentId: mergedAssignedAgentId,
          interestedPropertyId: mergedInterestedPropertyId,
          instagramUserId: mergedInstagramUserId,
          whatsappOptIn: mergedWhatsappOptIn,
          whatsappOptInEvidence: mergedWhatsappOptInEvidence,
        },
      });

      this.logger.log(
        `[MergeLeadsService] Successfully merged duplicate lead "${secondary.id}" into primary lead "${primary.id}". Sources: [${mergedSources.join(', ')}]`,
      );

      return {
        primaryLead: updatedPrimary,
        duplicateLead: secondary,
        merged: true,
      };
    }).then(async (res) => {
      // Step F: Refresh matching scores for primary lead
      try {
        await this.matchesService.generateMatchesForLead(res.primaryLead.id);
      } catch (err: any) {
        this.logger.error(
          `[MergeLeadsService] Error refreshing matches after merge for lead "${res.primaryLead.id}": ${err.message}`,
        );
      }
      return res;
    });
  }

  /**
   * Scores completeness of a lead profile to decide the primary record.
   */
  private calculateCompletenessScore(lead: Lead): number {
    let score = 0;
    if (lead.email) score += 2;
    if (lead.budgetMax > 0 || lead.budgetMin > 0) score += 2;
    if (Array.isArray(lead.preferredLocations) && lead.preferredLocations.length > 0) score += 2;
    if (lead.assignedAgentId) score += 2;
    if (lead.stage && lead.stage !== LeadStage.UNQUALIFIED && lead.stage !== LeadStage.NEW) score += 3;
    if (lead.bhk) score += 1;
    if (lead.name && !lead.name.startsWith('Instagram User') && !lead.name.startsWith('WhatsApp User')) score += 2;
    if (lead.phone && lead.phone.length > 5) score += 2;
    if (lead.whatsappOptIn) score += 1;
    return score;
  }

  private formatSourceLabel(source: string): string {
    switch (source) {
      case 'DIRECT_CALL':
        return 'Call';
      case 'INSTAGRAM':
        return 'Instagram';
      case 'WHATSAPP':
        return 'WhatsApp';
      case 'WEBSITE':
        return 'Website';
      case 'REFERRAL':
        return 'Referral';
      case 'PORTAL':
        return 'Portal';
      case 'WALK_IN':
        return 'Walk-in';
      default:
        return source;
    }
  }
}
