import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * Wraps a socket.io v4 server attached directly to the Nest HTTP server
 * (we avoid @nestjs/platform-socket.io, which is pinned to socket.io v2 / old ws).
 * Browsers connect, then `subscribe` with their transactionId to join a room;
 * the checkout consumer emits `checkout:done` to that room once the order is
 * persisted.
 */
@Injectable()
export class RealtimeService {
  private io: Server | undefined;

  init(httpServer: any) {
    this.io = new Server(httpServer, {
      cors: { origin: '*' },
      path: '/socket.io',
    });

    this.io.on('connection', (socket) => {
      socket.on('subscribe', (data: { transactionId?: string }) => {
        if (data && data.transactionId) {
          socket.join(data.transactionId);
          // eslint-disable-next-line no-console
          console.log(`socket ${socket.id} subscribed txnId=${data.transactionId}`);
        }
      });
    });

    // eslint-disable-next-line no-console
    console.log('socket.io server initialized on /socket.io');
  }

  emitDone(transactionId: string, payload: any) {
    if (!this.io) return;
    this.io.to(transactionId).emit('checkout:done', payload);
  }
}
