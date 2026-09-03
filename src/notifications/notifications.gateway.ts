import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: 'notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extract JWT from handshake auth object or query params
      const token =
        client.handshake.auth?.token ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization
          ? client.handshake.headers.authorization.replace('Bearer ', '')
          : null);

      if (!token) {
        this.logger.warn(`Client disconnected: No auth token provided (${client.id})`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId = payload.sub || payload.id;

      // Store userId in socket data
      client.data.userId = userId;
      client.data.userRole = payload.role;

      // Join client to their dedicated user room
      const userRoom = `user_${userId}`;
      await client.join(userRoom);

      this.logger.log(`Client connected: ${client.id} joined room ${userRoom}`);
    } catch (err) {
      this.logger.warn(`Client disconnected: Invalid token (${client.id}) - ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Send a real-time notification to a specific user
   */
  sendToUser(userId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`user_${userId}`).emit(event, data);
    }
  }

  /**
   * Broadcast real-time event to all connected users
   */
  broadcast(event: string, data: any) {
    if (this.server) {
      this.server.emit(event, data);
    }
  }
}
