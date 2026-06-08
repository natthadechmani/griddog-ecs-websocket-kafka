import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Producer } from 'kafkajs';
import { KAFKA_PRODUCER } from '../kafka/kafka.module';
import { KAFKA_TOPIC } from '../kafka/kafka.config';

interface CheckoutItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

@Injectable()
export class CheckoutService {
  constructor(@Inject(KAFKA_PRODUCER) private readonly producer: Producer) {}

  /**
   * Publishes a checkout event to Kafka (no direct DB write). The consumer
   * persists it to Mongo asynchronously and notifies the client over socket.io.
   * The frontend supplies `transactionId` so it can correlate the realtime
   * notification and trace request -> message -> write.
   */
  async create(body: any) {
    const transactionId = body?.transactionId ? String(body.transactionId) : '';
    if (!transactionId) {
      throw new BadRequestException('transactionId is required');
    }

    const rawItems: any[] = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const items: CheckoutItem[] = rawItems.map((it) => ({
      productId: String(it.productId),
      name: String(it.name),
      price: Number(it.price),
      qty: Number(it.qty),
    }));

    const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);

    const event = {
      transactionId,
      items,
      total,
      customer: {
        name: body?.customer?.name || '',
        email: body?.customer?.email || '',
      },
      createdAt: new Date().toISOString(),
    };

    await this.producer.send({
      topic: KAFKA_TOPIC,
      messages: [
        {
          key: transactionId,
          value: JSON.stringify(event),
          headers: { transactionId },
        },
      ],
    });
    // eslint-disable-next-line no-console
    console.log(`produced checkout txnId=${transactionId}`);

    return { transactionId, total, status: 'processing' };
  }
}
