import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { buildKafkaConfig } from './kafka.config';

export const KAFKA = 'KAFKA';
export const KAFKA_PRODUCER = 'KAFKA_PRODUCER';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Connect the producer in the background with retries so app startup is never
 * blocked by broker reachability. kafkajs also auto-connects on first send(),
 * so a checkout that arrives before this completes will still work once the
 * brokers are reachable.
 */
async function connectProducerWithRetry(producer: Producer): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await producer.connect();
      // eslint-disable-next-line no-console
      console.log('Kafka producer connected');
      return;
    } catch (e) {
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
      // eslint-disable-next-line no-console
      console.error(
        `Kafka producer connect failed (attempt ${attempt}): ${
          (e as Error).message
        }; retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: KAFKA,
      useFactory: () => new Kafka(buildKafkaConfig()),
    },
    {
      provide: KAFKA_PRODUCER,
      inject: [KAFKA],
      useFactory: (kafka: Kafka): Producer => {
        const producer = kafka.producer();
        // Do NOT await: returning immediately lets app.listen() bind the HTTP
        // port right away. Connection happens in the background.
        void connectProducerWithRetry(producer);
        return producer;
      },
    },
  ],
  exports: [KAFKA, KAFKA_PRODUCER],
})
export class KafkaModule implements OnModuleDestroy {
  constructor(@Inject(KAFKA_PRODUCER) private readonly producer: Producer) {}

  async onModuleDestroy() {
    await this.producer.disconnect();
  }
}
