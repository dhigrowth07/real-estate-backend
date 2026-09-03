import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationFilterDto } from './dto/notification-filter.dto';
import { UserRole, NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private gateway: NotificationsGateway,
  ) {}

  /**
   * Generates and dispatches notifications when a match score exceeds threshold
   */
  async handleMatchAlert(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        lead: true,
        property: true,
      },
    });

    if (!match || !match.lead || !match.property) return;

    // Check if either entity is soft-deleted
    if (match.lead.deletedAt || match.property.deletedAt) return;

    const settings = await this.settingsService.getSettings();
    const threshold = settings.minAlertScore || 70;

    if (match.score < threshold) {
      return;
    }

    // Determine target recipient IDs
    const recipientIds = new Set<string>();

    if (match.lead.assignedAgentId) {
      recipientIds.add(match.lead.assignedAgentId);
    }
    if (match.property.assignedAgentId) {
      recipientIds.add(match.property.assignedAgentId);
    }

    // If lead or property is unassigned, notify all admins
    if (!match.lead.assignedAgentId || !match.property.assignedAgentId) {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });
      admins.forEach((admin) => recipientIds.add(admin.id));
    }

    const title = `🔥 High Match Alert: ${Math.round(match.score)}% Compatibility`;
    const message = `Lead "${match.lead.name}" matches Property "${match.property.title}" with a compatibility score of ${Math.round(match.score)}%.`;

    for (const userId of recipientIds) {
      // Avoid duplicate alert notifications for the exact same match within 1 hour
      const recentExisting = await this.prisma.notification.findFirst({
        where: {
          userId,
          matchId: match.id,
          createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });

      if (!recentExisting) {
        const notification = await this.prisma.notification.create({
          data: {
            userId,
            matchId: match.id,
            type: NotificationType.MATCH_ALERT,
            title,
            message,
            metadata: {
              score: match.score,
              leadId: match.leadId,
              leadName: match.lead.name,
              propertyId: match.propertyId,
              propertyTitle: match.property.title,
            },
          },
          include: {
            match: {
              include: {
                lead: { select: { id: true, name: true, phone: true } },
                property: { select: { id: true, title: true, price: true } },
              },
            },
          },
        });

        // Real-time push over WebSockets to user room
        this.gateway.sendToUser(userId, 'notification', notification);
        this.gateway.sendToUser(userId, 'match_alert', notification);

        this.logger.log(`Dispatched real-time alert for Match ${match.id} to User ${userId}`);
      }
    }
  }

  /**
   * Get paginated notifications for current user
   */
  async findAll(userId: string, filter?: NotificationFilterDto) {
    const where: any = { userId };

    if (filter?.unreadOnly) {
      where.isRead = false;
    }

    const limit = filter?.limit || 20;
    const page = filter?.page || 1;
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          match: {
            include: {
              lead: { select: { id: true, name: true, phone: true } },
              property: { select: { id: true, title: true, price: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Fast unread count lookup
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    return this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark all notifications for a user as read
   */
  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return {
      success: true,
      updatedCount: result.count,
    };
  }

  /**
   * Dismiss / delete a notification
   */
  async dismiss(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    await this.prisma.notification.delete({ where: { id } });

    return {
      success: true,
      message: `Notification ${id} dismissed.`,
    };
  }
}
