import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { buildKafkaConfig } from './kafka.config';

export const KAFKA = 'KAFKA';
export const KAFKA_PRODUCER = 'KAFKA_PRODUCER';

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
      useFactory: async (kafka: Kafka): Promise<Producer> => {
        const producer = kafka.producer();
        await producer.connect();
        // eslint-disable-next-line no-console
        console.log('Kafka producer connected');
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
