import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationPayload } from './notification-channel.interface';
import { NotificationsGateway } from '../notifications.gateway';

@Injectable()
export class InAppChannel implements NotificationChannel {
  name = 'IN_APP';

  constructor(private readonly gateway: NotificationsGateway) {}

  async send(payload: NotificationPayload): Promise<boolean> {
    this.gateway.sendToUser(payload.userId, 'notification', payload);
    return true;
  }
}
