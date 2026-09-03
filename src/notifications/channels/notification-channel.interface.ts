export interface NotificationPayload {
  userId: string;
  title: string;
  message: string;
  type: string;
  matchId?: string;
  metadata?: any;
}

export interface NotificationChannel {
  name: string;
  send(payload: NotificationPayload): Promise<boolean>;
}
