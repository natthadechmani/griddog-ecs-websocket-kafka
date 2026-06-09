import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Producer } from 'kafkajs';
import { KAFKA_PRODUCER } from '../kafka/kafka.module';
import { KAFKA_TOPIC } from '../kafka/kafka.config';
import tracer from 'dd-trace';

/** Datadog tag value size limit; bodies may include PII — use only where acceptable. */
const MAX_REQUEST_BODY_TAG_CHARS = 4000;

function requestBodyForTag(body: unknown): string {
  try {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    return s.length > MAX_REQUEST_BODY_TAG_CHARS
      ? s.slice(0, MAX_REQUEST_BODY_TAG_CHARS) + '…[truncated]'
      : s;
  } catch {
    return '[unserializable body]';
  }
}

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

    const name = body?.customer?.name || '';
    const email = body?.customer?.email || '';

    const createdAt = new Date().toISOString();

    const event = {
      transactionId,
      items,
      total,
      customer: {
        name: name,
        email: email,
      },
      createdAt,
    };

    const span = tracer.scope().active();
    span?.setTag('checkout.request_body', requestBodyForTag(body));
    span?.setTag('checkout.transaction_id', transactionId);
    span?.setTag('checkout.items', items);
    span?.setTag('checkout.customer', { name, email });
    span?.setTag('checkout.total', total);
    span?.setTag('checkout.status', 'processing');
    span?.setTag('checkout.created_at', createdAt);

    try {
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
    } catch (err) {
      // Kafka unavailable / not ready: do NOT touch the DB. Fail the request so
      // the frontend can show "checkout failed" instead of hanging on
      // "Processing…".
      span?.setTag('error', err);
      span?.setTag('checkout.status', 'failed');
      span?.setTag('checkout.kafka_error', (err as Error).message);
      // eslint-disable-next-line no-console
      console.error(
        `kafka produce failed txnId=${transactionId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Checkout failed: unable to submit order. Please try again.',
      );
    }

    return { transactionId, total, status: 'processing' };
  }
}
